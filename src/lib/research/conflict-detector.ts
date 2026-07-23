import { CONFLICT_THRESHOLDS, FIELD_KEYS } from "./constants";
import type { ReportConflict, SourceClaim } from "./schemas";
import type { ClaimInput } from "./types";
import { percentageDifference } from "@/lib/utils";
import { normalizeApn, normalizeBathroomForCompare } from "@/lib/property/normalize";

function parseNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = value.replace(/[$,]/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function uniqueValues(claims: SourceClaim[]): string[] {
  return [
    ...new Set(
      claims
        .map((claim) => claim.normalizedValue?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  ];
}

function uniqueCanonicalApns(claims: SourceClaim[]): string[] {
  return [
    ...new Set(
      claims
        .map((claim) => normalizeApn(claim.normalizedValue ?? claim.rawValue))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function claimsFor(fieldKey: string, claims: SourceClaim[]): SourceClaim[] {
  return claims.filter((claim) => claim.fieldKey === fieldKey && claim.normalizedValue);
}

function conflictValues(claims: SourceClaim[]) {
  return claims.map((claim) => ({
    sourceName: claim.sourceName,
    value: claim.normalizedValue ?? claim.rawValue ?? "—",
    sourceUrl: claim.sourceUrl ?? null,
  }));
}

function pushIf(conflicts: ReportConflict[], condition: boolean, conflict: ReportConflict) {
  if (condition) conflicts.push(conflict);
}

export function detectConflicts(claims: SourceClaim[]): ReportConflict[] {
  const conflicts: ReportConflict[] = [];

  const apnClaims = claimsFor(FIELD_KEYS.apn, claims);
  const apnCanonical = uniqueCanonicalApns(apnClaims);
  pushIf(conflicts, apnCanonical.length > 1, {
    fieldKey: FIELD_KEYS.apn,
    fieldLabel: "APN",
    severity: "critical",
    description: `APN values disagree across sources: ${apnClaims
      .map((claim) => claim.normalizedValue)
      .filter(Boolean)
      .join(" vs ")}.`,
    values: conflictValues(apnClaims),
    recommendedResolution:
      "Confirm the assessor parcel number on the county assessor site before the PEM.",
  });

  const lotClaims = claimsFor(FIELD_KEYS.lotSqFt, claims);
  const lotNumbers = lotClaims
    .map((claim) => parseNumber(claim.normalizedValue))
    .filter((value): value is number => value !== null);
  if (lotNumbers.length >= 2) {
    const max = Math.max(...lotNumbers);
    const min = Math.min(...lotNumbers);
    const diff = percentageDifference(max, min);
    pushIf(conflicts, diff > CONFLICT_THRESHOLDS.lotSizePercent, {
      fieldKey: FIELD_KEYS.lotSqFt,
      fieldLabel: "Lot size",
      severity: "warning",
      description: `Lot size differs by ${diff.toFixed(1)}% across sources (${min.toLocaleString()} vs ${max.toLocaleString()} sq ft).`,
      values: conflictValues(lotClaims),
      recommendedResolution:
        "Use the county assessor / GIS parcel area and verify against a survey if ADU placement is tight.",
    });
  }

  const livingClaims = claimsFor(FIELD_KEYS.livingAreaSqFt, claims);
  const livingNumbers = livingClaims
    .map((claim) => parseNumber(claim.normalizedValue))
    .filter((value): value is number => value !== null);
  if (livingNumbers.length >= 2) {
    const max = Math.max(...livingNumbers);
    const min = Math.min(...livingNumbers);
    const diff = percentageDifference(max, min);
    pushIf(conflicts, diff > CONFLICT_THRESHOLDS.livingAreaPercent, {
      fieldKey: FIELD_KEYS.livingAreaSqFt,
      fieldLabel: "Living area",
      severity: "warning",
      description: `Living area differs by ${diff.toFixed(1)}% across sources (${min.toLocaleString()} vs ${max.toLocaleString()} sq ft).`,
      values: conflictValues(livingClaims),
      recommendedResolution:
        "Ask the homeowner which figure matches their records and confirm during Feasibility Package measurements.",
    });
  }

  const bedroomClaims = claimsFor(FIELD_KEYS.bedrooms, claims);
  const bedroomValues = uniqueValues(bedroomClaims);
  pushIf(conflicts, bedroomValues.length > 1, {
    fieldKey: FIELD_KEYS.bedrooms,
    fieldLabel: "Bedrooms",
    severity: "warning",
    description: `Bedroom counts disagree: ${bedroomValues.join(" vs ")}.`,
    values: conflictValues(bedroomClaims),
    recommendedResolution: "Confirm bedroom count with the homeowner during the PEM walkthrough.",
  });

  const bathroomClaims = claimsFor(FIELD_KEYS.bathrooms, claims);
  const bathroomValues = [
    ...new Set(
      bathroomClaims
        .map((claim) => normalizeBathroomForCompare(claim.normalizedValue))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  pushIf(conflicts, bathroomValues.length > 1, {
    fieldKey: FIELD_KEYS.bathrooms,
    fieldLabel: "Bathrooms",
    severity: "warning",
    description: `Bathroom counts disagree: ${bathroomValues.join(" vs ")}.`,
    values: conflictValues(bathroomClaims),
    recommendedResolution: "Confirm bathroom count with the homeowner during the PEM walkthrough.",
  });

  const yearClaims = claimsFor(FIELD_KEYS.yearBuilt, claims);
  const yearNumbers = yearClaims
    .map((claim) => parseNumber(claim.normalizedValue))
    .filter((value): value is number => value !== null);
  if (yearNumbers.length >= 2) {
    const max = Math.max(...yearNumbers);
    const min = Math.min(...yearNumbers);
    pushIf(conflicts, max - min > CONFLICT_THRESHOLDS.yearBuiltYears, {
      fieldKey: FIELD_KEYS.yearBuilt,
      fieldLabel: "Year built",
      severity: "warning",
      description: `Year built differs by ${max - min} years (${min} vs ${max}).`,
      values: conflictValues(yearClaims),
      recommendedResolution:
        "Prefer the county assessor year-built and note any remodel history during the PEM.",
    });
  }

  const zoningClaims = claimsFor(FIELD_KEYS.zoning, claims);
  const zoningValues = uniqueValues(zoningClaims);
  pushIf(conflicts, zoningValues.length > 1, {
    fieldKey: FIELD_KEYS.zoning,
    fieldLabel: "Zoning",
    severity: "critical",
    description: `Zoning designations disagree: ${zoningValues.join(" vs ")}.`,
    values: conflictValues(zoningClaims),
    recommendedResolution:
      "Verify zoning on the city planning map and with planning staff before quoting feasibility.",
  });

  const valueClaims = claimsFor(FIELD_KEYS.estimatedValue, claims);
  const valueNumbers = valueClaims
    .map((claim) => parseNumber(claim.normalizedValue))
    .filter((value): value is number => value !== null);
  if (valueNumbers.length >= 2) {
    const max = Math.max(...valueNumbers);
    const min = Math.min(...valueNumbers);
    const diff = percentageDifference(max, min);
    pushIf(conflicts, diff > CONFLICT_THRESHOLDS.valueEstimatePercent, {
      fieldKey: FIELD_KEYS.estimatedValue,
      fieldLabel: "Estimated value",
      severity: "information",
      description: `Value estimates differ by ${diff.toFixed(1)}%.`,
      values: conflictValues(valueClaims),
      recommendedResolution:
        "Treat automated valuations as directional only; they are not an appraisal.",
    });
  }

  const latClaims = claimsFor(FIELD_KEYS.latitude, claims);
  const lonClaims = claimsFor(FIELD_KEYS.longitude, claims);
  const outsideFlag = claims.find(
    (claim) =>
      claim.fieldKey === "coordinate_within_parcel" &&
      claim.normalizedValue?.toLowerCase() === "false",
  );
  pushIf(conflicts, Boolean(outsideFlag), {
    fieldKey: "coordinate_within_parcel",
    fieldLabel: "Coordinate / parcel match",
    severity: "critical",
    description: "Reported coordinates appear outside the parcel boundary polygon.",
    values: [
      ...conflictValues(latClaims),
      ...conflictValues(lonClaims),
      ...(outsideFlag
        ? [
            {
              sourceName: outsideFlag.sourceName,
              value: outsideFlag.normalizedValue ?? "false",
              sourceUrl: outsideFlag.sourceUrl ?? null,
            },
          ]
        : []),
    ],
    recommendedResolution:
      "Re-geocode the address against county GIS before relying on map overlays.",
  });

  return conflicts;
}

export function claimsFromInputs(inputs: ClaimInput[], retrievedAt: string): SourceClaim[] {
  return inputs.map((input) => ({
    fieldKey: input.fieldKey,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl ?? null,
    sourceRecordId: null,
    rawValue: input.rawValue,
    normalizedValue: input.normalizedValue,
    matchMethod: input.matchMethod,
    confidence: input.confidence,
    retrievedAt,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
  }));
}
