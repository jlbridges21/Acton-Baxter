/**
 * Noise / bot / near-duplicate filtering for Slack evidence selection.
 */

import type { SlackMessageEvidence } from "./types";

const SOCIAL_NOISE =
  /\b(happy birthday|birthday|lunch|coffee|happy hour|congrats|congratulations|lol|haha|😂|🎉)\b/i;
const ACK_ONLY = /^(ok|okay|thanks|thank you|ty|np|👍|✅|got it|sounds good|sg|lgtm)\.?$/i;

export function isLikelyBotAuthor(item: SlackMessageEvidence): boolean {
  const name = (item.authorName ?? "").toLowerCase();
  if (!name) return false;
  if (/\bbot\b|workflow|gohighlevel|calendar|slackbot|incoming-webhook/.test(name)) return true;
  if (/^baxter$/i.test(item.authorName ?? "")) return true;
  return false;
}

export function isBaxterSelfMessage(item: SlackMessageEvidence): boolean {
  const name = (item.authorName ?? "").trim();
  return /^baxter$/i.test(name) || /\bbaxter\b/i.test(name);
}

export function isSocialNoise(text: string): boolean {
  if (ACK_ONLY.test(text.trim())) return true;
  if (text.trim().length < 12 && SOCIAL_NOISE.test(text)) return true;
  if (SOCIAL_NOISE.test(text) && text.trim().length < 80) return true;
  return false;
}

function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * Filter bots (downrank/remove Baxter self), social noise for summaries, and near-duplicates.
 */
export function filterSlackEvidenceNoise(
  items: SlackMessageEvidence[],
  options?: {
    intent?: string;
    allowBots?: boolean;
    dropBaxterSelf?: boolean;
  },
): SlackMessageEvidence[] {
  const intent = options?.intent ?? "";
  const dropBaxter = options?.dropBaxterSelf !== false;
  const allowBots = options?.allowBots === true;
  const isSummary =
    intent === "time_window_summary" ||
    intent === "channel_search" ||
    intent === "conversation_recall" ||
    intent === "project_status";

  const seen = new Set<string>();
  const out: SlackMessageEvidence[] = [];

  for (const item of items) {
    if (dropBaxter && isBaxterSelfMessage(item)) continue;
    if (
      !allowBots &&
      isLikelyBotAuthor(item) &&
      !/\b(assigned|stage|opportunity|meeting)\b/i.test(item.text)
    ) {
      continue;
    }
    if (isSummary && isSocialNoise(item.text)) continue;

    const dedupeKey = `${item.channelId}:${normalizeForDedupe(item.text)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // Exact id dedupe
    const idKey = `${item.channelId}:${item.messageTs}`;
    if (seen.has(`id:${idKey}`)) continue;
    seen.add(`id:${idKey}`);

    out.push(item);
  }

  return out;
}

export function evidenceBudgetForIntent(intent: string): number {
  switch (intent) {
    case "latest_message":
      return 1;
    case "latest_update":
      return 6;
    case "project_status":
      return 8;
    case "person_statement":
    case "decision_search":
      return 8;
    case "mention_search":
      return 10;
    case "time_window_summary":
    case "conversation_recall":
    case "channel_search":
      return 12;
    case "thread_context":
      return 8;
    default:
      return 8;
  }
}
