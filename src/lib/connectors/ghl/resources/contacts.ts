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
  /** Advanced GHL filters (address1/city/state/postalCode/country, etc.). */
  filters?: Array<Record<string, unknown>>;
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
    filters: options.filters,
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

/**
 * Admin contacts browse search: keeps existing name/email/phone `query` behavior and
 * adds live address-field filters (address1, city, state, postalCode, country) when useful.
 * Merges unique contacts; prefers query pagination when name search returns rows.
 */
export async function searchContactsForAdminBrowse(
  options: ContactSearchOptions = {},
): Promise<ContactSearchResult> {
  const { buildGhlAddressSearchFilters, isLikelyAddressSearchQuery } = await import("../address");

  const trimmed = options.query?.trim() || "";
  const page = options.page && options.page > 0 ? options.page : 1;
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 25;

  if (!trimmed || options.email || options.phone) {
    return searchContacts(options);
  }

  const addressFilters = buildGhlAddressSearchFilters(trimmed);
  const addressLikely = isLikelyAddressSearchQuery(trimmed);

  if (addressLikely) {
    // Prefer address filters for ZIP/street/city-style queries; still OR with free-text query.
    const [byAddress, byQuery] = await Promise.all([
      searchContacts({
        page,
        limit,
        filters: addressFilters,
      }).catch(() => null),
      searchContacts({
        query: trimmed,
        page,
        limit,
      }).catch(() => null),
    ]);

    if (byAddress && byAddress.contacts.length > 0) {
      return mergeContactSearchResults(byAddress, byQuery, limit);
    }
    if (byQuery) return byQuery;
    return (
      byAddress ?? {
        contacts: [],
        total: 0,
        hasMore: false,
        page,
        pageLimit: limit,
      }
    );
  }

  // Name-forward search, but also surface address matches (e.g. city name equal to a person name).
  const [byQuery, byAddress] = await Promise.all([
    searchContacts({ query: trimmed, page, limit }),
    searchContacts({
      page: 1,
      limit: Math.min(limit * 2, 50),
      filters: addressFilters,
    }).catch(() => null),
  ]);

  if (!byAddress || byAddress.contacts.length === 0) return byQuery;
  return mergeContactSearchResults(byQuery, byAddress, limit);
}

function mergeContactSearchResults(
  primary: ContactSearchResult,
  secondary: ContactSearchResult | null,
  limit: number,
): ContactSearchResult {
  if (!secondary || secondary.contacts.length === 0) return primary;
  const seen = new Set(primary.contacts.map((c) => c.id));
  const extras = secondary.contacts.filter((c) => c.id && !seen.has(c.id));
  const contacts = [...primary.contacts, ...extras].slice(0, limit);
  const total =
    primary.total != null || secondary.total != null
      ? (primary.total ?? primary.contacts.length) + extras.length
      : null;
  return {
    contacts,
    total,
    hasMore: primary.hasMore || secondary.hasMore || contacts.length >= limit,
    page: primary.page,
    pageLimit: primary.pageLimit,
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

/**
 * Canonical full-contact hydrator shared by admin Contacts UI and Baxter AI evidence.
 * Search/list payloads are often thin; prefer GET /contacts/:id when an id is known.
 * Failure keeps the thin contact so secondary enrichment never blanks the answer.
 */
export async function hydrateGhlContact(contact: GhlContact): Promise<GhlContact> {
  if (!contact.id) return contact;
  const full = await getContactById(contact.id).catch(() => null);
  if (!full) return contact;
  return {
    ...contact,
    ...full,
    address1: full.address1 ?? contact.address1,
    city: full.city ?? contact.city,
    state: full.state ?? contact.state,
    postalCode: full.postalCode ?? contact.postalCode,
    country: full.country ?? contact.country,
    email: full.email ?? contact.email,
    phone: full.phone ?? contact.phone,
    tags: full.tags?.length ? full.tags : contact.tags,
    customFields:
      Object.keys(full.customFields || {}).length > 0 ? full.customFields : contact.customFields,
    assignedTo: full.assignedTo ?? contact.assignedTo,
    source: full.source ?? contact.source,
    companyName: full.companyName ?? contact.companyName,
    dateAdded: full.dateAdded ?? contact.dateAdded,
    dateUpdated: full.dateUpdated ?? contact.dateUpdated,
  };
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
  const cleaned = searchQuery
    .replace(/['\u2019]s\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const result = await searchContacts({ query: cleaned, limit: Math.max(limit * 2, 20) });

  if (result.contacts.length === 0) {
    return [];
  }

  const ranked = rankContactMatches(result.contacts, cleaned);
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
