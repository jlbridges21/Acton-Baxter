import type { Confidence, SourceType } from "@/lib/research/types";
import type { PropertyFact, SourceClaim } from "@/lib/research/schemas";
import { FIELD_KEYS } from "@/lib/research/constants";

/**
 * Deterministic preferred-source priorities by field.
 * Higher score wins. Official GIS outranks licensed APIs for jurisdiction facts.
 */
const SOURCE_TYPE_WEIGHT: Record<SourceType, number> = {
  city_gis: 100,
  county_gis: 95,
  licensed_property_api: 70,
  state_government: 60,
  federal_government: 55,
  public_portal: 40,
  manual_link: 20,
  visual_observation: 10,
  mock: 0,
};

const FIELD_SOURCE_BONUS: Record<string, Record<string, number>> = {
  [FIELD_KEYS.apn]: {
    "Santa Clara County Parcels (ArcGIS)": 30,
    "San Jose ArcGIS Parcels": 25,
    ATTOM: 15,
  },
  [FIELD_KEYS.lotSqFt]: {
    "Santa Clara County Parcels (ArcGIS)": 30,
    "San Jose ArcGIS Parcels": 20,
    ATTOM: 15,
    RentCast: 5,
  },
  [FIELD_KEYS.livingAreaSqFt]: {
    ATTOM: 25,
    RentCast: 10,
  },
  [FIELD_KEYS.bedrooms]: {
    ATTOM: 25,
    RentCast: 10,
  },
  [FIELD_KEYS.bathrooms]: {
    ATTOM: 25,
    RentCast: 10,
  },
  [FIELD_KEYS.estimatedValue]: {
    ATTOM: 30,
    RentCast: 5,
  },
  [FIELD_KEYS.zoning]: {
    "San Jose ArcGIS Zoning": 40,
  },
  [FIELD_KEYS.generalPlan]: {
    "San Jose ArcGIS General Plan 2040": 40,
  },
};

const FIELD_LABELS: Record<string, string> = {
  [FIELD_KEYS.apn]: "APN",
  [FIELD_KEYS.lotSqFt]: "Lot size",
  [FIELD_KEYS.livingAreaSqFt]: "Living area",
  [FIELD_KEYS.bedrooms]: "Bedrooms",
  [FIELD_KEYS.bathrooms]: "Bathrooms",
  [FIELD_KEYS.stories]: "Stories",
  [FIELD_KEYS.yearBuilt]: "Year built",
  [FIELD_KEYS.propertyType]: "Property type",
  [FIELD_KEYS.estimatedValue]: "Estimated value",
  [FIELD_KEYS.assessedValue]: "Assessed value",
  [FIELD_KEYS.lastSaleDate]: "Last sale date",
  [FIELD_KEYS.lastSalePrice]: "Last sale price",
  [FIELD_KEYS.ownerName]: "Owner name",
  [FIELD_KEYS.ownerMailingAddress]: "Owner mailing address",
  [FIELD_KEYS.subdivision]: "Subdivision",
  [FIELD_KEYS.tractNumber]: "Tract number",
  [FIELD_KEYS.zoning]: "Zoning",
  [FIELD_KEYS.generalPlan]: "General Plan",
  [FIELD_KEYS.historicStatus]: "Historic status",
  [FIELD_KEYS.floodZone]: "Flood zone",
  [FIELD_KEYS.fireZone]: "Fire zone",
  [FIELD_KEYS.wuiClassification]: "Wildland-Urban Interface (WUI)",
  [FIELD_KEYS.nearestHydrantDistanceFt]: "Nearest mapped hydrant (straight-line)",
  [FIELD_KEYS.latitude]: "Latitude",
  [FIELD_KEYS.longitude]: "Longitude",
  [FIELD_KEYS.taxRateArea]: "Tax rate area",
  [FIELD_KEYS.buildingCount]: "Building count",
  [FIELD_KEYS.foundationType]: "Foundation type",
};

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreClaim(fieldKey: string, claim: SourceClaim): number {
  let score = SOURCE_TYPE_WEIGHT[claim.sourceType] ?? 0;
  score += FIELD_SOURCE_BONUS[fieldKey]?.[claim.sourceName] ?? 0;
  if (claim.matchMethod === "apn" || claim.matchMethod === "parcel_geometry") score += 8;
  if (claim.matchMethod === "address") score += 5;
  if (claim.matchMethod === "coordinate") score += 3;
  if (claim.confidence === "high") score += 5;
  if (claim.confidence === "medium") score += 2;
  if (claim.confidence === "low") score -= 2;
  if (claim.confidence === "unavailable") score -= 50;
  if (!claim.normalizedValue) score -= 100;
  return score;
}

