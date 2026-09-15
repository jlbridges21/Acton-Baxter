/**
 * Bounded Knowledge Base expansion when the model reports insufficientKnowledge
 * but an identified entry was retrieved (wrong/short chunk).
 *
 * Single retry only; size-capped. Never loops.
 */

import "server-only";

import { getKnowledgeEntry } from "@/lib/knowledge/store";
import { formatExpandedEntryWithSuggestedAnswer } from "@/lib/knowledge/suggested-answer";
import type { BaxterContextItem, BaxterLLMOutput } from "./types";

/** Cap expanded entry body fed back into the LLM (single expansion attempt). */
export const BAXTER_EXPANDED_ENTRY_MAX_CHARS = 6000;

const EXCERPT_INSUFFICIENT_RE =
  /\b(excerpt does not include|retrieved excerpt|documented excerpt|beyond the documented|information not covered by this process|not (enough|sufficient) (approved )?(acton )?knowledge|couldn'?t find (enough |sufficient )?(detail|steps|guidance) in the (retrieved |approved )?excerpt)\b/i;

const NON_KB_SOURCE_TYPES = new Set([
  "slack",
  "gohighlevel",
  "ghl",
  "pem_neat",
  "pem",
  "rulebook",
  "capability",
  "project_registry",
  "master_project_log",
]);

export function answerSignalsInsufficientExcerpt(answer: string): boolean {
  return EXCERPT_INSUFFICIENT_RE.test(answer.trim());
}

export function isExpandableKnowledgeContextItem(item: BaxterContextItem): boolean {
  const st = (item.sourceType || "").toLowerCase();
  if (NON_KB_SOURCE_TYPES.has(st)) return false;
  if (st.includes("slack") || st.includes("ghl") || st.includes("pem")) return false;
  // Knowledge entries use UUIDs; skip synthetic ids.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id);
}

/**
 * True when we should expand identified KB entries and retry the LLM once.
 * Honors the model's insufficientKnowledge flag; also catches escalation copy
 * that admits the excerpt was incomplete while still citing a source.
 */
export function shouldExpandKnowledgeOnInsufficient(input: {
  llm: Pick<BaxterLLMOutput, "insufficientKnowledge" | "answer">;
  contextItems: BaxterContextItem[];
  alreadyExpanded: boolean;
}): boolean {
  if (input.alreadyExpanded) return false;
  const expandable = input.contextItems.filter(isExpandableKnowledgeContextItem);
  if (expandable.length === 0) return false;
  if (input.llm.insufficientKnowledge) return true;
  return answerSignalsInsufficientExcerpt(input.llm.answer);
}

/**
 * Fetch substantially more of each identified Knowledge Base entry (full body
 * when reasonably sized) and replace context excerpts. Size-capped per entry.
 */
export async function expandIdentifiedKnowledgeEntries(input: {
  contextItems: BaxterContextItem[];
  question: string;
  maxCharsPerEntry?: number;
  getEntry?: (id: string) => Promise<{ content: string; title?: string } | null>;
}): Promise<{ items: BaxterContextItem[]; expandedEntryIds: string[] }> {
  const maxChars = input.maxCharsPerEntry ?? BAXTER_EXPANDED_ENTRY_MAX_CHARS;
  const getEntry =
    input.getEntry ??
    (async (id: string) => {
      const entry = await getKnowledgeEntry(id);
      return entry ? { content: entry.content, title: entry.title } : null;
    });

  const expandedEntryIds: string[] = [];
  const items: BaxterContextItem[] = [];

  for (const item of input.contextItems) {
    if (!isExpandableKnowledgeContextItem(item)) {
      items.push(item);
      continue;
    }
    try {
      const entry = await getEntry(item.id);
      if (!entry?.content?.trim()) {
        items.push(item);
        continue;
      }
      const { excerpt, usedSuggestedAnswer } = formatExpandedEntryWithSuggestedAnswer({
        content: entry.content,
        question: input.question,
        maxChars,
      });
      expandedEntryIds.push(item.id);
      items.push({
        ...item,
        contentExcerpt: excerpt,
        // Nudge ranking metadata for diagnostics; relevance unchanged.
        summary: usedSuggestedAnswer
          ? [item.summary, "Includes author Suggested Answer for Baxter"]
              .filter(Boolean)
              .join(" — ")
          : item.summary,
      });
    } catch {
      items.push(item);
    }
  }

  return { items, expandedEntryIds };
}
