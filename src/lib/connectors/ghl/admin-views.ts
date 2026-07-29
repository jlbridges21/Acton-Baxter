import "server-only";

import type { GhlContact, GhlOpportunity, GhlConversation, GhlMessage } from "./types";
import {
  getGhlReferenceData,
  resolveUserDisplayName,
  resolvePipelineDisplayName,
  resolveStageDisplayName,
  resolveCustomFieldDisplayName,
  resolveTagDisplayName,
  type GhlReferenceData,
} from "./reference-data";
import {
  displayContactName,
  formatGhlCurrency,
  formatGhlDateRelative,
  formatPhoneDisplay,
  labelMessageType,
  sanitizeMessagePreview,
  formatGhlDateTime,
  stripHtmlToText,
} from "./present";
import { getContactsByIds } from "./resources/contacts";
import { listOpportunitiesByContact } from "./resources/opportunities";
import { listEventsForContact } from "./resources/calendars";
import { searchConversations, getConversationMessages } from "./resources/conversations";
import { rankOpportunitiesForContact } from "./opportunity-ranking";

export type HydratedContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  /** Inline formatted address for list column, e.g. "123 Main St, San Jose, CA 95125". */
  addressFormatted: string | null;
  ownerName: string | null;
  ownerId: string | null;
  tags: string[];
  updatedAt: string | null;
  updatedLabel: string | null;
};

export type HydratedOpportunityRow = {
  id: string;
  name: string;
  contactId: string | null;
  contactName: string | null;
  pipelineId: string;
  pipelineName: string | null;
  stageId: string;
  stageName: string | null;
  monetaryValue: number | null;
  valueLabel: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: string;
  source: string | null;
  updatedAt: string | null;
  updatedLabel: string | null;
};

export type HydratedConversationRow = {
  id: string;
  contactId: string;
  contactName: string;
  channel: string;
  preview: string;
  unreadCount: number;
  lastActivityAt: string | null;
  lastActivityLabel: string | null;
};

export type HydratedCustomField = {
  id: string;
  name: string;
  value: string;
};

export async function hydrateContactRows(contacts: GhlContact[]): Promise<HydratedContactRow[]> {
  const refs = await getGhlReferenceData();
  const { contactAddressFromGhl } = await import("./address");

  // Search payloads are often thin (city without address1). Batch-fetch full contacts
  // only when street is missing from the search row — concurrency capped in getContactsByIds.
  const needsFull = contacts.filter((c) => c.id && !c.address1).map((c) => c.id);
  const fullById =
    needsFull.length > 0 ? await getContactsByIds(needsFull) : new Map<string, GhlContact>();

  return contacts.map((c) => {
    const full = fullById.get(c.id);
    const merged: GhlContact = full
      ? {
          ...c,
          ...full,
          address1: full.address1 ?? c.address1,
          city: full.city ?? c.city,
          state: full.state ?? c.state,
          postalCode: full.postalCode ?? c.postalCode,
          country: full.country ?? c.country,
          email: full.email ?? c.email,
          phone: full.phone ?? c.phone,
          tags: full.tags?.length ? full.tags : c.tags,
          assignedTo: full.assignedTo ?? c.assignedTo,
        }
      : c;
    const address = contactAddressFromGhl(merged);
    return {
      id: merged.id,
      name: displayContactName(merged),
      email: merged.email,
      phone: formatPhoneDisplay(merged.phone),
      address1: merged.address1,
      city: merged.city,
      state: merged.state,
      postalCode: merged.postalCode,
      country: merged.country,
      addressFormatted: address.formatted,
      ownerId: merged.assignedTo,
      ownerName:
        resolveUserDisplayName(refs, merged.assignedTo) ?? (merged.assignedTo ? "Unknown" : null),
      tags: (merged.tags ?? []).map((t) => resolveTagDisplayName(refs, t)),
      updatedAt: merged.dateUpdated,
      updatedLabel: formatGhlDateRelative(merged.dateUpdated),
    };
  });
}

