import "server-only";

import { ghlGet } from "../client";
import {
  ghlConversationsSearchResponseSchema,
  ghlMessagesResponseSchema,
  type GhlConversation,
  type GhlMessage,
} from "../types";
import { normalizeConversation, normalizeMessage } from "../normalize";
import { requireGhlLocationId } from "../config";

export type ConversationSearchOptions = {
  contactId?: string;
  type?: string;
  limit?: number;
};

export type ConversationSearchResult = {
  conversations: GhlConversation[];
  total: number | null;
};

export async function searchConversations(
  options: ConversationSearchOptions = {},
): Promise<ConversationSearchResult> {
  const locationId = requireGhlLocationId();

  const query: Record<string, string | number | boolean | undefined> = {
    locationId,
  };

  if (options.contactId) {
    query.contactId = options.contactId;
  }
  if (options.type) {
    query.type = options.type;
  }
  if (options.limit) {
    query.limit = Math.min(options.limit, 100);
  }

  try {
    const response = await ghlGet("/conversations/search", query);
    const parsed = ghlConversationsSearchResponseSchema.safeParse(response);

    if (!parsed.success) {
      console.warn("[GHL Conversations] Response validation warning:", parsed.error.message);
      const raw = response as { conversations?: unknown[]; total?: number };
      return {
        conversations: Array.isArray(raw.conversations)
          ? (raw.conversations as Record<string, unknown>[]).map(normalizeConversation)
          : [],
        total: raw.total ?? null,
      };
    }

    return {
      conversations: parsed.data.conversations.map((c) =>
        normalizeConversation(c as Record<string, unknown>),
      ),
      total: parsed.data.total ?? null,
    };
  } catch (error) {
    console.warn(
      "[GHL Conversations] API may not be available:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { conversations: [], total: null };
  }
}

export async function getConversationMessages(
  conversationId: string,
  options: { limit?: number; lastMessageId?: string } = {},
): Promise<{ messages: GhlMessage[]; hasMore: boolean; lastMessageId: string | null }> {
  const query: Record<string, string | number | boolean | undefined> = {};

  if (options.limit) {
    query.limit = Math.min(options.limit, 100);
  }
  if (options.lastMessageId) {
    query.lastMessageId = options.lastMessageId;
  }

  try {
    const response = await ghlGet(`/conversations/${conversationId}/messages`, query, {
      injectLocationId: false,
      resource: "messages",
    });
    const extracted = extractMessagesPayload(response);
    return {
      messages: extracted.rawMessages.map((m) => normalizeMessage(m)),
      hasMore: extracted.hasMore,
      lastMessageId: extracted.lastMessageId,
    };
  } catch (error) {
    console.warn(
      "[GHL Messages] API may not be available:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { messages: [], hasMore: false, lastMessageId: null };
  }
}

/**
 * GHL returns either:
 *   { messages: Message[], nextPage?, lastMessageId? }
 * or (official / production):
 *   { messages: { messages: Message[], nextPage?, lastMessageId? } }
 */
export function extractMessagesPayload(response: unknown): {
  rawMessages: Record<string, unknown>[];
  hasMore: boolean;
  lastMessageId: string | null;
} {
  const parsed = ghlMessagesResponseSchema.safeParse(response);
  if (parsed.success) {
    const top = parsed.data.messages;
    if (Array.isArray(top)) {
      return {
        rawMessages: top as Record<string, unknown>[],
        hasMore: Boolean(parsed.data.nextPage),
        lastMessageId:
          typeof parsed.data.lastMessageId === "string" ? parsed.data.lastMessageId : null,
      };
    }
    const nested = top as {
      messages?: unknown[];
      nextPage?: boolean;
      lastMessageId?: string | null;
    };
    return {
      rawMessages: Array.isArray(nested.messages)
        ? (nested.messages as Record<string, unknown>[])
        : [],
      hasMore: Boolean(nested.nextPage ?? parsed.data.nextPage),
      lastMessageId:
        typeof nested.lastMessageId === "string"
          ? nested.lastMessageId
          : typeof parsed.data.lastMessageId === "string"
            ? parsed.data.lastMessageId
            : null,
    };
  }

  console.warn("[GHL Messages] Response validation warning:", parsed.error.message);
  const raw = response as {
    messages?: unknown;
    nextPage?: boolean;
    lastMessageId?: string | null;
  };
  if (Array.isArray(raw.messages)) {
    return {
      rawMessages: raw.messages as Record<string, unknown>[],
      hasMore: Boolean(raw.nextPage),
      lastMessageId: typeof raw.lastMessageId === "string" ? raw.lastMessageId : null,
    };
  }
  if (raw.messages && typeof raw.messages === "object") {
    const nested = raw.messages as {
      messages?: unknown;
      nextPage?: boolean;
      lastMessageId?: string | null;
    };
    return {
      rawMessages: Array.isArray(nested.messages)
        ? (nested.messages as Record<string, unknown>[])
        : [],
      hasMore: Boolean(nested.nextPage),
      lastMessageId: typeof nested.lastMessageId === "string" ? nested.lastMessageId : null,
    };
  }
  return { rawMessages: [], hasMore: false, lastMessageId: null };
}

export async function listConversationsForContact(
  contactId: string,
  options: { limit?: number } = {},
): Promise<GhlConversation[]> {
  const result = await searchConversations({
    contactId,
    limit: options.limit ?? 20,
  });
  return result.conversations;
}

export async function getRecentMessages(
  contactId: string,
  options: { limit?: number } = {},
): Promise<GhlMessage[]> {
  const conversations = await listConversationsForContact(contactId, { limit: 5 });

  if (conversations.length === 0) {
    return [];
  }

  const allMessages: GhlMessage[] = [];
  const messageLimit = options.limit ?? 20;

  for (const conv of conversations) {
    if (allMessages.length >= messageLimit) break;

    const { messages } = await getConversationMessages(conv.id, {
      limit: Math.min(10, messageLimit - allMessages.length),
    });
    allMessages.push(...messages);
  }

  return allMessages
    .sort((a, b) => {
      const dateA = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
      const dateB = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
      return dateB - dateA;
    })
    .slice(0, messageLimit);
}

export async function getConversationSummary(contactId: string): Promise<{
  totalConversations: number;
  totalMessages: number;
  lastMessageAt: string | null;
  conversationTypes: string[];
}> {
  const conversations = await listConversationsForContact(contactId, { limit: 50 });

  if (conversations.length === 0) {
    return {
      totalConversations: 0,
      totalMessages: 0,
      lastMessageAt: null,
      conversationTypes: [],
    };
  }

  const types = [...new Set(conversations.map((c) => c.type))];
  const lastMessageAt =
    conversations
      .map((c) => c.lastMessageAt)
      .filter(Boolean)
      .sort()
      .reverse()[0] ?? null;

  return {
    totalConversations: conversations.length,
    totalMessages: conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    lastMessageAt,
    conversationTypes: types,
  };
}
