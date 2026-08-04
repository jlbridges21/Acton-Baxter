/**
 * Convert Slack mrkdwn message text into employee-facing plain text.
 * Resolves <@USERID> when a name map is provided; never leaves raw mailto/url markup.
 */

export type SlackUserNameLookup = (slackUserId: string) => string | null | undefined;

function lookupName(
  id: string,
  names?: Map<string, string> | Record<string, string> | SlackUserNameLookup,
): string | null {
  if (!names) return null;
  if (typeof names === "function") return names(id)?.trim() || null;
  if (names instanceof Map)
    return names.get(id)?.trim() || names.get(id.toUpperCase())?.trim() || null;
  return names[id]?.trim() || names[id.toUpperCase()]?.trim() || null;
}

/**
 * Slack mrkdwn → readable plain text for answers and LLM evidence.
 */
export function slackMrkdwnToPlainText(
  text: string,
  userNames?: Map<string, string> | Record<string, string> | SlackUserNameLookup,
): string {
  if (!text) return "";
  let out = text;

  // User mentions: <@U123> or <@U123|Label>
  out = out.replace(/<@([UW][A-Z0-9_]+)(?:\|([^>]+))?>/gi, (_m, id: string, label?: string) => {
    const fromLabel = label?.trim();
    if (fromLabel) return fromLabel;
    const resolved = lookupName(String(id), userNames);
    if (resolved) return resolved;
    return `Slack user ${id}`;
  });

  // Channel mentions: <#C123|name> or <#C123>
  out = out.replace(/<#([CGD][A-Z0-9_]+)(?:\|([^>]+))?>/gi, (_m, id: string, label?: string) => {
    const name = label?.trim().replace(/^#/, "");
    if (name) return `#${name}`;
    return `#${id}`;
  });

  // mailto: <mailto:addr|label> or <mailto:addr>
  out = out.replace(/<mailto:([^|>\s]+)(?:\|([^>]+))?>/gi, (_m, addr: string, label?: string) => {
    const pretty = label?.trim();
    return pretty || String(addr).trim();
  });

  // Links: <https://…|label> or <https://…>
  out = out.replace(/<(https?:\/\/[^|>]+)(?:\|([^>]+))?>/gi, (_m, url: string, label?: string) => {
    const pretty = label?.trim();
    return pretty || String(url).trim();
  });

  // Special mentions
  out = out.replace(/<!subteam\^[^|>]+(?:\|([^>]+))?>/gi, (_m, label?: string) =>
    label?.trim() ? label.trim() : "a group",
  );
  out = out.replace(/<!here>/gi, "@here");
  out = out.replace(/<!channel>/gi, "@channel");
  out = out.replace(/<!everyone>/gi, "@everyone");
  out = out.replace(/<!date\^[^^>]+\^([^|>]+)(?:\|[^>]*)?>/gi, (_m, fallback: string) =>
    String(fallback).trim(),
  );

  // HTML entities Slack uses in text
  out = out.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

  return out
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Truncate without cutting mid-word. Prefer ending on a sentence when possible.
 */
export function truncateAtWordBoundary(text: string, maxLen: number): string {
  const cleaned = text.trim();
  if (maxLen <= 0 || cleaned.length <= maxLen) return cleaned;

  const slice = cleaned.slice(0, maxLen);
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (sentenceEnd >= Math.floor(maxLen * 0.45)) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }

  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace >= Math.floor(maxLen * 0.5) ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/** First complete sentence (or word-bounded snippet) for summaries. */
export function firstReadableSentence(text: string, maxLen = 200): string {
  const cleaned = text.trim();
  if (!cleaned) return "";
  const match = cleaned.match(/^[\s\S]{1,400}?[.!?](?=\s|$)/);
  if (match && match[0].length <= maxLen) return match[0].trim();
  return truncateAtWordBoundary(cleaned, maxLen);
}
