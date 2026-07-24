import "server-only";

import { searchApprovedKnowledge } from "@/lib/knowledge/queries";
import type { KnowledgeSearchResult } from "@/lib/knowledge/types";
import type { BaxterContextItem } from "./types";

export const BAXTER_CONTEXT_LIMIT = 6;
export const BAXTER_MAX_EXCERPT_CHARS = 700;

export function toBaxterContextItems(
  results: KnowledgeSearchResult[],
  options?: { limit?: number },
): BaxterContextItem[] {
  const limit = options?.limit ?? BAXTER_CONTEXT_LIMIT;
  return results.slice(0, limit).map((result, index) => ({
    number: index + 1,
    id: result.id,
    title: result.title,
    summary: result.summary,
    contentExcerpt: truncateExcerpt(result.contentExcerpt),
    category: result.category,
    tags: result.tags,
    sourceName: result.sourceName,
    sourceUrl: result.sourceUrl,
    updatedAt: result.updatedAt,
    citationLabel: result.citationLabel,
    relevanceScore: result.relevanceScore,
  }));
}

export async function retrieveBaxterContext(question: string): Promise<BaxterContextItem[]> {
  const results = await searchApprovedKnowledge({
    query: question,
    limit: BAXTER_CONTEXT_LIMIT,
    visibility: "internal",
  });
  return toBaxterContextItems(results);
}

function truncateExcerpt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= BAXTER_MAX_EXCERPT_CHARS) return trimmed;
  return `${trimmed.slice(0, BAXTER_MAX_EXCERPT_CHARS - 1).trimEnd()}…`;
}
