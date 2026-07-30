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
import type { GhlMessageChannelFilter, GhlMessageDirectionFilter } from "./conversation-intent";

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
  selectedSource: "full_message" | "conversation_summary" | null;
  evidenceSources: GhlEvidenceSource[];
  diagnostics: {
    query: string;
    contactResolved: boolean;
    contactId: string | null;
    conversationIds: string[];
    conversationsFound: number;
    summaryLatestBodyPresent: boolean;
    summaryLatestAtPresent: boolean;
    summaryLatestType: string | null;
    fullMessagesEndpointAttempted: boolean;
    fullMessagesReturnedCount: number;
    fallbackUsed: boolean;
    messagesInspected: number;
    emailMessagesFound: number;
    latestEmailTimestamp: string | null;
    selectedTimestamp: string | null;
    selectedType: string | null;
    selectedSource: "full_message" | "conversation_summary" | null;
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
  if (message.direction === "unknown") return false;
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

/**
 * Convert conversation-search lastMessage* fields into a synthetic message.
 * Prefer lastMessageType over conversation.type (TYPE_PHONE + TYPE_EMAIL is common).
 */
export function messageFromConversationSummary(
  conversation: GhlConversation,
  contactId: string,
): GhlMessage | null {
  const body = (conversation.lastMessageBody ?? "").trim();
  if (!body) return null;
  const type = conversation.lastMessageType || "unknown";
  return {
    id: `summary:${conversation.id}`,
    conversationId: conversation.id,
    contactId: conversation.contactId || contactId,
    locationId: conversation.locationId,
    type,
    direction: conversation.lastMessageDirection || "unknown",
    body,
    status: null,
    dateAdded: conversation.lastMessageAt,
    attachments: [],
    fromConversationSummary: true,
  };
}

export async function collectMessagesForContact(
  contactId: string,
  options: {
    maxConversations?: number;
    messagesPerConversation?: number;
    maxMessages?: number;
  } = {},
): Promise<{
  conversations: GhlConversation[];
  messages: GhlMessage[];
  fullMessagesReturnedCount: number;
  fullMessagesEndpointAttempted: boolean;
  summaryMessages: GhlMessage[];
}> {
  const maxConversations = options.maxConversations ?? 8;
  const messagesPerConversation = options.messagesPerConversation ?? 40;
  const maxMessages = options.maxMessages ?? 120;

  const conversations = await listConversationsForContact(contactId, {
    limit: maxConversations,
  });
  const all: GhlMessage[] = [];
  let fullMessagesEndpointAttempted = false;

  for (const conv of conversations) {
    if (all.length >= maxMessages) break;
    let lastMessageId: string | undefined;
    let pages = 0;
    while (pages < 3 && all.length < maxMessages) {
      fullMessagesEndpointAttempted = true;
      const {
        messages,
        hasMore,
        lastMessageId: cursor,
      } = await getConversationMessages(conv.id, {
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
      lastMessageId = cursor || messages[messages.length - 1]?.id;
      if (!lastMessageId) break;
    }
  }

  const summaryMessages = conversations
    .map((c) => messageFromConversationSummary(c, contactId))
    .filter((m): m is GhlMessage => Boolean(m));

  const fullMessagesReturnedCount = all.length;
  // Prefer full history; fall back to verified search summaries when messages endpoint is empty.
  const merged = all.length > 0 ? all : summaryMessages;

  return {
    conversations,
    messages: sortMessagesNewestFirst(merged).slice(0, maxMessages),
    fullMessagesReturnedCount,
    fullMessagesEndpointAttempted,
    summaryMessages,
  };
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
    conversationIds: [] as string[],
    conversationsFound: 0,
    summaryLatestBodyPresent: false,
    summaryLatestAtPresent: false,
    summaryLatestType: null as string | null,
    fullMessagesEndpointAttempted: false,
    fullMessagesReturnedCount: 0,
    fallbackUsed: false,
    messagesInspected: 0,
    emailMessagesFound: 0,
    latestEmailTimestamp: null as string | null,
    selectedTimestamp: null as string | null,
    selectedType: null as string | null,
    selectedSource: null as "full_message" | "conversation_summary" | null,
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
      selectedSource: null,
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
      selectedSource: null,
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
        selectedSource: null,
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
      selectedSource: null,
      evidenceSources: [],
      diagnostics: { ...emptyDiagnostics, incompleteReason: "contact_not_found" },
      failureMessage: `I couldn’t find a GHL contact matching “${query}”.`,
    };
  }

  const hydrated = (await getContactById(contact.id).catch(() => null)) ?? contact;
  const collected = await collectMessagesForContact(hydrated.id, {
    maxConversations: input.maxConversations,
    messagesPerConversation: input.messagesPerConversation,
  });
  const {
    conversations,
    fullMessagesReturnedCount,
    fullMessagesEndpointAttempted,
    summaryMessages,
  } = collected;

  let messages = collected.messages;
  // Channel/direction filter on full messages first.
  let filtered = sortMessagesNewestFirst(
    messages.filter(
      (m) => messageMatchesChannel(m, channel) && messageMatchesDirection(m, direction),
    ),
  );

  // If direction-specific filter removed everything but summaries with unknown direction exist,
  // allow email/any-channel summaries as last resort (neutral wording).
  if (!filtered.length && direction !== "any") {
    const summaryFallback = sortMessagesNewestFirst(
      summaryMessages.filter(
        (m) =>
          messageMatchesChannel(m, channel) &&
          (m.direction === direction || m.direction === "unknown"),
      ),
    );
    if (summaryFallback.length) {
      filtered = summaryFallback;
      messages = summaryFallback;
    }
  }

  // If channel filter emptied results but summaries match channel via lastMessageType, use them.
  if (!filtered.length && channel !== "any") {
    const bySummaryType = sortMessagesNewestFirst(
      summaryMessages.filter((m) => messageMatchesChannel(m, channel)),
    );
    if (bySummaryType.length) {
      filtered = bySummaryType;
      messages = bySummaryType;
    }
  }

  // Latest-message with no channel: any summary is enough.
  if (!filtered.length && channel === "any" && summaryMessages.length) {
    filtered = sortMessagesNewestFirst(summaryMessages);
    messages = filtered;
  }

  const selectedList = filtered.slice(0, limit);
  const selected = selectedList[0] ?? null;
  const selectedSource: "full_message" | "conversation_summary" | null = selected
    ? selected.fromConversationSummary
      ? "conversation_summary"
      : "full_message"
    : null;
  const fallbackUsed = selectedSource === "conversation_summary";
  const emailMessages = messages.filter((m) => isEmailMessageType(m.type));
  const newestSummary = sortMessagesNewestFirst(summaryMessages)[0] ?? null;

  const baseDiagnostics = {
    query,
    contactResolved: true,
    contactId: hydrated.id,
    conversationIds: conversations.map((c) => c.id),
    conversationsFound: conversations.length,
    summaryLatestBodyPresent: Boolean(newestSummary?.body),
    summaryLatestAtPresent: Boolean(newestSummary?.dateAdded),
    summaryLatestType: newestSummary?.type ?? null,
    fullMessagesEndpointAttempted,
    fullMessagesReturnedCount,
    fallbackUsed,
    messagesInspected: messages.length,
    emailMessagesFound: emailMessages.length,
    latestEmailTimestamp: emailMessages[0]?.dateAdded ?? null,
    selectedTimestamp: selected?.dateAdded ?? null,
    selectedType: selected?.type ?? null,
    selectedSource,
    direction,
    channel,
    incompleteReason: null as string | null,
  };

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

  if (!selected) {
    const hasAnySummary = summaryMessages.length > 0;
    const channelLabel = channel === "any" ? "matching" : channel;
    return {
      ok: false,
      contact: hydrated,
      conversations,
      messages: filtered,
      selected: null,
      selectedSource: null,
      evidenceSources,
      diagnostics: {
        ...baseDiagnostics,
        incompleteReason: conversations.length
          ? hasAnySummary
            ? `no_${channel}_${direction}_message`
            : "no_messages_and_no_summary"
          : "no_conversations",
      },
      failureMessage: conversations.length
        ? `I found ${displayContactName(hydrated)} in GHL, but I didn’t find an ${channelLabel} message${
            direction === "any" ? "" : ` (${direction})`
          } in the conversation history I can access.`
        : `I found ${displayContactName(hydrated)} in GHL, but I didn’t find any conversations for that contact.`,
    };
  }

  return {
    ok: true,
    contact: hydrated,
    conversations,
    messages: selectedList,
    selected,
    selectedSource,
    evidenceSources,
    diagnostics: baseDiagnostics,
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
        : "Unknown / not specified";
  const channel = labelMessageType(message.type);
  return [
    `Contact: ${contactName}`,
    `Message type: ${channel}`,
    `Direction: ${message.direction}`,
    `From/actor: ${who}`,
    `Timestamp: ${when}`,
    message.fromConversationSummary ? `Source: conversation_summary` : `Source: full_message`,
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
  const q = input.question.toLowerCase();
  const wantsEmail = /\be-?mail\b/.test(q);
  const label = wantsEmail ? "email" : channel.toLowerCase();
  const fromSummary = Boolean(input.message.fromConversationSummary);
  const direction = input.message.direction;

  let header: string;
  if (direction === "inbound") {
    header = `${input.contactName}'s latest ${label} in GoHighLevel (${when}):`;
  } else if (direction === "outbound") {
    header = `The latest ${label} Acton sent to ${input.contactName} in GoHighLevel (${when}):`;
  } else {
    header = `The latest ${label} on ${input.contactName}'s GoHighLevel conversation (${when}):`;
  }

  const emailLine = input.contactEmail ? `\nContact email: ${input.contactEmail}` : "";
  const sourceNote = fromSummary
    ? "\nSource: GHL conversation summary (full message history unavailable or empty)"
    : "";
  const meta =
    direction === "unknown"
      ? `\n${channel}${emailLine}${sourceNote}`
      : `\n${channel} · ${direction}${emailLine}${sourceNote}`;

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
