import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildGhlAddressFreeTextQuery,
  buildGhlAddressSearchFilters,
  contactAddressFromGhl,
  contactMatchesAddressQuery,
  isLikelyAddressSearchQuery,
} from "@/lib/connectors/ghl/address";
import { buildContactSearchBody } from "@/lib/connectors/ghl/request-contracts";
import { normalizeContact } from "@/lib/connectors/ghl/normalize";
import type { GhlContact } from "@/lib/connectors/ghl/types";

describe("GHL contacts UI — address search helpers", () => {
  it("detects ZIP, street, and city queries", () => {
    expect(isLikelyAddressSearchQuery("95125")).toBe(true);
    expect(isLikelyAddressSearchQuery("123 Main")).toBe(true);
    expect(isLikelyAddressSearchQuery("San Jose")).toBe(true);
    expect(isLikelyAddressSearchQuery("CA")).toBe(true);
    expect(isLikelyAddressSearchQuery("rachel@example.com")).toBe(false);
  });

  it("builds GHL filters using documented search filter field names", () => {
    const filters = buildGhlAddressSearchFilters("95125");
    expect(filters).toHaveLength(1);
    const group = filters[0] as { group: string; filters: Array<{ field: string }> };
    expect(group.group).toBe("OR");
    // `address1` is rejected (400 "Invalid field address1"); `country` has no `contains`.
    expect(group.filters.map((f) => f.field)).toEqual(["address", "city", "state", "postalCode"]);
  });

  it("strips special characters and caps filter values at 75 chars", () => {
    const [group] = buildGhlAddressSearchFilters("123 Main St., #4") as Array<{
      filters: Array<{ value: string }>;
    }>;
    expect(group!.filters[0]!.value).toBe("123 Main St 4");
    const [long] = buildGhlAddressSearchFilters("9".repeat(100)) as Array<{
      filters: Array<{ value: string }>;
    }>;
    expect(long!.filters[0]!.value).toHaveLength(75);
    expect(buildGhlAddressSearchFilters("#,.")).toEqual([]);
  });

  it("builds a street-only free-text query", () => {
    expect(buildGhlAddressFreeTextQuery("123 Main St, San Jose, CA 95125")).toBe("123 Main St");
    expect(buildGhlAddressFreeTextQuery("  95125 ")).toBe("95125");
  });

  it("includes filters in contact search body contract", () => {
    const body = buildContactSearchBody({
      locationId: "loc-1",
      page: 1,
      limit: 25,
      filters: buildGhlAddressSearchFilters("San Jose"),
    });
    expect(body.pageLimit).toBe(25);
    expect(body.filters).toBeDefined();
    expect(Array.isArray(body.filters)).toBe(true);
    expect("limit" in body).toBe(false);
  });

  it("matches partial formatted address locally after normalize", () => {
    const contact = normalizeContact({
      id: "c1",
      address1: "123 Main St",
      city: "San Jose",
      state: "CA",
      postalCode: "95125",
      country: "US",
    });
    expect(contactMatchesAddressQuery(contact, "123 Main")).toBe(true);
    expect(contactMatchesAddressQuery(contact, "San Jose")).toBe(true);
    expect(contactMatchesAddressQuery(contact, "95125")).toBe(true);
    expect(contactMatchesAddressQuery(contact, "Oakland")).toBe(false);
    expect(contactAddressFromGhl(contact).formatted).toBe("123 Main St, San Jose, CA 95125");
  });
});

describe("hydrateContactRows address column", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("formats address for list rows and hydrates thin search payloads", async () => {
    vi.doMock("@/lib/connectors/ghl/reference-data", () => ({
      getGhlReferenceData: async () => null,
      resolveUserDisplayName: () => null,
      resolveTagDisplayName: (_: unknown, t: string) => t,
    }));
    vi.doMock("@/lib/connectors/ghl/resources/contacts", () => ({
      getContactsByIds: async (ids: string[]) => {
        const map = new Map<string, GhlContact>();
        for (const id of ids) {
          map.set(id, {
            id,
            locationId: "loc",
            firstName: "Rachel",
            lastName: "Redmond",
            name: "Rachel Redmond",
            email: null,
            phone: null,
            companyName: null,
            address1: "123 Main St",
            city: "San Jose",
            state: "CA",
            postalCode: "95125",
            country: "US",
            source: null,
            tags: [],
            customFields: {},
            dateAdded: null,
            dateUpdated: null,
            dnd: false,
            assignedTo: null,
          });
        }
        return map;
      },
    }));

    const { hydrateContactRows } = await import("@/lib/connectors/ghl/admin-views");
    const thin: GhlContact = {
      id: "c1",
      locationId: "loc",
      firstName: "Rachel",
      lastName: "Redmond",
      name: "Rachel Redmond",
      email: null,
      phone: null,
      companyName: null,
      address1: null,
      city: "San Jose",
      state: "CA",
      postalCode: null,
      country: null,
      source: null,
      tags: [],
      customFields: {},
      dateAdded: null,
      dateUpdated: null,
      dnd: false,
      assignedTo: null,
    };

    const rows = await hydrateContactRows([thin]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.addressFormatted).toBe("123 Main St, San Jose, CA 95125");
    expect(rows[0]!.address1).toBe("123 Main St");
    expect(rows[0]!.postalCode).toBe("95125");
  });

  it("skips full fetch when address1 already present on search row", async () => {
    const getContactsByIds = vi.fn(async () => new Map());
    vi.doMock("@/lib/connectors/ghl/reference-data", () => ({
      getGhlReferenceData: async () => null,
      resolveUserDisplayName: () => null,
      resolveTagDisplayName: (_: unknown, t: string) => t,
    }));
    vi.doMock("@/lib/connectors/ghl/resources/contacts", () => ({
      getContactsByIds,
    }));

    const { hydrateContactRows } = await import("@/lib/connectors/ghl/admin-views");
    const fullEnough: GhlContact = {
      id: "c2",
      locationId: "loc",
      firstName: "A",
      lastName: "B",
      name: "A B",
      email: null,
      phone: null,
      companyName: null,
      address1: "9 Oak Rd",
      city: "Oakland",
      state: "CA",
      postalCode: "94601",
      country: "US",
      source: null,
      tags: [],
      customFields: {},
      dateAdded: null,
      dateUpdated: null,
      dnd: false,
      assignedTo: null,
    };

    const rows = await hydrateContactRows([fullEnough]);
    expect(getContactsByIds).not.toHaveBeenCalled();
    expect(rows[0]!.addressFormatted).toBe("9 Oak Rd, Oakland, CA 94601");
  });
});

