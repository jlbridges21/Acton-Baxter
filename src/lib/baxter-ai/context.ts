import "server-only";

import { searchApprovedKnowledge } from "@/lib/knowledge/queries";
import { normalizeSearchText } from "@/lib/knowledge/retrieval";
import type { KnowledgeSearchResult } from "@/lib/knowledge/types";
import type { BaxterContextItem, BaxterHistoryMessage } from "./types";
import { retrievalQueryFromHistory } from "./memory";
import {
  planKnowledgeQuery,
  searchStructuredKnowledge,
  structuredHitsToContextItems,
  buildStructuredEvidencePackage,
  type StructuredSearchResult,
} from "@/lib/knowledge-index";
import { searchLexicalKnowledge, type LexicalHit } from "@/lib/knowledge-index/lexical-search";
import { searchSemanticKnowledge, type SemanticHit } from "@/lib/knowledge-index/semantic-search";
import {
  listAllEmbeddableUnits,
  listAllSpreadsheetRowUnits,
} from "@/lib/knowledge-index/units-store";
import type { KnowledgeQueryPlan, KnowledgeUnitRecord } from "@/lib/knowledge-index/types";

export const BAXTER_CONTEXT_LIMIT = 6;
export const BAXTER_MAX_EXCERPT_CHARS = 900;

export type RankedEvidenceCandidate = {
  entryId: string;
  unitId?: string;
  unitType?: string;
  title: string;
  excerpt: string;
  score: number;
  reason: string;
  channel: "structured" | "lexical" | "semantic" | "document";
  sourceUrl?: string | null;
  updatedAt?: string | null;
};

export type BaxterRetrievalBundle = {
  contextItems: BaxterContextItem[];
  structured: StructuredSearchResult | null;
  evidencePackage: string | null;
  queryMode: string;
  intent: string;
  plan: KnowledgeQueryPlan;
  lexicalHits: LexicalHit[];
  semanticHits: SemanticHit[];
  ranked: RankedEvidenceCandidate[];
  conflicts: Array<{ field: string; values: string[]; entryIds: string[] }>;
};

export function toBaxterContextItems(
  results: KnowledgeSearchResult[],
  options?: { limit?: number },
): BaxterContextItem[] {
  const limit = options?.limit ?? BAXTER_CONTEXT_LIMIT;
  const deduped = dedupeSearchResults(results);
  return deduped.slice(0, limit).map((result, index) => ({
    number: index + 1,
    id: result.id,
    title: result.title,
    summary: result.summary,
    contentExcerpt: truncateExcerpt(result.contentExcerpt),
    category: result.category,
    tags: result.tags,
    sourceName: result.sourceName,
    sourceUrl: result.sourceUrl,
    sourceType: result.sourceType,
    mimeType: result.mimeType,
    updatedAt: result.updatedAt,
    citationLabel: result.citationLabel,
    relevanceScore: result.relevanceScore,
  }));
}

/**
 * Remove near-duplicate KB hits (same external id / near-identical titles & excerpts).
 */
export function dedupeSearchResults(results: KnowledgeSearchResult[]): KnowledgeSearchResult[] {
  const out: KnowledgeSearchResult[] = [];
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();

  for (const result of results) {
    if (seenIds.has(result.id)) continue;
    const fingerprint = [
      normalizeSearchText(result.title),
      normalizeSearchText((result.contentExcerpt ?? "").slice(0, 120)),
      result.sourceUrl ?? "",
    ].join("|");
    if (seenFingerprints.has(fingerprint)) continue;
    seenIds.add(result.id);
    seenFingerprints.add(fingerprint);
    out.push(result);
  }
  return out;
}

export async function retrieveBaxterContext(
  question: string,
  history?: BaxterHistoryMessage[],
): Promise<BaxterContextItem[]> {
  const bundle = await retrieveBaxterEvidence(question, history);
  return bundle.contextItems;
}

/**
 * Hybrid retrieval orchestrator:
 * structured → lexical → semantic → document keyword, then rank/dedupe.
 * Exact deterministic facts always outrank vector similarity.
 */
