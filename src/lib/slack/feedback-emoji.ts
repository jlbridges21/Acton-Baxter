/**
 * Pure helpers for Baxter Slack thumbs-feedback reactions.
 * No I/O — safe for unit tests without server-only.
 */

import type { BaxterFeedbackRating } from "@/lib/baxter-ai/feedback-types";

/** Strip Slack skin-tone modifiers (`+1::skin-tone-3` → `+1`). */
export function normalizeSlackReactionName(reaction: string): string {
  const raw = reaction.trim().toLowerCase();
  if (!raw) return "";
  const base = raw.split("::")[0] ?? raw;
  return base.trim();
}

/** Map a Slack reaction name to Baxter thumbs rating, or null if not a thumbs emoji. */
export function ratingFromSlackReaction(reaction: string): BaxterFeedbackRating | null {
  const base = normalizeSlackReactionName(reaction);
  if (base === "+1" || base === "thumbsup") return "up";
  if (base === "-1" || base === "thumbsdown") return "down";
  return null;
}
