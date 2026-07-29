/**
 * Hard integrity filters — wrong-channel / wrong-author evidence must never reach the model.
 */

import type { SlackMessageEvidence, SlackQueryPlan } from "./types";

export type IntegrityFilterResult = {
  kept: SlackMessageEvidence[];
  dropped: number;
  reasons: string[];
};

/**
 * When the plan explicitly resolved channels, drop any evidence outside those IDs.
 * When the plan explicitly resolved people for person-scoped intents, drop other authors.
 * When timeRange is set, drop evidence outside the window.
 */
export function filterEvidenceByPlanIntegrity(
  results: SlackMessageEvidence[],
  plan: SlackQueryPlan,
): IntegrityFilterResult {
  const reasons: string[] = [];
  let working = results;

  if (plan.channels.length > 0) {
    const allowed = new Set(plan.channels.map((c) => c.id));
    const before = working.length;
    working = working.filter((item) => allowed.has(item.channelId));
    const dropped = before - working.length;
    if (dropped > 0) {
      reasons.push(
        `integrity: dropped ${dropped} message(s) outside requested channel(s) ${plan.channels
          .map((c) => c.displayLabel)
          .join(", ")}`,
      );
    }
  }

  const personScoped =
    plan.intent === "latest_message" ||
    plan.intent === "person_statement" ||
    (plan.people.length > 0 &&
      (plan.intent === "channel_search" || plan.intent === "topic_search"));

  if (personScoped && plan.people.length > 0) {
    const allowedAuthors = new Set(plan.people.map((p) => p.id));
    const before = working.length;
    working = working.filter((item) => {
      if (!item.authorId) return false;
      return allowedAuthors.has(item.authorId);
    });
    const dropped = before - working.length;
    if (dropped > 0) {
      reasons.push(
        `integrity: dropped ${dropped} message(s) not from requested author(s) ${plan.people
          .map((p) => p.displayName)
          .join(", ")}`,
      );
    }
  }

  if (plan.timeRange && plan.intent !== "latest_message") {
    const from = plan.timeRange.from.getTime();
    const to = plan.timeRange.to.getTime();
    const before = working.length;
    working = working.filter((item) => {
      if (!item.timestamp) return true;
      const t = Date.parse(item.timestamp);
      if (!Number.isFinite(t)) return true;
      return t >= from && t <= to;
    });
    const dropped = before - working.length;
    if (dropped > 0) {
      reasons.push(
        `integrity: dropped ${dropped} message(s) outside time range ${plan.timeRange.label}`,
      );
    }
  }

  return { kept: working, dropped: results.length - working.length, reasons };
}

/** True when the question extracted an explicit channel that must constrain retrieval. */
export function isChannelScopedIntent(intent: string): boolean {
  return (
    intent === "latest_message" ||
    intent === "channel_search" ||
    intent === "time_window_summary" ||
    intent === "conversation_recall"
  );
}
