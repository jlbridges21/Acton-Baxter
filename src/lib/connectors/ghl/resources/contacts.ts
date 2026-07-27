import "server-only";

import { ghlGet, ghlPost } from "../client";
import { ghlContactsSearchResponseSchema, ghlContactSchema, type GhlContact } from "../types";
import { normalizeContact, rankContactMatches, type AmbiguousContactMatch } from "../normalize";
import { requireGhlLocationId } from "../config";
import { buildContactSearchBody } from "../request-contracts";

export type ContactSearchOptions = {
  query?: string;
  email?: string;
  phone?: string;
  /** Mapped to HighLevel pageLimit — never sent as "limit". */
  limit?: number;
  page?: number;
};

export type ContactSearchResult = {
  contacts: GhlContact[];
  total: number | null;
  hasMore: boolean;
  page: number;
  pageLimit: number;
};

export async function searchContacts(
  options: ContactSearchOptions = {},
): Promise<ContactSearchResult> {
  const locationId = requireGhlLocationId();
  const page = options.page && options.page > 0 ? options.page : 1;
  const pageLimit = options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 25;

  const body = buildContactSearchBody({
    locationId,
    query: options.query,
    email: options.email,
    phone: options.phone,
    page,
    limit: pageLimit,
  });

  const response = await ghlPost("/contacts/search", body, {
    resource: "contacts",
    injectLocationId: false,
  });
  const parsed = ghlContactsSearchResponseSchema.safeParse(response);

  if (!parsed.success) {
    console.warn("[GHL Contacts] Response validation warning:", parsed.error.message);
    const raw = response as { contacts?: unknown[]; meta?: { total?: number; nextPage?: boolean } };
    const contacts = Array.isArray(raw.contacts)
      ? (raw.contacts as Record<string, unknown>[]).map((c) => normalizeContact(c, locationId))
      : [];
    return {
      contacts,
      total: raw.meta?.total ?? null,
      hasMore: Boolean(raw.meta?.nextPage) || contacts.length >= pageLimit,
      page,
      pageLimit,
    };
  }

  return {
    contacts: parsed.data.contacts.map((c) =>
      normalizeContact(c as Record<string, unknown>, locationId),
    ),
    total: parsed.data.meta?.total ?? null,
    hasMore: Boolean(parsed.data.meta?.nextPage),
    page,
    pageLimit,
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

export async function getContactsByIds(contactIds: string[]): Promise<Map<string, GhlContact>> {
  const unique = [...new Set(contactIds.filter(Boolean))];
  const map = new Map<string, GhlContact>();
  const concurrency = 5;
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((id) => getContactById(id)));
    results.forEach((contact, idx) => {
      if (contact) map.set(batch[idx]!, contact);
    });
  }
  return map;
}
