import type { BaxterHistoryMessage } from "./types";
import { decideConversationContext, extractPriorEntitiesFromHistory } from "./conversation-context";

/**
 * Expand short / pronoun-heavy follow-ups for the LLM prompt only.
 * Does NOT append prior entity text into retrieval queries blindly.
 */
export function expandQuestionWithHistory(
  question: string,
  history: BaxterHistoryMessage[],
): string {
  const trimmed = question.trim();
  if (!trimmed || history.length === 0) return trimmed;

  const decision = decideConversationContext(trimmed, history);
  if (!decision.inheritPriorEntities) return trimmed;

  const recent = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Employee" : "Baxter"}: ${m.content}`)
    .join("\n");

  return [
    "Follow-up question in an ongoing conversation.",
    "Resolve pronouns (she/he/they/it/that) using the recent turns below.",
    "Do not invent a new subject if the follow-up clearly refers to the prior entity.",
    "",
    "Recent turns:",
    recent,
    "",
    "Current follow-up:",
    trimmed,
  ].join("\n");
}

export type RetrievalQueryResult = {
  query: string;
  inheritEntities: string[];
  decision: ReturnType<typeof decideConversationContext>;
};

/**
 * Compact query for KB / structured retrieval.
 * New subjects, aggregations, and time filters do NOT inherit prior entities.
 */
export function retrievalQueryFromHistory(
  question: string,
  history: BaxterHistoryMessage[],
): string {
  return buildRetrievalQuery(question, history).query;
}

export function buildRetrievalQuery(
  question: string,
  history: BaxterHistoryMessage[],
): RetrievalQueryResult {
  const trimmed = question.trim();
  const decision = decideConversationContext(trimmed, history);
  if (!trimmed || history.length === 0) {
    return { query: trimmed, inheritEntities: [], decision };
  }

  if (!decision.inheritPriorEntities) {
    return { query: trimmed, inheritEntities: [], decision };
  }

  const inheritEntities = extractPriorEntitiesFromHistory(history);
  // Prefer appending entity names only — not the full prior answer — to avoid bleed
  const parts = [trimmed];
  if (inheritEntities.length) {
    parts.push(`(regarding ${inheritEntities.join(", ")})`);
  } else {
    const priorUser = [...history]
      .reverse()
      .find((m) => m.role === "user" && m.content.trim().length > 0);
    if (priorUser) parts.push(priorUser.content.slice(0, 160));
  }

  return {
    query: parts.join(" "),
    inheritEntities,
    decision,
  };
}
