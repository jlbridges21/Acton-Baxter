import "server-only";

import { filterAndRankApprovedKnowledge } from "./retrieval";
import { listAllKnowledgeEntriesForRetrieval } from "./store";
import type { KnowledgeSearchInput, KnowledgeSearchResult } from "./types";

export {
  listKnowledgeEntries,
  getKnowledgeEntry,
  listKnowledgeEntryRevisions,
  listKnowledgeSources,
} from "./store";

/**
 * Employee-facing retrieval for future Slack/LLM.
 * Only approved internal entries. Never drafts, archived, or admin_only.
 */
export async function searchApprovedKnowledge(
  input: KnowledgeSearchInput,
): Promise<KnowledgeSearchResult[]> {
  const entries = await listAllKnowledgeEntriesForRetrieval();
  return filterAndRankApprovedKnowledge(entries, {
    ...input,
    visibility: "internal",
  });
}
