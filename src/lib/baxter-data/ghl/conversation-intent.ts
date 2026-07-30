/**
 * Pure GHL conversation-intent helpers (safe for shared routing; no server I/O).
 */

export type GhlMessageChannelFilter = "email" | "sms" | "call" | "any";
export type GhlMessageDirectionFilter = "inbound" | "outbound" | "any";

/**
 * Infer channel + direction from natural language.
 */
export function inferConversationLookupFilters(question: string): {
  channel: GhlMessageChannelFilter;
  direction: GhlMessageDirectionFilter;
} {
  const q = question.toLowerCase();
  let channel: GhlMessageChannelFilter = "any";
  if (/\b(e-?mails?)\b/.test(q) && !/\b(sms|text message)\b/.test(q)) channel = "email";
  else if (/\b(sms|text messages?|texts?)\b/.test(q)) channel = "sms";
  else if (/\b(calls?|voicemails?)\b/.test(q)) channel = "call";

  let direction: GhlMessageDirectionFilter = "any";
  if (
    /\b(we sent|sent (to|him|her|them)|outbound|from (us|acton|our team))\b/i.test(q) ||
    /\blast e-?mail we (sent|wrote)\b/i.test(q)
  ) {
    direction = "outbound";
  } else if (
    /\b(from|he emailed|she emailed|they emailed|emailed us|last e-?mail from|what did .+ (email|say|send)|inbound)\b/i.test(
      q,
    )
  ) {
    direction = "inbound";
  } else if (channel === "email" && /\b(last|latest)\s+e-?mail\b/i.test(q) && /\bfrom\b/i.test(q)) {
    direction = "inbound";
  }

  return { channel, direction };
}

/**
 * Extract a contact name / email / phone for conversation lookup questions.
 */
export function extractConversationContactQuery(question: string): string | null {
  const q = question.trim();
  const email = q.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email?.[0]) return email[0];

  const patterns = [
    /\blast\s+(?:e-?mail|message|sms|text|conversation).{0,40}\bfrom\s+([A-Za-z][A-Za-z .'-]{1,60})/i,
    /\b(?:e-?mail|message|sms|text|conversation).{0,40}\bfrom\s+([A-Za-z][A-Za-z .'-]{1,60})/i,
    /\bwhat did\s+([A-Za-z][A-Za-z .'-]{1,60})\s+(?:last\s+)?(?:e-?mail|say|send|text)/i,
    /\b(?:latest|recent|last)\s+(?:e-?mails?|messages?|conversation).{0,40}\b(?:with|for|from)\s+([A-Za-z][A-Za-z .'-]{1,60})/i,
    /\b(?:show|get|find|pull)\s+(?:me\s+)?([A-Za-z][A-Za-z .'-]{1,60})(?:'s)?\s+(?:(?:recent|latest|last)\s+)?(?:e-?mails?|messages?)/i,
    /\b([A-Za-z][A-Za-z .'-]{1,60})(?:'s)\s+(?:(?:recent|latest|last)\s+)?(?:e-?mail|message|sms|conversation)\b/i,
    /\bconversation(?:s)?\s+(?:with|for)\s+([A-Za-z][A-Za-z .'-]{1,60})/i,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (m?.[1]) {
      const cleaned = m[1]
        .replace(/\b(in\s+)?(ghl|gohighlevel|crm|go\s*high\s*level)\b/gi, "")
        .replace(/[?.,!:;]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned.length >= 2) return cleaned;
    }
  }
  return null;
}

export function isGhlConversationLookupQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (
    /\b(last|latest|recent)\s+(e-?mail|message|sms|text|conversation)\b/i.test(q) ||
    /\bwhat did\s+.+\s+(e-?mail|say|send|text)\b/i.test(q) ||
    /\b(show|get|find|pull).{0,40}\b(e-?mails?|messages?|conversation)\b/i.test(q) ||
    /\bconversation(?:s)?\s+(?:with|for|from)\b/i.test(q)
  ) {
    if (
      /\b(can you|do you|are you able)\b/i.test(q) &&
      !extractConversationContactQuery(q) &&
      !/[A-Z][a-z]+\s+[A-Z][a-z]+/.test(q) &&
      !/@/.test(q)
    ) {
      return false;
    }
    return Boolean(
      extractConversationContactQuery(q) ||
      /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(q) ||
      /@/.test(q) ||
      /\bin\s+(ghl|gohighlevel|crm)\b/i.test(q),
    );
  }
  return false;
}
