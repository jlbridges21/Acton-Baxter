/**
 * Safe Slack conversation follow-up state (not a message mirror).
 * Stored in baxter_conversations.metadata.slackContext.
 */

export type SlackFollowUpRef = {
  authorName: string | null;
  channelName: string | null;
  permalink: string | null;
  messageTs: string;
  channelId: string;
};

export type SlackConversationContext = {
  topic: string | null;
  people: string[];
  channels: string[];
  timeRangeLabel: string | null;
  intent: string | null;
  /** Bounded references — no message bodies. */
  refs: SlackFollowUpRef[];
  /** Lightweight project identity for status follow-ups. */
  projectNumber?: string | null;
  projectName?: string | null;
  updatedAt: string;
};

const KEY = "slackContext";

export function readSlackConversationState(
  metadata: Record<string, unknown> | null | undefined,
): SlackConversationContext | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata[KEY];
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    topic: typeof obj.topic === "string" ? obj.topic : null,
    people: Array.isArray(obj.people) ? obj.people.map(String).slice(0, 8) : [],
    channels: Array.isArray(obj.channels) ? obj.channels.map(String).slice(0, 8) : [],
    timeRangeLabel: typeof obj.timeRangeLabel === "string" ? obj.timeRangeLabel : null,
    intent: typeof obj.intent === "string" ? obj.intent : null,
    refs: Array.isArray(obj.refs)
      ? (obj.refs as SlackFollowUpRef[]).slice(0, 8).map((r) => ({
          authorName: r.authorName ?? null,
          channelName: r.channelName ?? null,
          permalink: r.permalink ?? null,
          messageTs: String(r.messageTs ?? ""),
          channelId: String(r.channelId ?? ""),
        }))
      : [],
    projectNumber: typeof obj.projectNumber === "string" ? obj.projectNumber : null,
    projectName: typeof obj.projectName === "string" ? obj.projectName : null,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
  };
}

export function writeSlackConversationState(
  metadata: Record<string, unknown>,
  next: SlackConversationContext | null,
): Record<string, unknown> {
  const copy = { ...metadata };
  if (!next) {
    delete copy[KEY];
    return copy;
  }
  copy[KEY] = next;
  return copy;
}

export function buildSlackConversationContext(input: {
  topic?: string | null;
  people: string[];
  channels: string[];
  timeRangeLabel?: string | null;
  intent?: string | null;
  refs: SlackFollowUpRef[];
  projectNumber?: string | null;
  projectName?: string | null;
}): SlackConversationContext {
  return {
    topic: input.topic ?? null,
    people: input.people.slice(0, 8),
    channels: input.channels.slice(0, 8),
    timeRangeLabel: input.timeRangeLabel ?? null,
    intent: input.intent ?? null,
    refs: input.refs.slice(0, 8),
    projectNumber: input.projectNumber ?? null,
    projectName: input.projectName ?? null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Expand a short follow-up using prior Slack context (deterministic).
 * Explicit entities in the current question always beat inherited context.
 */
export function expandQuestionWithSlackContext(
  question: string,
  ctx: SlackConversationContext | null,
): string {
  if (!ctx) return question;
  const q = question.trim();
  if (q.length > 80 && !/\b(he|she|they|him|her|that|this|respond|reply)\b/i.test(q)) {
    return question;
  }

  // Lazy import avoided — use simple heuristics to detect explicit channel in current turn
  const hasExplicitChannel =
    /#[\w-]+/.test(q) ||
    /\b(?:in|about|from)\s+(?:the\s+)?[\w-]+(?:\s+[\w-]+)?\s+channel\b/i.test(q);
  const hasExplicitPerson =
    /\bwhat (did|has|about)\s+[A-Za-z]/i.test(q) && !/\b(he|she|they)\b/i.test(q);

  const parts = [q];
  if (ctx.people.length && !hasExplicitPerson) {
    parts.push(`(regarding ${ctx.people.join(", ")})`);
  }
  if (ctx.topic && !hasExplicitChannel) {
    parts.push(`(topic: ${ctx.topic})`);
  }
  // Never append prior channels when the current turn already names a channel
  if (ctx.channels.length && !hasExplicitChannel) {
    parts.push(`(channels: ${ctx.channels.join(", ")})`);
  }
  if (ctx.projectNumber && !/\b[A-Za-z]\d{2}-\d{4,6}\b/i.test(q)) {
    parts.push(`(project ${ctx.projectNumber})`);
  }
  if (
    ctx.projectName &&
    !new RegExp(`\\b${ctx.projectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(q)
  ) {
    parts.push(`(${ctx.projectName} project)`);
  }
  if (ctx.timeRangeLabel) parts.push(`(${ctx.timeRangeLabel})`);
  return parts.join(" ");
}
