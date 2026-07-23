import { describe, expect, it } from "vitest";
import {
  normalizeRentCastProperty,
  selectBestRentCastMatch,
} from "@/lib/providers/rentcast/normalizer";

const input = {
  address: "655 13th St, San Jose, CA 95112",
  standardizedAddress: "655 13th St, San Jose, CA 95112",
  city: "San Jose",
  state: "CA",
  zipCode: "95112",
  latitude: 37.342,
  longitude: -121.877,
};

describe("RentCast normalizer and matching", () => {
  it("normalizes property fields", () => {
    const normalized = normalizeRentCastProperty(
      {
        id: "rc-1",
        formattedAddress: "655 13th St, San Jose, CA 95112",
        addressLine1: "655 13th St",
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
        county: "Santa Clara",
        latitude: 37.342,
        longitude: -121.877,
        propertyType: "Single Family",
        bedrooms: 3,
        bathrooms: 2,
        squareFootage: 1200,
        lotSize: 6000,
        yearBuilt: 1925,
        floorCount: 1,
        features: { pool: false },
        owner: { names: "Sample Owner" },
      },
      input,
    );

    expect(normalized.id).toBe("rc-1");
    expect(normalized.livingAreaSquareFootage).toBe(1200);
    expect(normalized.lotSquareFootage).toBe(6000);
    expect(normalized.matchMethod).toBe("address");
    expect(normalized.matchScore).toBeGreaterThanOrEqual(60);
  });

  it("selects the exact address match among multiple results", () => {
    const candidates = [
      normalizeRentCastProperty(
        {
          id: "wrong",
          addressLine1: "700 13th St",
          city: "San Jose",
          state: "CA",
          zipCode: "95112",
          formattedAddress: "700 13th St, San Jose, CA 95112",
        },
        input,
      ),
      normalizeRentCastProperty(
        {
          id: "right",
          addressLine1: "655 13th St",
          city: "San Jose",
          state: "CA",
          zipCode: "95112",
          formattedAddress: "655 13th St, San Jose, CA 95112",
        },
        input,
      ),
    ];

    const best = selectBestRentCastMatch(candidates);
    expect(best?.id).toBe("right");
  });

  it("returns null when no confident match exists", () => {
    const candidates = [
      normalizeRentCastProperty(
        {
          id: "far",
          addressLine1: "100 Main St",
          city: "Oakland",
          state: "CA",
          zipCode: "94607",
          formattedAddress: "100 Main St, Oakland, CA 94607",
        },
        input,
      ),
    ];
    expect(selectBestRentCastMatch(candidates)).toBeNull();
  });

  it("tolerates missing optional fields", () => {
    const normalized = normalizeRentCastProperty(
      {
        formattedAddress: "655 13th St, San Jose, CA 95112",
        addressLine1: "655 13th St",
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
      },
      input,
    );
    expect(normalized.bedrooms).toBeNull();
    expect(normalized.ownerNames).toBeNull();
    expect(normalized.matchMethod).toBe("address");
  });
});
