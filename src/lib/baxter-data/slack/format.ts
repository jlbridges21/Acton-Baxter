import type { SlackMessageEvidence } from "./types";

/** Admin/sandbox-safe formatting — short excerpts only. */
export function formatSlackEvidenceExcerpt(
  item: SlackMessageEvidence,
  maxLen = 160,
): {
  author: string;
  channel: string;
  timestamp: string;
  excerpt: string;
  permalink: string | null;
  viewInSlackLabel: string;
} {
  const excerpt = item.text.length > maxLen ? `${item.text.slice(0, maxLen - 1)}…` : item.text;
  return {
    author: item.authorName || "Unknown",
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
