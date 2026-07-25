import type { BaxterHistoryMessage } from "./types";

const FOLLOW_UP =
  /\b(it|that|those|this|them|they|these|the (same|previous|last)|tell me more|what about|and (also|what)|how about|why|when|who)\b/i;

/**
 * Expand short / pronoun-heavy follow-ups using recent conversation turns
 * so retrieval and the model share the same resolved intent.
 */
export function expandQuestionWithHistory(
  question: string,
  history: BaxterHistoryMessage[],
): string {
  const trimmed = question.trim();
  if (!trimmed) return trimmed;
  if (history.length === 0) return trimmed;
  if (!FOLLOW_UP.test(trimmed) && trimmed.split(/\s+/).length > 8) return trimmed;

  const recent = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Employee" : "Baxter"}: ${m.content}`)
    .join("\n");

  return [
    "Follow-up question in an ongoing conversation.",
    "Resolve pronouns (it/that/those/this) using the recent turns below.",
    "",
    "Recent turns:",
    recent,
    "",
    "Current follow-up:",
    trimmed,
  ].join("\n");
}

/** Compact query for KB search (not the full LLM prompt expansion). */
export function retrievalQueryFromHistory(
  question: string,
  history: BaxterHistoryMessage[],
): string {
  const trimmed = question.trim();
  if (!trimmed || history.length === 0) return trimmed;
  if (!FOLLOW_UP.test(trimmed) && trimmed.split(/\s+/).length > 6) return trimmed;

  const priorUser = [...history]
    .reverse()
    .find((m) => m.role === "user" && m.content.trim().length > 0);
  const priorAssistant = [...history]
    .reverse()
    .find((m) => m.role === "assistant" && m.content.trim().length > 0);

  const parts = [trimmed];
  if (priorUser) parts.push(priorUser.content.slice(0, 240));
  if (priorAssistant) {
    // Prefer first sentence of prior answer for topical anchors
    const first = priorAssistant.content.split(/[.!?\n]/)[0]?.trim();
    if (first) parts.push(first.slice(0, 160));
  }
  return parts.join(" ");
}
