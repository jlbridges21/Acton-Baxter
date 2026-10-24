/**
 * GoHighLevel contacts and opportunities — live queries through the existing connector
 * (POST /contacts/search, GET /opportunities/search). Nothing from GoHighLevel is mirrored
 * into the search index.
 *
 * Links only ever use ids GoHighLevel returned, into Baxter's own Customer Center (and the
 * admin connector pages for admins). No GoHighLevel web URLs are constructed or guessed.
 * Custom fields are never searched or shown (they can hold anything).
 */

import "server-only";

import type { GhlContact, GhlOpportunity } from "@/lib/connectors/ghl/types";
import type { SearchContext } from "../context";
import { formatAddress, looksLikeAddress, looksLikeEmail, looksLikePhone } from "../normalize";
import type { ProviderHit, SearchProvider } from "../provider";
import { safeId } from "../safety";

const GHL_ID = /^[A-Za-z0-9]{6,64}$/;

async function ghlAvailability() {
  const { isGhlConfigured, isGhlEnabled } = await import("@/lib/connectors/ghl/config");
  if (!isGhlEnabled()) return { available: false, reason: "GoHighLevel is turned off." };
  if (!isGhlConfigured()) return { available: false, reason: "GoHighLevel isn't connected." };
  return { available: true };
}

function contactName(c: GhlContact): string {
  return (
    c.name?.trim() ||
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    c.companyName?.trim() ||
    c.email?.trim() ||
    "Unnamed contact"
  );
}

function contactHit(ctx: SearchContext, c: GhlContact, fields: Set<string>): ProviderHit | null {
  const id = safeId(c.id, GHL_ID);
  if (!id) return null;
  const email = fields.has("email") ? c.email : null;
  const phone = fields.has("phone") ? c.phone : null;
  const company = fields.has("company") ? c.companyName : null;
  const address = fields.has("address")
    ? { line1: c.address1, city: c.city, state: c.state, postalCode: c.postalCode }
    : null;
  const display = address ? formatAddress(address) : null;
  const actions: ProviderHit["actions"] = [];
  if (phone)
    actions.push({ kind: "copy", label: "Copy phone number", value: phone, field: "phone" });
  if (email)
    actions.push({ kind: "copy", label: "Copy email address", value: email, field: "email" });
  if (ctx.isAdmin)
    actions.push({
      kind: "open",
      label: "Open customer",
      href: `/admin/connectors/ghl/contacts/${id}`,
    });
  return {
    recordId: id,
    title: contactName(c),
    subtitle: [company, email, phone].filter(Boolean).join(" · ") || null,
    description: display,
    breadcrumb: ["Customer Center"],
    url: `/customers/lookup?contactId=${id}`,
    icon: "users-round",
    updatedAt: c.dateUpdated,
    auth: "sensitive",
    actions,
    address: address ?? undefined,
    sourceMatched: true,
    match: {
      title: contactName(c),
      subtitle: company,
      emails: [email],
      phones: [phone],
      addresses: [display],
      fields: [company],
    },
  };
}

function oppHit(ctx: SearchContext, o: GhlOpportunity): ProviderHit | null {
  const id = safeId(o.id, GHL_ID);
  const contactId = safeId(o.contactId, GHL_ID);
  if (!id) return null;
  const url = ctx.isAdmin
    ? `/admin/connectors/ghl/opportunities/${id}`
    : contactId
      ? `/customers/lookup?contactId=${contactId}`
      : null;
  if (!url) return null;
  const status = o.status ? o.status[0]!.toUpperCase() + o.status.slice(1) : null;
  return {
    recordId: id,
    title: o.name || "Untitled opportunity",
    subtitle: ["Opportunity", status].filter(Boolean).join(" · "),
    description: null,
    breadcrumb: ["Customer Center", "Opportunities"],
    url,
    icon: "briefcase",
    updatedAt: o.dateUpdated,
    auth: "sensitive",
    sourceMatched: true,
    actions:
      ctx.isAdmin && contactId
        ? [
            {
              kind: "open",
              label: "Open customer",
              href: `/customers/lookup?contactId=${contactId}`,
            },
          ]
        : [],
    match: { title: o.name, fields: [status] },
  };
}

