import "server-only";

import { searchApprovedKnowledge } from "@/lib/knowledge/queries";
import { normalizeSearchText } from "@/lib/knowledge/retrieval";
import type { KnowledgeSearchResult } from "@/lib/knowledge/types";
import type { BaxterContextItem, BaxterHistoryMessage } from "./types";
import { retrievalQueryFromHistory } from "./memory";

export const BAXTER_CONTEXT_LIMIT = 6;
export const BAXTER_MAX_EXCERPT_CHARS = 700;

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
  const query = history?.length ? retrievalQueryFromHistory(question, history) : question;
  const results = await searchApprovedKnowledge({
    query,
    limit: BAXTER_CONTEXT_LIMIT + 4,
    visibility: "internal",
  });
  return toBaxterContextItems(results);
}

function truncateExcerpt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= BAXTER_MAX_EXCERPT_CHARS) return trimmed;
  return `${trimmed.slice(0, BAXTER_MAX_EXCERPT_CHARS - 1).trimEnd()}…`;
}
