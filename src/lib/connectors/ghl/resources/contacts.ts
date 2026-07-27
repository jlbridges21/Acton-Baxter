import "server-only";

import { ghlGet, ghlPost } from "../client";
import { ghlContactsSearchResponseSchema, ghlContactSchema, type GhlContact } from "../types";
import { normalizeContact, rankContactMatches, type AmbiguousContactMatch } from "../normalize";
import { requireGhlLocationId } from "../config";

export type ContactSearchOptions = {
  query?: string;
  email?: string;
  phone?: string;
  limit?: number;
  page?: number;
};

export type ContactSearchResult = {
  contacts: GhlContact[];
  total: number | null;
  hasMore: boolean;
};

export async function searchContacts(
  options: ContactSearchOptions = {},
): Promise<ContactSearchResult> {
  const locationId = requireGhlLocationId();

  const body: Record<string, unknown> = {
    locationId,
  };

  if (options.query) {
    body.query = options.query;
  }
  if (options.email) {
    body.email = options.email;
  }
  if (options.phone) {
    body.phone = options.phone;
  }
  if (options.limit) {
    body.limit = Math.min(options.limit, 100);
  }
  if (options.page) {
    body.page = options.page;
  }

  const response = await ghlPost("/contacts/search", body, { resource: "contacts" });
  const parsed = ghlContactsSearchResponseSchema.safeParse(response);

  if (!parsed.success) {
    console.warn("[GHL Contacts] Response validation warning:", parsed.error.message);
    const raw = response as { contacts?: unknown[]; meta?: { total?: number } };
    return {
      contacts: Array.isArray(raw.contacts)
        ? (raw.contacts as Record<string, unknown>[]).map((c) => normalizeContact(c, locationId))
        : [],
      total: raw.meta?.total ?? null,
      hasMore: false,
    };
  }

  return {
    contacts: parsed.data.contacts.map((c) =>
      normalizeContact(c as Record<string, unknown>, locationId),
    ),
    total: parsed.data.meta?.total ?? null,
    hasMore: Boolean(parsed.data.meta?.nextPage),
  };
}

export async function getContactById(contactId: string): Promise<GhlContact | null> {
  const locationId = requireGhlLocationId();

  try {
    const response = await ghlGet(`/contacts/${contactId}`, undefined, {
      resource: "contacts",
      injectLocationId: false,
    });
    const data = response as { contact?: unknown };
    const contact = data.contact ?? response;

    const parsed = ghlContactSchema.safeParse(contact);
    if (!parsed.success) {
      console.warn("[GHL Contacts] Contact validation warning:", parsed.error.message);
      return normalizeContact(contact as Record<string, unknown>, locationId);
    }

    return normalizeContact(parsed.data as Record<string, unknown>, locationId);
  } catch {
    return null;
  }
}

export async function findContactByEmail(email: string): Promise<GhlContact | null> {
  const result = await searchContacts({ email, limit: 1 });
  return result.contacts[0] ?? null;
}

export async function findContactByPhone(phone: string): Promise<GhlContact | null> {
  const cleaned = phone.replace(/\D/g, "");
  const result = await searchContacts({ phone: cleaned, limit: 1 });
  return result.contacts[0] ?? null;
}

export async function findContactsFuzzy(
  searchQuery: string,
  options: { limit?: number } = {},
): Promise<AmbiguousContactMatch[]> {
  const limit = options.limit ?? 10;
  const result = await searchContacts({ query: searchQuery, limit: Math.max(limit * 2, 20) });

  if (result.contacts.length === 0) {
    return [];
  }

  const ranked = rankContactMatches(result.contacts, searchQuery);
  return ranked.slice(0, limit);
}

export async function listRecentContacts(limit = 20): Promise<GhlContact[]> {
  const result = await searchContacts({ limit });
  return result.contacts;
}
