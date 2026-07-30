/**
 * Canonical GHL conversation / message recall for Baxter + admin UI.
 * Live API only — no Supabase mirror of message bodies.
 */
import "server-only";

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import {
  getConversationMessages,
  listConversationsForContact,
  searchConversations,
} from "@/lib/connectors/ghl/resources/conversations";
import { searchContacts, getContactById } from "@/lib/connectors/ghl/resources/contacts";
import { resolveContact } from "@/lib/baxter-data/ghl/resolve";
import {
  labelMessageType,
  stripHtmlToText,
  displayContactName,
} from "@/lib/connectors/ghl/present";
import type { GhlContact, GhlConversation, GhlMessage } from "@/lib/connectors/ghl/types";
import { createConversationEvidenceSource, createContactEvidenceSource } from "./evidence";
import type { GhlEvidenceSource } from "./types";
import type {
  GhlMessageChannelFilter,
  GhlMessageDirectionFilter,
} from "./conversation-intent";

export type { GhlMessageChannelFilter, GhlMessageDirectionFilter };
export {
  extractConversationContactQuery,
  inferConversationLookupFilters,
  isGhlConversationLookupQuestion,
} from "./conversation-intent";

export type GhlConversationLookupRequest = {
  /** Free-text contact query (name, email, phone). */
  contactQuery: string;
  channel?: GhlMessageChannelFilter;
  direction?: GhlMessageDirectionFilter;
  /** How many messages to return (after filters). Default 1 for latest. */
  limit?: number;
  maxConversations?: number;
  messagesPerConversation?: number;
};

export type GhlConversationLookupResult = {
  ok: boolean;
  contact: GhlContact | null;
  conversations: GhlConversation[];
  messages: GhlMessage[];
  selected: GhlMessage | null;
  evidenceSources: GhlEvidenceSource[];
  diagnostics: {
    query: string;
    contactResolved: boolean;
    contactId: string | null;
    conversationsFound: number;
    messagesInspected: number;
    emailMessagesFound: number;
    latestEmailTimestamp: string | null;
    direction: GhlMessageDirectionFilter;
    channel: GhlMessageChannelFilter;
    incompleteReason: string | null;
  };
  ambiguityMessage?: string;
  failureMessage?: string;
};

export function isEmailMessageType(type: string | null | undefined): boolean {
  const t = (type ?? "").toUpperCase();
  return t.includes("EMAIL") || t === "EMAIL" || t === "TYPE_CUSTOM_EMAIL";
}

export function isSmsMessageType(type: string | null | undefined): boolean {
  const t = (type ?? "").toUpperCase();
  return t.includes("SMS") || t === "SMS" || t === "TYPE_CUSTOM_SMS";
}

export function isCallMessageType(type: string | null | undefined): boolean {
  const t = (type ?? "").toUpperCase();
  return t.includes("CALL") || t.includes("VOICEMAIL") || t === "CALL";
}

export function messageMatchesChannel(
  message: GhlMessage,
  channel: GhlMessageChannelFilter,
): boolean {
  if (channel === "any") return true;
  if (channel === "email") return isEmailMessageType(message.type);
  if (channel === "sms") return isSmsMessageType(message.type);
  if (channel === "call") return isCallMessageType(message.type);
  return true;
}

export function messageMatchesDirection(
  message: GhlMessage,
  direction: GhlMessageDirectionFilter,
): boolean {
  if (direction === "any") return true;
  return message.direction === direction;
}

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

export function sortMessagesNewestFirst(messages: GhlMessage[]): GhlMessage[] {
  return [...messages].sort((a, b) => messageTimestampMs(b) - messageTimestampMs(a));
}

export async function collectMessagesForContact(
  contactId: string,
  options: {
    maxConversations?: number;
    messagesPerConversation?: number;
    maxMessages?: number;
  } = {},
): Promise<{ conversations: GhlConversation[]; messages: GhlMessage[] }> {
  const maxConversations = options.maxConversations ?? 8;
  const messagesPerConversation = options.messagesPerConversation ?? 40;
  const maxMessages = options.maxMessages ?? 120;

  const conversations = await listConversationsForContact(contactId, {
    limit: maxConversations,
  });
  const all: GhlMessage[] = [];

  for (const conv of conversations) {
    if (all.length >= maxMessages) break;
    let lastMessageId: string | undefined;
    let pages = 0;
    while (pages < 3 && all.length < maxMessages) {
      const { messages, hasMore } = await getConversationMessages(conv.id, {
        limit: Math.min(messagesPerConversation, maxMessages - all.length),
        lastMessageId,
      });
      pages += 1;
      if (!messages.length) break;
      for (const m of messages) {
        all.push({
          ...m,
          conversationId: m.conversationId || conv.id,
          contactId: m.contactId || contactId,
        });
      }
      if (!hasMore) break;
      lastMessageId = messages[messages.length - 1]?.id;
      if (!lastMessageId) break;
    }
  }

  return { conversations, messages: sortMessagesNewestFirst(all).slice(0, maxMessages) };
}