export async function retrieveBaxterEvidence(
  question: string,
  history?: BaxterHistoryMessage[],
): Promise<BaxterRetrievalBundle> {
  const query = history?.length ? retrievalQueryFromHistory(question, history) : question;
  const plan = planKnowledgeQuery(query);

  let structured: StructuredSearchResult | null = null;
  let structuredItems: BaxterContextItem[] = [];
  let evidencePackage: string | null = null;

  const runStructured =
    plan.mode === "structured_lookup" ||
    plan.mode === "structured_aggregate" ||
    plan.mode === "hybrid" ||
    plan.intent === "structured_lookup" ||
    plan.intent === "structured_aggregation";

  if (runStructured) {
    structured = await searchStructuredKnowledge(query, plan);
    structuredItems = structuredHitsToContextItems(structured, 1);
    evidencePackage = buildStructuredEvidencePackage(structured);
  }

  const docResults = await searchApprovedKnowledge({
    query,
    limit: BAXTER_CONTEXT_LIMIT + 6,
    visibility: "internal",
  });
  const approvedEntryIds = new Set(docResults.map((r) => r.id));
  // Also include structured entry ids
  for (const hit of structured?.lookups ?? []) approvedEntryIds.add(hit.knowledgeEntryId);
  for (const hit of structured?.aggregates ?? []) approvedEntryIds.add(hit.knowledgeEntryId);

  const [embeddableUnits, rowUnits] = await Promise.all([
    listAllEmbeddableUnits().catch(() => [] as KnowledgeUnitRecord[]),
    listAllSpreadsheetRowUnits().catch(() => [] as KnowledgeUnitRecord[]),
  ]);
  const allUnits = dedupeUnits([...embeddableUnits, ...rowUnits]);

  const lexicalHits =
    plan.mode !== "structured_lookup"
      ? searchLexicalKnowledge({
          question: query,
          units: allUnits,
          approvedEntryIds,
          limit: 8,
        })
      : searchLexicalKnowledge({
          question: query,
          units: allUnits.filter((u) =>
            [
              "document_section",
              "paragraph",
              "slide",
              "image_ocr",
              "image_description",
              "pdf_page",
              "note",
            ].includes(u.unit_type),
          ),
          approvedEntryIds,
          limit: 4,
        });

  const semanticHits =
    plan.mode === "structured_lookup" && (structured?.lookups.length ?? 0) > 0
      ? []
      : await searchSemanticKnowledge({
          question: query,
          approvedEntryIds,
          limit: 8,
          memoryUnits: allUnits,
        });

  const ranked = rankAndDedupeEvidence({
    structured,
    structuredItems,
    lexicalHits,
    semanticHits,
    docResults,
  });

  const conflicts = detectHighConfidenceConflicts(structured);

  // Build context items: structured first, then ranked non-duplicates
  const seen = new Set(structuredItems.map((i) => i.id));
  const merged: BaxterContextItem[] = [...structuredItems];

  for (const candidate of ranked) {
    if (merged.length >= BAXTER_CONTEXT_LIMIT) break;
    if (candidate.channel === "structured") continue;
    if (seen.has(candidate.entryId)) continue;
    const doc = docResults.find((d) => d.id === candidate.entryId);
    if (doc) {
      merged.push({
        ...toBaxterContextItems([doc], { limit: 1 })[0]!,
        number: merged.length + 1,
        contentExcerpt: truncateExcerpt(candidate.excerpt || doc.contentExcerpt),
        relevanceScore: candidate.score,
      });
      seen.add(candidate.entryId);
      continue;
    }
    // Unit-only evidence (image/slide) without entry in docResults — still surface via synthetic item
    merged.push({
      number: merged.length + 1,
      id: candidate.entryId,
      title: candidate.title,
      summary: null,
      contentExcerpt: truncateExcerpt(candidate.excerpt),
      category: "internal",
      tags: [],
      sourceName: candidate.title,
      sourceUrl: candidate.sourceUrl ?? null,
      sourceType: "knowledge_unit",
      mimeType: null,
      updatedAt: candidate.updatedAt ?? new Date().toISOString(),
      citationLabel: candidate.title,
      relevanceScore: candidate.score,
    });
    seen.add(candidate.entryId);
  }

  // Fill remaining from doc keyword search
  const docItems = toBaxterContextItems(docResults, { limit: BAXTER_CONTEXT_LIMIT });
  for (const item of docItems) {
    if (merged.length >= BAXTER_CONTEXT_LIMIT) break;
    if (seen.has(item.id)) continue;
    merged.push({ ...item, number: merged.length + 1 });
    seen.add(item.id);
  }

  const contextItems = merged.map((item, index) => ({ ...item, number: index + 1 }));

  if (conflicts.length && evidencePackage) {
    evidencePackage += `\n\nCONFLICT NOTICE:\n${conflicts
      .map(
        (c) =>
          `Field ${c.field} has conflicting values: ${c.values.join(" vs ")} (sources: ${c.entryIds.join(", ")})`,
      )
      .join("\n")}`;
  }

  return {
    contextItems,
    structured,
    evidencePackage,
    queryMode: plan.mode,
    intent: plan.intent,
    plan,
    lexicalHits,
    semanticHits,
    ranked,
    conflicts,
  };
}

function dedupeUnits(units: KnowledgeUnitRecord[]): KnowledgeUnitRecord[] {
  const seen = new Set<string>();
  const out: KnowledgeUnitRecord[] = [];
  for (const u of units) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}

