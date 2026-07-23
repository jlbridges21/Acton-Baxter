import { describe, expect, it } from "vitest";
import { apnsEqual, formatApnForDisplay, normalizeApn } from "@/lib/property/apn";
import { claimsFromInputs, detectConflicts } from "@/lib/research/conflict-detector";
import { FIELD_KEYS } from "@/lib/research/constants";
import type { ClaimInput } from "@/lib/research/types";

describe("APN normalization", () => {
  it("treats formatted and unformatted APNs as equal", () => {
    expect(normalizeApn("472-29-068")).toBe("47229068");
    expect(normalizeApn("47229068")).toBe("47229068");
    expect(apnsEqual("472-29-068", "47229068")).toBe(true);
  });

  it("preserves leading zeros", () => {
    expect(normalizeApn("012-003-004")).toBe("012003004");
  });

  it("handles whitespace and nulls", () => {
    expect(normalizeApn(" 472 29 068 ")).toBe("47229068");
    expect(normalizeApn(null)).toBeNull();
    expect(normalizeApn("")).toBeNull();
  });

  it("detects true mismatches", () => {
    expect(apnsEqual("472-29-068", "472-29-069")).toBe(false);
  });

  it("formats display without changing canonical equality", () => {
    expect(formatApnForDisplay("47229068")).toBe("472-29-068");
    expect(apnsEqual(formatApnForDisplay("47229068"), "47229068")).toBe(true);
  });

  it("does not create APN conflicts when only formatting differs", () => {
    const inputs: ClaimInput[] = [
      {
        fieldKey: FIELD_KEYS.apn,
        fieldLabel: "APN",
        sourceName: "ATTOM",
        sourceType: "licensed_property_api",
        sourceUrl: null,
        rawValue: "472-29-068",
        normalizedValue: "472-29-068",
        matchMethod: "address",
        confidence: "high",
        sourceUpdatedAt: null,
      },
      {
        fieldKey: FIELD_KEYS.apn,
        fieldLabel: "APN",
        sourceName: "Santa Clara County Parcels (ArcGIS)",
        sourceType: "county_gis",
        sourceUrl: null,
        rawValue: "47229068",
        normalizedValue: "47229068",
        matchMethod: "apn",
        confidence: "high",
        sourceUpdatedAt: null,
      },
    ];
    const conflicts = detectConflicts(claimsFromInputs(inputs, new Date().toISOString()));
    expect(conflicts.some((conflict) => conflict.fieldKey === FIELD_KEYS.apn)).toBe(false);
  });
});