export async function lookupGhlConversationMessages(
  input: GhlConversationLookupRequest,
): Promise<GhlConversationLookupResult> {
  const channel = input.channel ?? "any";
  const direction = input.direction ?? "any";
  const limit = Math.min(Math.max(input.limit ?? 1, 1), 10);
  const query = input.contactQuery.trim();

  const emptyDiagnostics = {
    query,
    contactResolved: false,
    contactId: null as string | null,
    conversationsFound: 0,
    messagesInspected: 0,
    emailMessagesFound: 0,
    latestEmailTimestamp: null as string | null,
    direction,
    channel,
    incompleteReason: null as string | null,
  };

  if (!isGhlConfigured()) {
    return {
      ok: false,
      contact: null,
      conversations: [],
      messages: [],
      selected: null,
      evidenceSources: [],
      diagnostics: { ...emptyDiagnostics, incompleteReason: "ghl_not_configured" },
      failureMessage:
        "GoHighLevel isn’t connected, so I can’t look up conversation messages right now.",
    };
  }

  const looksEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query);
  const digits = query.replace(/\D/g, "");
  const looksPhone = digits.length >= 7 && digits.length <= 15;

  const resolution = await resolveContact({
    email: looksEmail ? query : undefined,
    phone: looksPhone ? query : undefined,
    name: !looksEmail && !looksPhone ? query : undefined,
  });

  if (resolution.ambiguous) {
    return {
      ok: false,
      contact: null,
      conversations: [],
      messages: [],
      selected: null,
      evidenceSources: [],
      diagnostics: emptyDiagnostics,
      ambiguityMessage:
        resolution.ambiguityMessage ||
        "I found multiple matching contacts in GHL. Which one do you mean?",
    };
  }

  let contact = resolution.resolved && resolution.entity ? resolution.entity : null;
  if (!contact) {
    const search = await searchContacts({ query, limit: 5 });
    if (search.contacts.length > 1) {
      return {
        ok: false,
        contact: null,
        conversations: [],
        messages: [],
        selected: null,
        evidenceSources: [],
        diagnostics: { ...emptyDiagnostics, contactResolved: false },
        ambiguityMessage: `I found ${search.contacts.length} contacts matching “${query}”. Which one do you mean?`,
      };
    }
    contact = search.contacts[0] ?? null;
  }

  if (!contact) {
    return {
      ok: false,
      contact: null,
      conversations: [],
      messages: [],
      selected: null,
      evidenceSources: [],
      diagnostics: { ...emptyDiagnostics, incompleteReason: "contact_not_found" },
      failureMessage: `I couldn’t find a GHL contact matching “${query}”.`,
    };
  }

  // Prefer fully hydrated contact when available
  const hydrated = (await getContactById(contact.id).catch(() => null)) ?? contact;
  const { conversations, messages } = await collectMessagesForContact(hydrated.id, {
    maxConversations: input.maxConversations,
    messagesPerConversation: input.messagesPerConversation,
  });

  const emailMessages = messages.filter((m) => isEmailMessageType(m.type));
  const filtered = sortMessagesNewestFirst(
    messages.filter(
      (m) => messageMatchesChannel(m, channel) && messageMatchesDirection(m, direction),
    ),
  );
  const selectedList = filtered.slice(0, limit);
  const selected = selectedList[0] ?? null;

  const evidenceSources: GhlEvidenceSource[] = [
    createContactEvidenceSource(hydrated.id, displayContactName(hydrated), "Conversation contact"),
  ];
  if (selected) {
    evidenceSources.push(
      createConversationEvidenceSource(
        selected.conversationId,
        `${labelMessageType(selected.type)} · ${selected.direction} · ${selected.dateAdded ?? "unknown time"}`,
      ),
    );
  }

  if (!messages.length) {
    return {
      ok: false,
      contact: hydrated,
      conversations,
      messages: [],
      selected: null,
      evidenceSources,
      diagnostics: {
        query,
        contactResolved: true,
        contactId: hydrated.id,
        conversationsFound: conversations.length,
        messagesInspected: 0,
        emailMessagesFound: 0,
        latestEmailTimestamp: null,
        direction,
        channel,
        incompleteReason: conversations.length
          ? "no_messages_in_accessible_history"
          : "no_conversations",
      },
      failureMessage: conversations.length
        ? `I found ${displayContactName(hydrated)} in GHL, but I didn’t find any messages in the conversation history I can access.`
        : `I found ${displayContactName(hydrated)} in GHL, but I didn’t find any conversations for that contact.`,
    };
  }

  if (!selected) {
    const channelLabel = channel === "any" ? "matching" : channel;
    return {
      ok: false,
      contact: hydrated,
      conversations,
      messages: filtered,
      selected: null,
      evidenceSources,
      diagnostics: {
        query,
        contactResolved: true,
        contactId: hydrated.id,
        conversationsFound: conversations.length,
        messagesInspected: messages.length,
        emailMessagesFound: emailMessages.length,
        latestEmailTimestamp: emailMessages[0]?.dateAdded ?? null,
        direction,
        channel,
        incompleteReason: `no_${channel}_${direction}_message`,
      },
      failureMessage: `I found ${displayContactName(hydrated)} in GHL, but I didn’t find an ${channelLabel} message${
        direction === "any" ? "" : ` (${direction})`
      } in the conversation history I can access.`,
    };
  }

  return {
    ok: true,
    contact: hydrated,
    conversations,
    messages: selectedList,
    selected,
    evidenceSources,
    diagnostics: {
      query,
      contactResolved: true,
      contactId: hydrated.id,
      conversationsFound: conversations.length,
      messagesInspected: messages.length,
      emailMessagesFound: emailMessages.length,
      latestEmailTimestamp: emailMessages[0]?.dateAdded ?? null,
      direction,
      channel,
      incompleteReason: null,
    },
  };
}