export async function hydrateOpportunityRows(
  opportunities: GhlOpportunity[],
): Promise<HydratedOpportunityRow[]> {
  const refs = await getGhlReferenceData();
  const contactIds = opportunities.map((o) => o.contactId).filter(Boolean);
  const contacts = await getContactsByIds(contactIds);

  return opportunities.map((o) => {
    const contact = o.contactId ? contacts.get(o.contactId) : null;
    return {
      id: o.id,
      name: o.name || "Untitled opportunity",
      contactId: o.contactId || null,
      contactName: contact ? displayContactName(contact) : null,
      pipelineId: o.pipelineId,
      pipelineName: resolvePipelineDisplayName(refs, o.pipelineId),
      stageId: o.pipelineStageId,
      stageName: resolveStageDisplayName(refs, o.pipelineId, o.pipelineStageId),
      monetaryValue: o.monetaryValue,
      valueLabel: formatGhlCurrency(o.monetaryValue),
      ownerId: o.assignedTo,
      ownerName: resolveUserDisplayName(refs, o.assignedTo),
      status: o.status || "open",
      source: o.source,
      updatedAt: o.dateUpdated,
      updatedLabel: formatGhlDateRelative(o.dateUpdated),
    };
  });
}

export async function hydrateConversationRows(
  conversations: GhlConversation[],
): Promise<HydratedConversationRow[]> {
  const contactIds = conversations.map((c) => c.contactId).filter(Boolean);
  const contacts = await getContactsByIds(contactIds);
  return conversations.map((c) => {
    const contact = contacts.get(c.contactId);
    return {
      id: c.id,
      contactId: c.contactId,
      contactName: contact ? displayContactName(contact) : "Unknown contact",
      channel: labelMessageType(c.lastMessageType || c.type),
      preview: sanitizeMessagePreview(c.lastMessageBody),
      unreadCount: c.unreadCount ?? 0,
      lastActivityAt: c.lastMessageAt || c.dateUpdated,
      lastActivityLabel: formatGhlDateRelative(c.lastMessageAt || c.dateUpdated),
    };
  });
}

export function hydrateCustomFields(
  refs: GhlReferenceData | null,
  customFields: Record<string, unknown>,
): HydratedCustomField[] {
  const rows: HydratedCustomField[] = [];
  for (const [id, value] of Object.entries(customFields ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    const name = resolveCustomFieldDisplayName(refs, id) ?? id;
    // Skip if name still looks like a raw id and we have no label — still show with best effort
    const display = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (!display.trim()) continue;
    rows.push({ id, name, value: display });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function buildContactDetailView(contactId: string) {
  const { getContactById } = await import("./resources/contacts");
  const contact = await getContactById(contactId);
  if (!contact) return null;

  const refs = await getGhlReferenceData();
  const opportunities = await listOpportunitiesByContact(contactId, { limit: 50 });
  const ranked = rankOpportunitiesForContact(opportunities, refs);
  const hydratedOpps = await hydrateOpportunityRows(opportunities);
  const events = await listEventsForContact(contactId).catch(() => []);
  const now = Date.now();
  const upcoming = events
    .filter((e) => new Date(e.startTime).getTime() >= now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 5)
    .map((e) => ({
      id: e.id,
      title: e.title,
      startLabel: formatGhlDateTime(e.startTime),
      endLabel: formatGhlDateTime(e.endTime),
      assigneeName: resolveUserDisplayName(refs, e.assignedUserId),
      status: e.appointmentStatus,
    }));

  const convResult = await searchConversations({ contactId, limit: 5 }).catch(() => ({
    conversations: [] as GhlConversation[],
    total: null as number | null,
  }));
  const conversations = await hydrateConversationRows(convResult.conversations);

  const { contactAddressFromGhl, formatGhlAddressMultiline } = await import("./address");
  const address = contactAddressFromGhl(contact);
  const addressMultiline = formatGhlAddressMultiline(address);

  return {
    contact: {
      id: contact.id,
      name: displayContactName(contact),
      email: contact.email,
      phone: formatPhoneDisplay(contact.phone),
      address1: contact.address1,
      city: contact.city,
      state: contact.state,
      postalCode: contact.postalCode,
      country: contact.country,
      addressFormatted: address.formatted,
      addressMultiline,
      addressStatus: address.hasStreet
        ? "loaded_present"
        : address.present
          ? "loaded_missing_street"
          : "loaded_missing",
      source: contact.source,
      dateAddedLabel: formatGhlDateRelative(contact.dateAdded),
      ownerId: contact.assignedTo,
      ownerName: resolveUserDisplayName(refs, contact.assignedTo),
      tags: (contact.tags ?? []).map((t) => resolveTagDisplayName(refs, t)),
      updatedLabel: formatGhlDateRelative(contact.dateUpdated),
      customFields: hydrateCustomFields(refs, contact.customFields),
    },
    opportunities: hydratedOpps,
    primaryOpportunityId: ranked[0]?.id ?? null,
    appointments: upcoming,
    conversations,
    pipelines: refs?.pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      stages: p.stages.map((s) => ({ id: s.id, name: s.name })),
    })),
    users: refs?.users.map((u) => ({
      id: u.id,
      name: u.name || u.email,
    })),
  };
}

