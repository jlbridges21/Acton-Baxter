import { slackUserFallbackLabel } from "@/lib/slack/display-names";
import {
  firstReadableSentence,
  slackMrkdwnToPlainText,
  truncateAtWordBoundary,
} from "./mrkdwn-plain";
import type { SlackMessageEvidence } from "./types";

/** Admin/sandbox-safe formatting — short excerpts only. */
export function formatSlackEvidenceExcerpt(
  item: SlackMessageEvidence,
  maxLen = 160,
  userNames?: Map<string, string> | Record<string, string>,
): {
  author: string;
  channel: string;
  timestamp: string;
  excerpt: string;
  permalink: string | null;
  viewInSlackLabel: string;
} {
  const plain = slackMrkdwnToPlainText(item.text, userNames);
  const excerpt = truncateAtWordBoundary(plain, maxLen);
  const author =
    item.authorName?.trim() && !/^unknown$/i.test(item.authorName.trim())
      ? item.authorName.trim()
      : slackUserFallbackLabel(item.authorId);
  return {
    author,
    channel: item.channelName ? `#${item.channelName.replace(/^#/, "")}` : "Slack",
    timestamp: item.timestamp ?? "",
    excerpt,
    permalink: item.permalink,
    viewInSlackLabel: "View in Slack",
  };
}

export function formatSlackEvidenceForAdmin(results: SlackMessageEvidence[]) {
  return results.map((item) => formatSlackEvidenceExcerpt(item));
}

function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return null;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Summarize recent project-channel messages into a short employee-facing block.
 * Uses resolved names + plain text; never dumps raw mrkdwn or mid-word truncations.
 */
export function summarizeProjectChannelActivity(input: {
  channelDisplay: string;
  messages: Array<{ author: string; text: string; timestamp: string | null }>;
}): string {
  const rows = input.messages
    .map((m) => ({
      author: m.author.trim() || "A teammate",
      text: firstReadableSentence(m.text, 180),
      date: formatShortDate(m.timestamp),
    }))
    .filter((m) => m.text.length > 0)
    .slice(0, 4);

  if (rows.length === 0) {
    return `\n\nNo recent messages found in ${input.channelDisplay}.`;
  }

  const pieces = rows.map((row) => {
    const when = row.date ? ` (${row.date})` : "";
    const body = row.text.replace(/\.*$/, "");
    return `${row.author}${when} — ${body}`;
  });

  if (pieces.length === 1) {
    return `\n\nRecent activity in ${input.channelDisplay}: ${pieces[0]}.`;
  }

  // Short prose when 2–3 items; clean bullets when denser.
  if (pieces.length <= 3) {
    const [first, ...rest] = pieces;
    const joined =
      rest.length === 1
        ? `${first}; ${rest[0]}`
        : `${first}; ${rest.slice(0, -1).join("; ")}; and ${rest[rest.length - 1]}`;
    return `\n\nRecent activity in ${input.channelDisplay}: ${joined}.`;
  }

  return `\n\nRecent activity in ${input.channelDisplay}:\n${pieces.map((p) => `• ${p}.`).join("\n")}`;
}