export function formatGhlMessageEvidence(message: GhlMessage, contactName: string): string {
  const body = stripHtmlToText(message.body ?? "").trim();
  const when = message.dateAdded
    ? new Date(messageTimestampMs(message) || Date.parse(message.dateAdded)).toLocaleString(
        undefined,
        { dateStyle: "medium", timeStyle: "short" },
      )
    : "unknown time";
  const who =
    message.direction === "inbound"
      ? contactName
      : message.direction === "outbound"
        ? "Acton"
        : "Unknown";
  const channel = labelMessageType(message.type);
  return [
    `Contact: ${contactName}`,
    `Message type: ${channel}`,
    `Direction: ${message.direction}`,
    `From/actor: ${who}`,
    `Timestamp: ${when}`,
    `Body:\n${body.slice(0, 3500)}`,
    `Conversation ID: ${message.conversationId}`,
    `Message ID: ${message.id}`,
  ].join("\n");
}

/**
 * Deterministic answer for conversation recall (no invented paraphrase).
 */
export function buildDeterministicConversationAnswer(input: {
  question: string;
  contactName: string;
  contactEmail?: string | null;
  message: GhlMessage;
}): string {
  const body = stripHtmlToText(input.message.body ?? "").trim();
  const when = input.message.dateAdded
    ? new Date(
        messageTimestampMs(input.message) || Date.parse(input.message.dateAdded),
      ).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "unknown time";
  const channel = labelMessageType(input.message.type);
  const direction =
    input.message.direction === "inbound"
      ? "inbound"
      : input.message.direction === "outbound"
        ? "outbound"
        : "unknown direction";
  const q = input.question.toLowerCase();
  const wantsEmail = /\be-?mail\b/.test(q);
  const label = wantsEmail ? "email" : channel.toLowerCase();
  const who =
    input.message.direction === "inbound"
      ? input.contactName
      : input.message.direction === "outbound"
        ? "Acton"
        : input.contactName;

  const header =
    direction === "inbound"
      ? `${input.contactName}'s latest ${label} in GoHighLevel (${when}):`
      : direction === "outbound"
        ? `The latest ${label} Acton sent to ${input.contactName} in GoHighLevel (${when}):`
        : `Latest ${label} with ${input.contactName} in GoHighLevel (${when}):`;

  const emailLine = input.contactEmail ? `\nContact email: ${input.contactEmail}` : "";
  const meta = `\n${channel} · ${direction} · from ${who}${emailLine}`;

  if (!body) {
    return `${header}${meta}\n\n(No message body was available in GHL for this message.)`;
  }

  return `${header}${meta}\n\n${body.slice(0, 4500)}`;
}

