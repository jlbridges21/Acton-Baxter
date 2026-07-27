import "server-only";

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import {
  searchContacts,
  getContactById,
  findContactByEmail,
  findContactByPhone,
  findContactsFuzzy,
} from "@/lib/connectors/ghl/resources/contacts";
import { listOpportunitiesByContact } from "@/lib/connectors/ghl/resources/opportunities";
import { getRecentMessages } from "@/lib/connectors/ghl/resources/conversations";
import { listEventsForContact } from "@/lib/connectors/ghl/resources/calendars";
import { getUserById } from "@/lib/connectors/ghl/resources/users";
import type { BaxterGhlContactContext, GhlContact, GhlEvidenceSource } from "./types";
import {
  createContactEvidenceSource,
  createOpportunityEvidenceSource,
  createConversationEvidenceSource,
  createCalendarEventEvidenceSource,
  createUserEvidenceSource,
} from "./evidence";

export async function getBaxterContactContext(
  contactId: string,
): Promise<BaxterGhlContactContext | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const contact = await getContactById(contactId);
  if (!contact) {
    return null;
  }

  const evidenceSources: GhlEvidenceSource[] = [
    createContactEvidenceSource(contact.id, contact.name, "Contact profile loaded"),
  ];

  const [opportunities, recentMessages, upcomingEvents] = await Promise.all([
    listOpportunitiesByContact(contactId, { limit: 10 }),
    getRecentMessages(contactId, { limit: 10 }),
    listEventsForContact(contactId, { limit: 10 }),
  ]);

  for (const opp of opportunities) {
    evidenceSources.push(
      createOpportunityEvidenceSource(opp.id, opp.name, `Stage: ${opp.pipelineStageId}`),
    );
  }

  const firstMessage = recentMessages[0];
  if (firstMessage) {
    evidenceSources.push(
      createConversationEvidenceSource(
        firstMessage.conversationId,
        `${recentMessages.length} recent messages`,
      ),
    );
  }

  for (const event of upcomingEvents.slice(0, 3)) {
    evidenceSources.push(createCalendarEventEvidenceSource(event.id, event.title, event.startTime));
  }

  let assignedUser = null;
  if (contact.assignedTo) {
    assignedUser = await getUserById(contact.assignedTo);
    if (assignedUser) {
      evidenceSources.push(
        createUserEvidenceSource(assignedUser.id, assignedUser.name, "Assigned user"),
      );
    }
  }

  return {
    contact,
    opportunities,
    recentMessages,
    upcomingEvents,
    assignedUser,
    evidenceSources,
  };
}

export async function searchBaxterContacts(
  query: string,
  options: { limit?: number } = {},
): Promise<{ contacts: GhlContact[]; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const result = await searchContacts({ query, limit: options.limit ?? 10 });
  const evidenceSources = result.contacts.map((c) =>
    createContactEvidenceSource(c.id, c.name, `Found via search: "${query}"`),
  );

  return {
    contacts: result.contacts,
    evidenceSources,
  };
}

export async function findBaxterContactByEmail(
  email: string,
): Promise<{ contact: GhlContact | null; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const contact = await findContactByEmail(email);
  const evidenceSources: GhlEvidenceSource[] = [];

  if (contact) {
    evidenceSources.push(
      createContactEvidenceSource(contact.id, contact.name, `Found by email: ${email}`),
    );
  }

  return { contact, evidenceSources };
}

export async function findBaxterContactByPhone(
  phone: string,
): Promise<{ contact: GhlContact | null; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const contact = await findContactByPhone(phone);
  const evidenceSources: GhlEvidenceSource[] = [];

  if (contact) {
    evidenceSources.push(
      createContactEvidenceSource(contact.id, contact.name, `Found by phone: ${phone}`),
    );
  }

  return { contact, evidenceSources };
}

export async function findBaxterContactsFuzzy(
  searchQuery: string,
  options: { limit?: number } = {},
): Promise<{
  matches: Array<{
    contact: GhlContact;
    confidence: "high" | "medium" | "low";
    matchedOn: string[];
  }>;
  evidenceSources: GhlEvidenceSource[];
} | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const matches = await findContactsFuzzy(searchQuery, options);
  const evidenceSources = matches.map((m) =>
    createContactEvidenceSource(
      m.contact.id,
      m.contact.name,
      `${m.confidence} confidence match on: ${m.matchedOn.join(", ")}`,
    ),
  );

  return { matches, evidenceSources };
}