export const ghlContactsProvider: SearchProvider = {
  id: "ghl-contacts",
  category: "customers",
  name: "GoHighLevel contacts",
  icon: "users-round",
  sourceSystem: "gohighlevel",
  description: "Live search of GoHighLevel contacts by name, email, phone, company, or address.",
  searchableFields: [
    { key: "name", label: "Name", sensitivity: "standard", defaultEnabled: true },
    { key: "email", label: "Email", sensitivity: "standard", defaultEnabled: true },
    { key: "phone", label: "Phone", sensitivity: "standard", defaultEnabled: true },
    { key: "company", label: "Company", sensitivity: "standard", defaultEnabled: true },
    { key: "address", label: "Address", sensitivity: "standard", defaultEnabled: true },
    {
      key: "customFields",
      label: "Custom fields",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
    {
      key: "notes",
      label: "Notes & conversations",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
  ],
  optional: true,
  indexing: "live",
  permissionSummary:
    "GoHighLevel connector role policy: admins and approved employees (salesperson) may read contacts. Results open Customer Center, which re-checks access.",
  minQueryLength: 2,
  timeoutMs: 3500,
  async canUse(ctx) {
    return ctx.canReadGhl("contacts");
  },
  availability: ghlAvailability,
  async search(ctx, input) {
    const { searchContacts } = await import("@/lib/connectors/ghl/resources/contacts");
    const page = Math.floor(input.offset / input.limit) + 1;
    const q = input.query.trim();
    // GoHighLevel's contact search rejects address-field filters ("Invalid field address1"),
    // so address-like queries use its free-text query with the house number and street name.
    // Results are then ranked locally with normalized addresses (Street = St, North = N, …).
    const term =
      looksLikeAddress(q) && !looksLikeEmail(q) && !looksLikePhone(q)
        ? q
            .split(/[\s,]+/)
            .slice(0, 2)
            .join(" ")
        : q;
    const result = await searchContacts({ query: term, limit: input.limit, page });
    return {
      hits: result.contacts
        .map((c) => contactHit(ctx, c, input.fields))
        .filter((h): h is ProviderHit => h !== null),
      hasMore: result.hasMore,
      freshness: { kind: "live" },
    };
  },
  async lookup(ctx, ids) {
    const { getContactsByIds } = await import("@/lib/connectors/ghl/resources/contacts");
    const valid = ids.filter((id) => GHL_ID.test(id)).slice(0, 10);
    if (!valid.length) return [];
    const map = await getContactsByIds(valid);
    const all = new Set(["email", "phone", "company", "address"]);
    return [...map.values()]
      .map((c) => contactHit(ctx, c, all))
      .filter((h): h is ProviderHit => h !== null);
  },
};

export const ghlOpportunitiesProvider: SearchProvider = {
  id: "ghl-opportunities",
  category: "opportunities",
  name: "GoHighLevel opportunities",
  icon: "briefcase",
  sourceSystem: "gohighlevel",
  description: "Live search of GoHighLevel opportunities by name.",
  searchableFields: [
    { key: "name", label: "Opportunity name", sensitivity: "standard", defaultEnabled: true },
    { key: "value", label: "Monetary value", sensitivity: "restricted", defaultEnabled: false },
    {
      key: "customFields",
      label: "Custom fields",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
  ],
  optional: true,
  indexing: "live",
  permissionSummary:
    "GoHighLevel connector role policy (admins and approved employees). Monetary values are never shown in search.",
  minQueryLength: 2,
  timeoutMs: 3500,
  async canUse(ctx) {
    return ctx.canReadGhl("opportunities");
  },
  availability: ghlAvailability,
  async search(ctx, input) {
    const { searchOpportunities } = await import("@/lib/connectors/ghl/resources/opportunities");
    const result = await searchOpportunities({
      q: input.query.trim(),
      limit: input.limit,
      page: Math.floor(input.offset / input.limit) + 1,
    });
    return {
      hits: result.opportunities
        .map((o) => oppHit(ctx, o))
        .filter((h): h is ProviderHit => h !== null),
      hasMore: result.hasMore,
      freshness: { kind: "live" },
    };
  },
};
