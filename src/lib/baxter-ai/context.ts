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

export const BAXTER_CONTEXT_LIMIT = 6;
export const BAXTER_MAX_EXCERPT_CHARS = 900;

export type BaxterRetrievalBundle = {
  contextItems: BaxterContextItem[];
  structured: StructuredSearchResult | null;
  evidencePackage: string | null;
  queryMode: string;
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
 * Hybrid retrieval: structured lookup/aggregate + document keyword search.
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

  if (plan.mode !== "document") {
    structured = await searchStructuredKnowledge(query, plan);
    structuredItems = structuredHitsToContextItems(structured, 1);
    evidencePackage = buildStructuredEvidencePackage(structured);
  }

  const docResults = await searchApprovedKnowledge({
    query,
    limit: BAXTER_CONTEXT_LIMIT + 4,
    visibility: "internal",
  });
  const docItems = toBaxterContextItems(docResults, { limit: BAXTER_CONTEXT_LIMIT });

  // Prefer structured hits first; fill remaining slots with docs not already cited
  const seen = new Set(structuredItems.map((i) => i.id));
  const merged: BaxterContextItem[] = [...structuredItems];
  for (const item of docItems) {
    if (merged.length >= BAXTER_CONTEXT_LIMIT) break;
    if (seen.has(item.id)) {
      // Enrich existing structured item's excerpt if document excerpt is longer? keep structured
      continue;
    }
    merged.push({ ...item, number: merged.length + 1 });
    seen.add(item.id);
  }

  // Renumber
  const contextItems = merged.map((item, index) => ({ ...item, number: index + 1 }));

  return {
    contextItems,
    structured,
    evidencePackage,
    queryMode: plan.mode,
  };
}

function truncateExcerpt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= BAXTER_MAX_EXCERPT_CHARS) return trimmed;
  return `${trimmed.slice(0, BAXTER_MAX_EXCERPT_CHARS - 1).trimEnd()}…`;
}
