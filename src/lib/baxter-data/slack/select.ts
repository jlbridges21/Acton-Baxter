import type { SlackMessageEvidence, SlackQueryPlan, SlackSearchIntent } from "./types";

const DECISION_MARKERS =
  /\b(agreed|let'?s |we'?ll |we will|decided|approved|final|moving forward|confirmed|locked in|updated the calendar|going with)\b/i;
const SUGGESTION_MARKERS =
  /\b(maybe|might|could|should we|what if|consider|thinking about|suggest)\b/i;

export type SlackEvidenceStrength = "decision" | "implementation" | "suggestion" | "statement";

export function classifySlackStatementStrength(text: string): SlackEvidenceStrength {
  if (/\b(updated the calendar|changed to|moved to|set to)\b/i.test(text)) {
    return "implementation";
  }
  if (DECISION_MARKERS.test(text) && !SUGGESTION_MARKERS.test(text)) return "decision";
  if (SUGGESTION_MARKERS.test(text)) return "suggestion";
  if (DECISION_MARKERS.test(text)) return "decision";
  return "statement";
}

function scoreEvidence(item: SlackMessageEvidence, plan: SlackQueryPlan): number {
  let score = item.relevance ?? 0;
  const text = item.text.toLowerCase();

  for (const person of plan.people) {
    if (item.authorId === person.id || item.authorName === person.displayName) score += 40;
  }
  for (const channel of plan.channels) {
    if (item.channelId === channel.id) score += 25;
  }
  for (const kw of plan.keywords) {
    if (text.includes(kw.toLowerCase())) score += 8;
  }
  for (const phrase of plan.phrases) {
    if (text.includes(phrase.toLowerCase())) score += 15;
  }

  if (plan.intent === "decision_search") {
    const strength = classifySlackStatementStrength(item.text);
    if (strength === "decision" || strength === "implementation") score += 30;
    if (strength === "suggestion") score -= 10;
  }

  if (plan.sort === "newest" && item.timestamp) {
    const t = Date.parse(item.timestamp);
    if (Number.isFinite(t)) score += Math.min(20, t / 1e12);
  }

  if (item.contextMessages.length > 0) score += 5;
  if (item.permalink) score += 2;

  return score;
}

/**
 * Rank and bound Slack evidence before it reaches the model.
 */
export function selectSlackEvidenceForModel(
  results: SlackMessageEvidence[],
  plan: SlackQueryPlan,
  maxItems = 10,
): SlackMessageEvidence[] {
  const intent: SlackSearchIntent = plan.intent;
  let working = [...results];

  if (intent === "latest_message") {
    return working.slice(0, 1);
  }

  if (intent === "mention_search") {
    const seen = new Set<string>();
    working = working.filter((item) => {
      const key = `${item.authorId ?? item.authorName}:${item.text.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  working.sort((a, b) => scoreEvidence(b, plan) - scoreEvidence(a, plan));

  if (intent === "latest_update" || plan.sort === "newest") {
    working.sort((a, b) => {
      const ta = Date.parse(a.timestamp ?? "") || 0;
      const tb = Date.parse(b.timestamp ?? "") || 0;
      if (tb !== ta) return tb - ta;
      return scoreEvidence(b, plan) - scoreEvidence(a, plan);
    });
  }

  return working.slice(0, maxItems);
}