export async function buildOpportunityDetailView(opportunityId: string) {
  const { getOpportunityById } = await import("./resources/opportunities");
  const opportunity = await getOpportunityById(opportunityId);
  if (!opportunity) return null;
  const [hydrated] = await hydrateOpportunityRows([opportunity]);
  let contactDetail = null;
  if (opportunity.contactId) {
    contactDetail = await buildContactDetailView(opportunity.contactId);
  }
  const refs = await getGhlReferenceData();
  const pipeline = refs?.pipelines.find((p) => p.id === opportunity.pipelineId);
  return {
    opportunity: hydrated,
    stages:
      pipeline?.stages.map((s) => ({
        id: s.id,
        name: s.name,
      })) ?? [],
    contact: contactDetail?.contact ?? null,
    conversations: contactDetail?.conversations ?? [],
    appointments: contactDetail?.appointments ?? [],
    users: contactDetail?.users ?? [],
  };
}

export async function buildConversationDetailView(
  conversationId: string,
  options?: {
    limit?: number;
    lastMessageId?: string;
  },
) {
  const messagesResult = await getConversationMessages(conversationId, {
    limit: options?.limit ?? 30,
    lastMessageId: options?.lastMessageId,
  });
  const convResult = await searchConversations({ limit: 50 }).catch(() => ({
    conversations: [] as GhlConversation[],
  }));
  const conversation = convResult.conversations.find((c) => c.id === conversationId) ?? null;
  let contactName = "Unknown contact";
  const contactId = conversation?.contactId ?? "";
  if (contactId) {
    const map = await getContactsByIds([contactId]);
    const contact = map.get(contactId);
    if (contact) contactName = displayContactName(contact);
  }

  const messages = messagesResult.messages
    .slice()
    .sort((a, b) => {
      const ta = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
      const tb = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
      return ta - tb;
    })
    .map((m: GhlMessage) => ({
      id: m.id,
      direction: m.direction,
      actorLabel: m.direction === "inbound" ? contactName : "Acton",
      channel: labelMessageType(m.type),
      body: stripHtmlToText(m.body ?? "")
        .replace(/\s+\n/g, "\n")
        .trim(),
      at: formatGhlDateTime(m.dateAdded),
      status: m.status,
    }));

  return {
    conversationId,
    contactId,
    contactName,
    channel: labelMessageType(conversation?.lastMessageType || conversation?.type),
    messages,
    hasMore: messagesResult.hasMore,
  };
}