export function selectPreferredClaim(fieldKey: string, claims: SourceClaim[]): SourceClaim | null {
  const candidates = claims.filter((claim) => claim.fieldKey === fieldKey && claim.normalizedValue);
  if (candidates.length === 0) return null;
  return (
    [...candidates].sort((a, b) => scoreClaim(fieldKey, b) - scoreClaim(fieldKey, a))[0] ?? null
  );
}

export function selectPreferredFact(
  fieldKey: string,
  claims: SourceClaim[],
  options?: {
    category?: string;
    unit?: string | null;
  },
): PropertyFact | null {
  const preferred = selectPreferredClaim(fieldKey, claims);
  if (!preferred?.normalizedValue) return null;

  const numericFields = new Set<string>([
    FIELD_KEYS.lotSqFt,
    FIELD_KEYS.livingAreaSqFt,
    FIELD_KEYS.bedrooms,
    FIELD_KEYS.bathrooms,
    FIELD_KEYS.stories,
    FIELD_KEYS.yearBuilt,
    FIELD_KEYS.estimatedValue,
    FIELD_KEYS.assessedValue,
    FIELD_KEYS.lastSalePrice,
    FIELD_KEYS.latitude,
    FIELD_KEYS.longitude,
    FIELD_KEYS.buildingCount,
    FIELD_KEYS.nearestHydrantDistanceFt,
  ]);

  const numberValue = numericFields.has(fieldKey) ? parseNumber(preferred.normalizedValue) : null;

  return {
    category: options?.category ?? "characteristics",
    fieldKey,
    fieldLabel: FIELD_LABELS[fieldKey] ?? fieldKey,
    normalizedValueText: preferred.normalizedValue,
    normalizedValueNumber: numberValue,
    normalizedValueBoolean: null,
    unit: options?.unit ?? null,
    preferredSourceName: preferred.sourceName,
    preferredSourceUrl: preferred.sourceUrl ?? null,
    confidence: preferred.confidence as Confidence,
  };
}

export function buildPreferredFacts(claims: SourceClaim[]): PropertyFact[] {
  const specs: Array<{ fieldKey: string; category: string; unit?: string | null }> = [
    { fieldKey: FIELD_KEYS.apn, category: "identity" },
    { fieldKey: FIELD_KEYS.lotSqFt, category: "characteristics", unit: "sq ft" },
    { fieldKey: FIELD_KEYS.livingAreaSqFt, category: "characteristics", unit: "sq ft" },
    { fieldKey: FIELD_KEYS.bedrooms, category: "characteristics" },
    { fieldKey: FIELD_KEYS.bathrooms, category: "characteristics" },
    { fieldKey: FIELD_KEYS.stories, category: "characteristics" },
    { fieldKey: FIELD_KEYS.yearBuilt, category: "characteristics" },
    { fieldKey: FIELD_KEYS.propertyType, category: "characteristics" },
    { fieldKey: FIELD_KEYS.estimatedValue, category: "characteristics", unit: "USD" },
    { fieldKey: FIELD_KEYS.assessedValue, category: "characteristics", unit: "USD" },
    { fieldKey: FIELD_KEYS.lastSaleDate, category: "characteristics" },
    { fieldKey: FIELD_KEYS.lastSalePrice, category: "characteristics", unit: "USD" },
    { fieldKey: FIELD_KEYS.ownerName, category: "characteristics" },
    { fieldKey: FIELD_KEYS.ownerMailingAddress, category: "characteristics" },
    { fieldKey: FIELD_KEYS.subdivision, category: "characteristics" },
    { fieldKey: FIELD_KEYS.tractNumber, category: "characteristics" },
    { fieldKey: FIELD_KEYS.taxRateArea, category: "characteristics" },
    { fieldKey: FIELD_KEYS.buildingCount, category: "characteristics" },
    { fieldKey: FIELD_KEYS.foundationType, category: "characteristics" },
    { fieldKey: FIELD_KEYS.zoning, category: "planning" },
    { fieldKey: FIELD_KEYS.generalPlan, category: "planning" },
    { fieldKey: FIELD_KEYS.historicStatus, category: "planning" },
    { fieldKey: FIELD_KEYS.floodZone, category: "planning" },
    { fieldKey: FIELD_KEYS.fireZone, category: "planning" },
    { fieldKey: FIELD_KEYS.wuiClassification, category: "planning" },
    { fieldKey: FIELD_KEYS.nearestHydrantDistanceFt, category: "planning", unit: "ft" },
    { fieldKey: FIELD_KEYS.latitude, category: "identity" },
    { fieldKey: FIELD_KEYS.longitude, category: "identity" },
  ];

  return specs
    .map((spec) => selectPreferredFact(spec.fieldKey, claims, spec))
    .filter((fact): fact is PropertyFact => fact !== null);
}
