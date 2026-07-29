import type { BaxterAnswer, BaxterSourceReference } from "@/lib/baxter-ai/types";
import { deriveAnswerTypeLabel } from "@/lib/baxter-ai/classify";
import { getPublicAppBaseUrl } from "./config";

/** Slack chat.postMessage practical limit with headroom for mrkdwn. */
export const SLACK_MESSAGE_SAFE_LIMIT = 3500;

const UNSAFE_PROTOCOLS = /^(javascript|data|file|vbscript):/i;

export function escapeSlackMrkdwn(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/<!channel>/gi, "channel")
    .replace(/<!everyone>/gi, "everyone")
    .replace(/<!here>/gi, "here")
    .replace(/<@(?:[^>|]+)(?:\|[^>]+)?>/g, "@user")
    .replace(/<!(?:subteam\^)?[^>|]+(?:\|[^>]+)?>/g, "@group");
}

export function sanitizeSourceUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed || UNSAFE_PROTOCOLS.test(trimmed)) return null;

  if (
    trimmed.startsWith("/knowledge/") ||
    trimmed.startsWith("/pem-neats") ||
    trimmed.startsWith("/dashboard") ||
    trimmed.startsWith("/reports") ||
    trimmed.startsWith("/admin/") ||
    trimmed === "/"
  ) {
    const base = getPublicAppBaseUrl();
    return `${base}${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sourceTypeLabel(source: BaxterSourceReference): string {
  switch (source.sourceKind) {
    case "google_doc":
      return "Google Doc";
    case "google_sheet":
      return "Google Sheet";
    case "google_file":
      return "Google File";
    case "pem_neat":
      return "PEM NEAT";
    case "gohighlevel":
      return "GoHighLevel";
    case "rulebook":
      return "Process Rulebook";
    case "capability":
      return "Baxter";
    case "slack":
      return "Slack";
    default:
      return "Knowledge Base";
  }
}

export function formatSlackSourceLine(source: BaxterSourceReference): string {
  const absolute = sanitizeSourceUrl(source.sourceUrl);
  const when = source.lastUpdated
    ? new Date(source.lastUpdated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;
  const label = escapeSlackMrkdwn(
    [source.title || source.citationLabel, when].filter(Boolean).join(" · "),
  );

  if (source.sourceKind === "slack" && absolute && source.availability === "available") {
    return `• <${absolute}|${label}>`;
  }

  const title = escapeSlackMrkdwn(source.title || source.citationLabel);
  const type = sourceTypeLabel(source);
  if (absolute && source.availability === "available") {
    return `• <${absolute}|${title}> — ${type}`;
  }
  return `• ${title} — ${type}`;
}

function answerTypeLine(answer: BaxterAnswer): string | null {
  const label = deriveAnswerTypeLabel({
    answerMode: answer.answerMode,
    sources: answer.sources,
  });
  if (!label) return null;
  return `_Answer type: ${escapeSlackMrkdwn(label)}_`;
}

/**
 * Build Slack mrkdwn text for a Baxter answer (may be split later).
 */
export function buildBaxterSlackText(answer: BaxterAnswer): string {
  const parts: string[] = ["*Baxter*", "", escapeSlackMrkdwn(answer.answer).trim()];

  if (answer.sources.length > 0) {
    parts.push("", "*Sources*");
    for (const source of answer.sources) {
      parts.push(formatSlackSourceLine(source));
    }
  }

  const typeLine = answerTypeLine(answer);
  if (typeLine) {
    parts.push("", typeLine);
  }

  return parts.join("\n").trim();
}

export function buildBaxterSlackBlocks(answer: BaxterAnswer): unknown[] {
  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Baxter*\n${escapeSlackMrkdwn(answer.answer)}` },
    },
  ];

  if (answer.sources.length > 0) {
    const lines = answer.sources.map((source) => formatSlackSourceLine(source));
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Sources*\n${lines.join("\n")}`,
      },
    });
  }

  const typeLine = answerTypeLine(answer);
  if (typeLine) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: typeLine }],
    });
  }

  return blocks;
}

/**
 * Split long Slack messages without breaking URLs or mrkdwn links.
 */
export function splitSlackMessage(text: string, limit = SLACK_MESSAGE_SAFE_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.4) cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit * 0.4) cut = remaining.lastIndexOf(" ", limit);
    if (cut < limit * 0.4) cut = limit;

    // Avoid cutting inside a Slack link <url|label>
    const open = remaining.lastIndexOf("<", cut);
    const close = remaining.indexOf(">", open);
    if (open >= 0 && open < cut && (close < 0 || close >= cut)) {
      cut = open > limit * 0.3 ? open : cut;
    }

    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

/**
 * Prefer putting Sources in the final segment when splitting.
 */
export function buildSlackReplySegments(answer: BaxterAnswer): Array<{
  text: string;
  blocks?: unknown[];
}> {
  const fullText = buildBaxterSlackText(answer);
  const parts = splitSlackMessage(fullText);
  if (parts.length === 1) {
    return [{ text: parts[0]!, blocks: buildBaxterSlackBlocks(answer) }];
  }

  return parts.map((part, index) => ({
    text: part,
    blocks: index === parts.length - 1 ? undefined : undefined,
  }));
}