function rankAndDedupeEvidence(input: {
  structured: StructuredSearchResult | null;
  structuredItems: BaxterContextItem[];
  lexicalHits: LexicalHit[];
  semanticHits: SemanticHit[];
  docResults: KnowledgeSearchResult[];
}): RankedEvidenceCandidate[] {
  const candidates: RankedEvidenceCandidate[] = [];
  const seenUnits = new Set<string>();
  const seenEntries = new Set<string>();

  for (const hit of input.structured?.lookups ?? []) {
    candidates.push({
      entryId: hit.knowledgeEntryId,
      unitId: hit.unitId,
      unitType: "spreadsheet_row",
      title: hit.entryTitle,
      excerpt: `${hit.entityLabel} / ${hit.requestedField ?? "value"}: ${hit.directValue ?? ""}`,
      score: 1000 + hit.score,
      reason: "structured_lookup",
      channel: "structured",
      sourceUrl: hit.sourceUrl,
    });
    seenUnits.add(hit.unitId);
    seenEntries.add(hit.knowledgeEntryId);
  }
  for (const hit of input.structured?.aggregates ?? []) {
    candidates.push({
      entryId: hit.knowledgeEntryId,
      title: hit.entryTitle,
      excerpt: `${hit.operation} ${hit.field ?? ""} = ${hit.displayValue}`,
      score: 950,
      reason: "structured_aggregate",
      channel: "structured",
      sourceUrl: hit.sourceUrl,
    });
    seenEntries.add(hit.knowledgeEntryId);
  }

  for (const hit of input.lexicalHits) {
    if (seenUnits.has(hit.unit.id)) continue;
    // Structured already answered this entry with high confidence — demote lexical
    const demote = seenEntries.has(hit.unit.knowledge_entry_id) ? 0.3 : 1;
    candidates.push({
      entryId: hit.unit.knowledge_entry_id,
      unitId: hit.unit.id,
      unitType: hit.unit.unit_type,
      title: hit.unit.title ?? "Knowledge unit",
      excerpt: hit.unit.content,
      score: hit.score * demote,
      reason: hit.reason,
      channel: "lexical",
      sourceUrl: (hit.unit.metadata?.sourceUrl as string | undefined) ?? null,
    });
    seenUnits.add(hit.unit.id);
  }

  for (const hit of input.semanticHits) {
    if (seenUnits.has(hit.unit.id)) continue;
    // Never let semantic override a direct structured match on same entry
    const demote = seenEntries.has(hit.unit.knowledge_entry_id) ? 0.2 : 1;
    candidates.push({
      entryId: hit.unit.knowledge_entry_id,
      unitId: hit.unit.id,
      unitType: hit.unit.unit_type,
      title: hit.unit.title ?? "Knowledge unit",
      excerpt: hit.unit.content,
      score: hit.score * 40 * demote,
      reason: hit.reason,
      channel: "semantic",
      sourceUrl: (hit.unit.metadata?.sourceUrl as string | undefined) ?? null,
    });
    seenUnits.add(hit.unit.id);
  }

  for (const doc of input.docResults) {
    if (seenEntries.has(doc.id)) continue;
    const freshnessBoost = doc.updatedAt
      ? Math.min(5, Date.now() - Date.parse(doc.updatedAt) < 0 ? 0 : 2)
      : 0;
    candidates.push({
      entryId: doc.id,
      title: doc.title,
      excerpt: doc.contentExcerpt,
      score: (doc.relevanceScore ?? 0) + freshnessBoost,
      reason: "document_keyword",
      channel: "document",
      sourceUrl: doc.sourceUrl,
      updatedAt: doc.updatedAt,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  // Dedupe by entry keeping highest score (except allow multiple structured)
  const out: RankedEvidenceCandidate[] = [];
  const keptEntries = new Set<string>();
  for (const c of candidates) {
    if (c.channel === "structured") {
      out.push(c);
      keptEntries.add(c.entryId);
      continue;
    }
    if (keptEntries.has(c.entryId)) continue;
    keptEntries.add(c.entryId);
    out.push(c);
  }
  return out;
}

/**
 * Detect high-confidence conflicting numeric facts across structured lookups.
 */
export function detectHighConfidenceConflicts(
  structured: StructuredSearchResult | null,
): Array<{ field: string; values: string[]; entryIds: string[] }> {
  if (!structured?.lookups.length) return [];
  const byKey = new Map<string, { values: Set<string>; entryIds: Set<string> }>();
  for (const hit of structured.lookups) {
    if (!hit.requestedField || !hit.directValue) continue;
    if (hit.score < 50) continue;
    const key = `${normalizeSearchText(hit.entityLabel)}|${normalizeSearchText(hit.requestedField)}`;
    const bucket = byKey.get(key) ?? { values: new Set(), entryIds: new Set() };
    bucket.values.add(hit.directValue);
    bucket.entryIds.add(hit.knowledgeEntryId);
    byKey.set(key, bucket);
  }
  const conflicts: Array<{ field: string; values: string[]; entryIds: string[] }> = [];
  for (const [key, bucket] of byKey) {
    if (bucket.values.size > 1 && bucket.entryIds.size > 1) {
      conflicts.push({
        field: key,
        values: Array.from(bucket.values),
        entryIds: Array.from(bucket.entryIds),
      });
    }
  }
  return conflicts;
}

function truncateExcerpt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= BAXTER_MAX_EXCERPT_CHARS) return trimmed;
  return `${trimmed.slice(0, BAXTER_MAX_EXCERPT_CHARS - 1).trimEnd()}…`;
}
