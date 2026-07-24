import { describe, expect, it } from "vitest";
import { isBrowsablePublicSourceUrl } from "@/components/reports/sources-section";

describe("source open links", () => {
  it("hides ATTOM developer portal URLs", () => {
    expect(isBrowsablePublicSourceUrl("https://api.developer.attomdata.com/home")).toBe(false);
    expect(isBrowsablePublicSourceUrl("https://api.developer.attomdata.com/")).toBe(false);
    expect(isBrowsablePublicSourceUrl(null)).toBe(false);
  });

  it("keeps real public GIS and portal links", () => {
    expect(
      isBrowsablePublicSourceUrl(
        "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer/270",
      ),
    ).toBe(true);
    expect(isBrowsablePublicSourceUrl("https://permits.sanjoseca.gov/search/")).toBe(true);
  });
});