describe("searchContactsForAdminBrowse address search", () => {
  type Body = { query?: string; filters?: unknown[] };

  function rawContact(id: string, address1: string | null, extra: Record<string, unknown> = {}) {
    return {
      id,
      firstName: `First${id}`,
      lastName: "Last",
      address1,
      city: address1 ? "San Jose" : null,
      state: address1 ? "CA" : null,
      postalCode: address1 ? "95125" : null,
      country: "US",
      ...extra,
    };
  }

  async function loadWithGhlPost(ghlPost: (path: string, body: Body) => Promise<unknown>) {
    vi.resetModules();
    vi.doUnmock("@/lib/connectors/ghl/resources/contacts");
    const post = vi.fn(ghlPost);
    vi.doMock("@/lib/connectors/ghl/client", () => ({
      ghlGet: vi.fn(async () => {
        throw new Error("ghlGet should not be called");
      }),
      ghlPost: post,
    }));
    vi.doMock("@/lib/connectors/ghl/config", () => ({
      requireGhlLocationId: () => "loc-1",
    }));
    const mod = await import("@/lib/connectors/ghl/resources/contacts");
    return { ...mod, post };
  }

  const invalidField = () =>
    Promise.reject(Object.assign(new Error("Invalid field address1"), { status: 400 }));

  it("returns street matches from the free-text query when address filters are rejected", async () => {
    const { searchContactsForAdminBrowse, post } = await loadWithGhlPost(async (_path, body) => {
      if (body.filters) return invalidField();
      return {
        contacts: [rawContact("other", null), rawContact("match", "123 Main St")],
        meta: { total: 2 },
      };
    });

    const result = await searchContactsForAdminBrowse({
      query: "123 Main St, San Jose",
      limit: 25,
    });

    expect(result.contacts.map((c) => c.id)).toEqual(["match", "other"]);
    const queryBody = post.mock.calls.find(([, b]) => !b.filters)![1];
    expect(queryBody.query).toBe("123 Main St");
  });

  it("sends only documented filter fields and merges filter hits ahead of query hits", async () => {
    const { searchContactsForAdminBrowse, post } = await loadWithGhlPost(async (_path, body) => {
      if (body.filters) {
        return { contacts: [rawContact("zip", "9 Oak Rd")], meta: { total: 1 } };
      }
      return { contacts: [rawContact("street", "95125 Elm Ave")], meta: { total: 1 } };
    });

    const result = await searchContactsForAdminBrowse({ query: "95125", limit: 25 });

    expect(result.contacts.map((c) => c.id)).toEqual(["zip", "street"]);
    const filterBody = post.mock.calls.find(([, b]) => b.filters)![1];
    const fields = (
      filterBody.filters as Array<{ filters: Array<{ field: string }> }>
    )[0]!.filters.map((f) => f.field);
    expect(fields).not.toContain("address1");
    expect(fields).not.toContain("country");
    expect(fields).toContain("address");
  });

  it("returns an empty result when both GHL calls fail", async () => {
    const { searchContactsForAdminBrowse } = await loadWithGhlPost(async () => invalidField());
    const result = await searchContactsForAdminBrowse({ query: "123 Main", limit: 10 });
    expect(result.contacts).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("keeps name search results when address filters fail on a name-like query", async () => {
    const { searchContactsForAdminBrowse } = await loadWithGhlPost(async (_path, body) => {
      if (body.filters) return invalidField();
      return {
        contacts: [rawContact("rachel", null, { firstName: "Rachel" })],
        meta: { total: 1 },
      };
    });
    const result = await searchContactsForAdminBrowse({ query: "rachel@", limit: 10 });
    expect(result.contacts.map((c) => c.id)).toEqual(["rachel"]);
  });
});
