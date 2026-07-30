/**
 * Decide when Slack live search should run for a Baxter question.
 */

import { detectSlackSearchIntent } from "./intent";
import type { SlackSearchIntent } from "./types";

export type SlackSearchRole = "primary" | "fallback" | "skip";

const STRONG_SLACK_SIGNALS =
  /\b(said|says|saying|mentioned|mention|talked about|talk about|discussed|discussion|conversation|conversations|slack|channel|message|messages|last message|latest|recent|recently|yesterday|last week|this week|this morning|who said|who mentioned|when did we decide|did anyone|what happened|where did we leave off|catch me up|summarize\s+#|in #\w+|update|status|right now|today)\b/i;

const APPROVED_PROCESS_SIGNALS =
  /\b(official|policy|procedure|standard|required|how should|process rulebook)\b/i;

const DEFINITIONAL_NO_SLACK = /\b(what is an? |what are |define |definition of |explain what )\b/i;

export function detectSlackSearchRole(input: {
  question: string;
  hasOtherStrongEvidence?: boolean;
  followUpSlackContext?: boolean;
}): SlackSearchRole {
  const q = input.question.trim();
  if (!q) return "skip";

  if (input.followUpSlackContext) {
    // Short follow-ups like "Did Kevin respond?" / "What did he say?"
    if (
      /\b(respond|response|reply|replied|he|she|they|that|this|him|her)\b/i.test(q) ||
      q.split(/\s+/).length <= 8
    ) {
      return "primary";
    }
  }

  const intent = detectSlackSearchIntent(q);
  const strongIntent: SlackSearchIntent[] = [
    "person_statement",
    "latest_message",
    "decision_search",
    "mention_search",
    "time_window_summary",
    "conversation_recall",
    "channel_search",
    "latest_update",
    "project_status",
    "thread_context",
  ];

  // Project-status is always Slack-primary when detected (exact channel / project # / job name).
  if (intent === "project_status") {
    return "primary";
  }

  if (strongIntent.includes(intent) && STRONG_SLACK_SIGNALS.test(q)) {
    return "primary";
  }

  if (STRONG_SLACK_SIGNALS.test(q)) {
    // Official process questions: Slack supplements, does not lead
    if (APPROVED_PROCESS_SIGNALS.test(q)) return "fallback";
    return "primary";
  }

  if (DEFINITIONAL_NO_SLACK.test(q) && !STRONG_SLACK_SIGNALS.test(q)) {
    return "skip";
  }

  // Current-status questions without other evidence → fallback Slack
  if (
    /\b(latest|current|status|update|right now|where are we|when will|when is|be ready|ready for)\b/i.test(
      q,
    )
  ) {
    return input.hasOtherStrongEvidence ? "fallback" : "primary";
  }

  return "skip";
}

export function isStrongSlackQuestion(question: string): boolean {
  return detectSlackSearchRole({ question }) === "primary";
}
