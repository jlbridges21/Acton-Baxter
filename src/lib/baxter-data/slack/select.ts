import { buildDecisionCandidate, rankDecisionEvidence } from "./decisions";
import { evidenceBudgetForIntent, filterSlackEvidenceNoise } from "./filter";
import type { SlackMessageEvidence, SlackQueryPlan, SlackSearchIntent } from "./types";

const DECISION_MARKERS =
  /\b(agreed|let'?s |we'?ll |we will|decided|approved|final|moving forward|confirmed|locked in|remove the wait|going with)\b/i;
const SUGGESTION_MARKERS = /\b(maybe|might|could|should we|consider|thinking about|suggest)\b/i;

const PROJECT_UPDATE_SIGNALS =
  /\b(update|status|blocker|blocked|permit|submittal|inspection|quote|utilities|utility|design|construction|client|vendor|subcontractor|city|jurisdiction|decision|next step|owner|owns|signable|approval|approved|routing|timeline|schedule|delay|waiting|need|needs|request|requested|summary|edited|revision)\b/i;

export type SlackEvidenceStrength = "decision" | "implementation" | "suggestion" | "statement";

export function classifySlackStatementStrength(text: string): SlackEvidenceStrength {
  if (/\b(updated the calendar|changed to|moved to|set to|i updated it)\b/i.test(text)) {
    return "implementation";
  }
  if (SUGGESTION_MARKERS.test(text)) return "suggestion";
  if (DECISION_MARKERS.test(text)) return "decision";
  return "statement";
}

export function isMeaningfulProjectUpdate(text: string): boolean {
  const t = text.trim();
  if (t.length < 24) return false;
  if (/^(ok|okay|thanks|thank you|ty|np|👍|✅|got it|sounds good|sg|lgtm)\.?$/i.test(t)) {
    return false;
  }
  return PROJECT_UPDATE_SIGNALS.test(t) || t.length >= 80;
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

  if (plan.intent === "project_status" && isMeaningfulProjectUpdate(item.text)) {
    score += 35;
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
 * Uses intent-specific budgets, noise filtering, and decision ranking.
 */
export function selectSlackEvidenceForModel(
  results: SlackMessageEvidence[],
  plan: SlackQueryPlan,
  maxItems?: number,
): SlackMessageEvidence[] {
  const intent: SlackSearchIntent = plan.intent;
  const budget = maxItems ?? evidenceBudgetForIntent(intent);
  let working = filterSlackEvidenceNoise(results, { intent });

  if (intent === "latest_message") {
    working.sort((a, b) => {
      const ta = Date.parse(a.timestamp ?? "") || 0;
      const tb = Date.parse(b.timestamp ?? "") || 0;
      if (tb !== ta) return tb - ta;
      return String(b.messageTs).localeCompare(String(a.messageTs));
    });
    return working.slice(0, 1);
  }

  if (intent === "decision_search") {
    const candidate = buildDecisionCandidate(plan.keywords.join(" ") || "decision", working);
    const ranked = rankDecisionEvidence(working);
    const preferred = [
      candidate.decisionMessage,
      candidate.reversedBy,
      candidate.implementationMessage,
      candidate.agreementMessage,
      candidate.proposalMessage,
    ].filter(Boolean) as SlackMessageEvidence[];
    const seen = new Set(preferred.map((m) => `${m.channelId}:${m.messageTs}`));
    working = [...preferred, ...ranked.filter((m) => !seen.has(`${m.channelId}:${m.messageTs}`))];
    return working.slice(0, budget);
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

  if (intent === "project_status") {
    working.sort((a, b) => {
      const ta = Date.parse(a.timestamp ?? "") || 0;
      const tb = Date.parse(b.timestamp ?? "") || 0;
      if (tb !== ta) return tb - ta;
      return scoreEvidence(b, plan) - scoreEvidence(a, plan);
    });
    const meaningful = working.filter((m) => isMeaningfulProjectUpdate(m.text));
    const selected = meaningful.length ? meaningful : working;
    return selected.slice(0, budget);
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

  return working.slice(0, budget);
}
