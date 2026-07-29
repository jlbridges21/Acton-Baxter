import { describe, expect, it, vi, beforeEach } from "vitest";
import {
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

  it("builds GHL filters using real contact field names", () => {
    const filters = buildGhlAddressSearchFilters("95125");
    expect(filters).toHaveLength(1);
    const group = filters[0] as { group: string; filters: Array<{ field: string }> };
    expect(group.group).toBe("OR");
    expect(group.filters.map((f) => f.field)).toEqual([
      "address1",
      "city",
      "state",
      "postalCode",
      "country",
    ]);
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
