import { describe, expect, it } from "vitest";
import { percentageDifference } from "@/lib/utils";
import { detectConflicts } from "@/lib/research/conflict-detector";
import type { SourceClaim } from "@/lib/research/schemas";
import { FIELD_KEYS } from "@/lib/research/constants";

function claim(fieldKey: string, sourceName: string, normalizedValue: string): SourceClaim {
  return {
    fieldKey,
    sourceName,
    sourceType: "mock",
    sourceUrl: null,
    sourceRecordId: null,
    rawValue: normalizedValue,
    normalizedValue,
    matchMethod: "mock",
    confidence: "medium",
    retrievedAt: new Date().toISOString(),
    sourceUpdatedAt: null,
  };
}

describe("percentageDifference", () => {
  it("returns zero for equal values", () => {
    expect(percentageDifference(100, 100)).toBe(0);
  });

  it("computes relative difference against the midpoint", () => {
    expect(percentageDifference(100, 110)).toBeCloseTo(9.523, 2);
  });
});

describe("detectConflicts", () => {
  it("flags APN mismatch as critical", () => {
    const conflicts = detectConflicts([
      claim(FIELD_KEYS.apn, "A", "111"),
      claim(FIELD_KEYS.apn, "B", "222"),
    ]);
    expect(
      conflicts.some((item) => item.fieldKey === FIELD_KEYS.apn && item.severity === "critical"),
    ).toBe(true);
  });

  it("flags lot-size differences greater than 3%", () => {
    const conflicts = detectConflicts([
      claim(FIELD_KEYS.lotSqFt, "A", "6000"),
      claim(FIELD_KEYS.lotSqFt, "B", "6250"),
    ]);
    expect(
      conflicts.some((item) => item.fieldKey === FIELD_KEYS.lotSqFt && item.severity === "warning"),
    ).toBe(true);
  });

  it("flags living-area differences greater than 5%", () => {
    const conflicts = detectConflicts([
      claim(FIELD_KEYS.livingAreaSqFt, "A", "1248"),
      claim(FIELD_KEYS.livingAreaSqFt, "B", "1350"),
    ]);
    expect(
      conflicts.some(
        (item) => item.fieldKey === FIELD_KEYS.livingAreaSqFt && item.severity === "warning",
      ),
    ).toBe(true);
  });

  it("flags bedroom and bathroom differences as warnings", () => {
    const conflicts = detectConflicts([
      claim(FIELD_KEYS.bedrooms, "A", "3"),
      claim(FIELD_KEYS.bedrooms, "B", "4"),
      claim(FIELD_KEYS.bathrooms, "A", "1"),
      claim(FIELD_KEYS.bathrooms, "B", "2"),
    ]);
    expect(conflicts.some((item) => item.fieldKey === FIELD_KEYS.bedrooms)).toBe(true);
    expect(conflicts.some((item) => item.fieldKey === FIELD_KEYS.bathrooms)).toBe(true);
  });

  it("flags year-built differences greater than 2 years", () => {
    const conflicts = detectConflicts([
      claim(FIELD_KEYS.yearBuilt, "A", "1939"),
      claim(FIELD_KEYS.yearBuilt, "B", "1945"),
    ]);
    expect(conflicts.some((item) => item.fieldKey === FIELD_KEYS.yearBuilt)).toBe(true);
  });

  it("flags zoning disagreement as critical", () => {
    const conflicts = detectConflicts([
      claim(FIELD_KEYS.zoning, "A", "R-1-8"),
      claim(FIELD_KEYS.zoning, "B", "R-2"),
    ]);
    expect(
      conflicts.some((item) => item.fieldKey === FIELD_KEYS.zoning && item.severity === "critical"),
    ).toBe(true);
  });

  it("flags coordinates outside parcel as critical", () => {
    const conflicts = detectConflicts([claim("coordinate_within_parcel", "GIS", "false")]);
    expect(
      conflicts.some(
        (item) => item.fieldKey === "coordinate_within_parcel" && item.severity === "critical",
      ),
    ).toBe(true);
  });

  it("flags large value estimate differences as information", () => {
    const conflicts = detectConflicts([
      claim(FIELD_KEYS.estimatedValue, "A", "1000000"),
      claim(FIELD_KEYS.estimatedValue, "B", "1300000"),
    ]);
    expect(
      conflicts.some(
        (item) => item.fieldKey === FIELD_KEYS.estimatedValue && item.severity === "information",
      ),
    ).toBe(true);
  });
});
