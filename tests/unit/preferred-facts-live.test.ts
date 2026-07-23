import { describe, expect, it } from "vitest";
import { claimsFromInputs, detectConflicts } from "@/lib/research/conflict-detector";
import { FIELD_KEYS } from "@/lib/research/constants";
import { selectPreferredFact } from "@/lib/research/select-preferred-fact";
import type { ClaimInput } from "@/lib/research/types";

function makeClaim(
  fieldKey: string,
  sourceName: string,
  sourceType: ClaimInput["sourceType"],
  value: string,
  extras?: Partial<ClaimInput>,
): ClaimInput {
  return {
    fieldKey,
    fieldLabel: fieldKey,
    sourceName,
    sourceType,
    sourceUrl: null,
    rawValue: value,
    normalizedValue: value,
    matchMethod: "address",
    confidence: "medium",
    sourceUpdatedAt: null,
    ...extras,
  };
}

describe("preferred fact selection", () => {
  it("prefers county GIS APN over ATTOM", () => {
    const claims = claimsFromInputs(
      [
        makeClaim(FIELD_KEYS.apn, "ATTOM", "licensed_property_api", "111"),
        makeClaim(FIELD_KEYS.apn, "Santa Clara County Parcels (ArcGIS)", "county_gis", "47222019", {
          matchMethod: "apn",
          confidence: "high",
        }),
      ],
      new Date().toISOString(),
    );

    const fact = selectPreferredFact(FIELD_KEYS.apn, claims);
    expect(fact?.normalizedValueText).toBe("47222019");
    expect(fact?.preferredSourceName).toBe("Santa Clara County Parcels (ArcGIS)");
  });

  it("prefers ATTOM living area over RentCast", () => {
    const claims = claimsFromInputs(
      [
        makeClaim(FIELD_KEYS.livingAreaSqFt, "RentCast", "licensed_property_api", "1100"),
        makeClaim(FIELD_KEYS.livingAreaSqFt, "ATTOM", "licensed_property_api", "1200", {
          confidence: "high",
        }),
      ],
      new Date().toISOString(),
    );
    const fact = selectPreferredFact(FIELD_KEYS.livingAreaSqFt, claims, {
      category: "characteristics",
      unit: "sq ft",
    });
    expect(fact?.normalizedValueNumber).toBe(1200);
    expect(fact?.preferredSourceName).toBe("ATTOM");
  });

  it("prefers San Jose zoning GIS", () => {
    const claims = claimsFromInputs(
      [
        makeClaim(FIELD_KEYS.zoning, "San Jose ArcGIS Zoning", "city_gis", "R-1-8", {
          matchMethod: "coordinate",
          confidence: "high",
        }),
      ],
      new Date().toISOString(),
    );
    expect(selectPreferredFact(FIELD_KEYS.zoning, claims)?.normalizedValueText).toBe("R-1-8");
  });
});

describe("live conflict detection", () => {
  it("detects APN disagreements", () => {
    const claims = claimsFromInputs(
      [
        makeClaim(FIELD_KEYS.apn, "ATTOM", "licensed_property_api", "111"),
        makeClaim(FIELD_KEYS.apn, "Santa Clara County Parcels (ArcGIS)", "county_gis", "47222019"),
      ],
      new Date().toISOString(),
    );
    const conflicts = detectConflicts(claims);
    expect(conflicts.some((conflict) => conflict.fieldKey === FIELD_KEYS.apn)).toBe(true);
  });

  it("flags coordinates outside parcel polygon", () => {
    const claims = claimsFromInputs(
      [
        makeClaim("coordinate_within_parcel", "San Jose ArcGIS Parcels", "city_gis", "false", {
          matchMethod: "parcel_geometry",
          confidence: "high",
        }),
      ],
      new Date().toISOString(),
    );
    const conflicts = detectConflicts(claims);
    expect(
      conflicts.some(
        (conflict) =>
          conflict.fieldKey === "coordinate_within_parcel" && conflict.severity === "critical",
      ),
    ).toBe(true);
  });
});
