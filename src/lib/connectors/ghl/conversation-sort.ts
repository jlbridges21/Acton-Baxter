/**
 * Shared GHL conversation / message sort helpers (safe for client + server).
 */
import type { GhlConversation, GhlMessage } from "@/lib/connectors/ghl/types";

export function messageTimestampMs(message: Pick<GhlMessage, "dateAdded">): number {
  if (!message.dateAdded) return 0;
  const raw = message.dateAdded;
  if (/^\d+$/.test(raw.trim())) {
    const n = Number(raw);
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Newest → oldest by dateAdded, with stable message-id tie-breaker.
 */
export function sortMessagesNewestFirst(messages: GhlMessage[]): GhlMessage[] {
  return [...messages].sort((a, b) => {
    const delta = messageTimestampMs(b) - messageTimestampMs(a);
    if (delta !== 0) return delta;
    return String(a.id).localeCompare(String(b.id));
  });
}

/** Prefer lastMessageAt, then dateUpdated, then dateAdded. */
export function conversationActivityTimestampMs(
  conversation: Pick<GhlConversation, "lastMessageAt" | "dateUpdated" | "dateAdded" | "id">,
): number {
  for (const raw of [
    conversation.lastMessageAt,
    conversation.dateUpdated,
    conversation.dateAdded,
  ]) {
    if (!raw) continue;
    if (/^\d+$/.test(String(raw).trim())) {
      const n = Number(raw);
      return n < 1e12 ? n * 1000 : n;
    }
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/** Newest activity first; stable id tie-breaker. */
export function sortConversationsNewestFirst(conversations: GhlConversation[]): GhlConversation[] {
  return [...conversations].sort((a, b) => {
    const delta = conversationActivityTimestampMs(b) - conversationActivityTimestampMs(a);
    if (delta !== 0) return delta;
    return String(a.id).localeCompare(String(b.id));
  });
}

export type TimelineMessageLike = {
  id: string;
  dateAdded?: string | null;
};

function timelineSortKey(message: TimelineMessageLike): number {
  return messageTimestampMs({ dateAdded: message.dateAdded ?? null });
}

/** Newest → oldest; stable id tie-breaker; dedupe by id (incoming wins). */
export function mergeConversationTimelineNewestFirst<T extends TimelineMessageLike>(
  existing: T[],
  incoming: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const m of [...existing, ...incoming]) {
    if (!m?.id) continue;
    byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => {
    const delta = timelineSortKey(b) - timelineSortKey(a);
    if (delta !== 0) return delta;
    return String(a.id).localeCompare(String(b.id));
  });
}
