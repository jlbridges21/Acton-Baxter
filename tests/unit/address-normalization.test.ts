import { describe, expect, it } from "vitest";
import { isRejectableAddressText, selectedAddressFromParts } from "@/lib/address/normalizer";
import { selectedAddressSchema } from "@/lib/address/schemas";

describe("address normalization", () => {
  it("rejects PO boxes", () => {
    expect(isRejectableAddressText("PO Box 123 San Jose CA")).toMatch(/PO Boxes/i);
  });

  it("rejects city-only input", () => {
    expect(isRejectableAddressText("San Jose")).toBeTruthy();
  });

  it("accepts street addresses", () => {
    expect(isRejectableAddressText("1257 Dell Ave, Campbell, CA 95008")).toBeNull();
  });

  it("validates selected address schema for California", () => {
    const address = selectedAddressFromParts({
      placeId: "abc",
      formattedAddress: "1257 Dell Ave, Campbell, CA 95008, USA",
      addressLine1: "1257 Dell Ave",
      city: "Campbell",
      state: "CA",
      zipCode: "95008",
      county: "Santa Clara County",
      latitude: 37.287,
      longitude: -121.95,
    });
    expect(selectedAddressSchema.safeParse(address).success).toBe(true);
  });
});