/**
 * Contact-first conversation search for the admin Conversations tab.
 */
export async function searchConversationsForAdmin(input: {
  query?: string | null;
  contactId?: string | null;
  limit?: number;
}): Promise<{
  conversations: GhlConversation[];
  contactsMatched: number;
  total: number | null;
  searchMode: "contact_id" | "contact_query" | "keyword_in_contact" | "recent";
  statusMessage: string;
}> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const query = (input.query ?? "").trim();

  if (input.contactId) {
    const conversations = await listConversationsForContact(input.contactId, { limit });
    return {
      conversations,
      contactsMatched: 1,
      total: conversations.length,
      searchMode: "contact_id",
      statusMessage: `Found ${conversations.length} conversation(s) for contact.`,
    };
  }

  if (query) {
    const looksEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query);
    const digits = query.replace(/\D/g, "");
    const looksPhone = digits.length >= 7 && digits.length <= 15;
    const looksConversationId = /^[A-Za-z0-9_-]{15,}$/.test(query) && !looksEmail && !looksPhone;

    if (looksConversationId) {
      // Best-effort: search recent and match id, or contact-scoped lists won't help.
      const recent = await searchConversations({ limit: 100 });
      const hit = recent.conversations.filter((c) => c.id === query);
      if (hit.length) {
        return {
          conversations: hit,
          contactsMatched: 0,
          total: 1,
          searchMode: "contact_query",
          statusMessage: `Found conversation ${query}.`,
        };
      }
    }

    const resolution = await resolveContact({
      email: looksEmail ? query : undefined,
      phone: looksPhone ? query : undefined,
      name: !looksEmail && !looksPhone ? query : undefined,
    });

    let contacts: GhlContact[] = [];
    if (resolution.resolved && resolution.entity) {
      contacts = [resolution.entity];
    } else if (resolution.ambiguous && resolution.candidates?.length) {
      contacts = resolution.candidates.slice(0, 5);
    } else {
      const search = await searchContacts({ query, limit: 8 });
      contacts = search.contacts;
    }

    // Keyword path: no contact match — try filtering recent conversation previews (bounded).
    if (!contacts.length) {
      const recent = await searchConversations({ limit: Math.min(limit * 2, 50) });
      const needle = query.toLowerCase();
      const filtered = recent.conversations.filter((c) => {
        const hay = `${c.lastMessageBody ?? ""} ${c.contactId} ${c.id}`.toLowerCase();
        return hay.includes(needle);
      });
      return {
        conversations: filtered.slice(0, limit),
        contactsMatched: 0,
        total: filtered.length,
        searchMode: "keyword_in_contact",
        statusMessage: filtered.length
          ? `No contact named “${query}”; found ${filtered.length} recent conversation(s) whose preview matched.`
          : `No GHL contacts matched “${query}”, and no recent conversation previews contained that text. Try a contact name, email, or phone.`,
      };
    }

    const all: GhlConversation[] = [];
    const seen = new Set<string>();
    for (const contact of contacts.slice(0, 5)) {
      const list = await listConversationsForContact(contact.id, { limit: 20 });
      for (const conv of list) {
        if (seen.has(conv.id)) continue;
        seen.add(conv.id);
        all.push(conv);
      }
    }

    // If query looks like a message keyword (not exact name/email match), narrow by preview.
    const isLikelyPersonOrEmail = looksEmail || looksPhone || /[A-Z][a-z]+\s+[A-Z]/.test(query);
    let narrowed = all;
    if (!isLikelyPersonOrEmail && query.length >= 4) {
      const needle = query.toLowerCase();
      const byPreview = all.filter((c) => (c.lastMessageBody ?? "").toLowerCase().includes(needle));
      if (byPreview.length) narrowed = byPreview;
    }

    narrowed.sort((a, b) => {
      const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

    return {
      conversations: narrowed.slice(0, limit),
      contactsMatched: contacts.length,
      total: narrowed.length,
      searchMode: "contact_query",
      statusMessage: `Found ${contacts.length} contact(s) / ${narrowed.length} conversation(s) for “${query}”.`,
    };
  }

  const recent = await searchConversations({ limit });
  return {
    conversations: recent.conversations,
    contactsMatched: 0,
    total: recent.total,
    searchMode: "recent",
    statusMessage: `Showing ${recent.conversations.length} recent conversation(s).`,
  };
}
