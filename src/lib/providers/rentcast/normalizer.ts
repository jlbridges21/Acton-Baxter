import type { PropertyLookupInput } from "@/lib/research/types";
import type { RentCastNormalizedProperty } from "./types";

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function normalizeStreet(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\s+/g, " ")
    .trim();
}

function haversineFeet(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 3958.8 * 5280;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function normalizeRentCastProperty(
  property: Record<string, unknown>,
  input: PropertyLookupInput,
): RentCastNormalizedProperty {
  const addressLine1 = toStringValue(property.addressLine1 ?? property.line1);
  const city = toStringValue(property.city);
  const state = toStringValue(property.state);
  const zipCode = toStringValue(property.zipCode ?? property.zip);
  const formattedAddress = toStringValue(property.formattedAddress ?? property.address);
  const latitude = toNumber(property.latitude);
  const longitude = toNumber(property.longitude);

  const inputStreet = normalizeStreet(
    (input.standardizedAddress ?? input.address).split(",")[0] ?? input.address,
  );
  const candidateStreet = normalizeStreet(addressLine1 ?? formattedAddress?.split(",")[0]);
  const exactStreet = Boolean(candidateStreet && inputStreet && candidateStreet === inputStreet);
  const exactZip =
    Boolean(zipCode && input.zipCode) && zipCode?.slice(0, 5) === input.zipCode?.slice(0, 5);
  const cityStateMatch =
    Boolean(city && input.city) &&
    city?.toLowerCase() === input.city?.toLowerCase() &&
    (!input.state || state?.toUpperCase() === input.state.toUpperCase());

  let matchScore = 0;
  let matchMethod: RentCastNormalizedProperty["matchMethod"] = "none";
  if (exactStreet) {
    matchScore += 60;
    matchMethod = "address";
  }
  if (exactZip) {
    matchScore += 20;
    if (matchMethod === "none") matchMethod = "zip";
  }
  if (cityStateMatch) {
    matchScore += 10;
    if (matchMethod === "none") matchMethod = "city_state";
  }
  if (
    latitude !== null &&
    longitude !== null &&
    input.latitude != null &&
    input.longitude != null
  ) {
    const feet = haversineFeet(input.latitude, input.longitude, latitude, longitude);
    if (feet <= 150) {
      matchScore += feet <= 50 ? 20 : 10;
      if (matchMethod === "none") matchMethod = "coordinate";
    }
  }

  const owner = property.owner as Record<string, unknown> | undefined;
  const features = property.features as Record<string, unknown> | undefined;
  const taxAssessments = property.taxAssessments as Record<string, unknown> | undefined;
  const lastSale = Array.isArray(property.history)
    ? (property.history[0] as Record<string, unknown> | undefined)
    : (property.lastSale as Record<string, unknown> | undefined);

  const assessedValues = taxAssessments
    ? Object.values(taxAssessments).find((item) => item && typeof item === "object")
    : null;
  const assessedRecord =
    assessedValues && typeof assessedValues === "object"
      ? (assessedValues as Record<string, unknown>)
      : {};

  return {
    id: toStringValue(property.id),
    formattedAddress,
    addressLine1,
    city,
    state,
    zipCode,
    county: toStringValue(property.county),
    latitude,
    longitude,
    propertyType: toStringValue(property.propertyType),
    bedrooms: toNumber(property.bedrooms),
    bathrooms: toNumber(property.bathrooms),
    livingAreaSquareFootage: toNumber(property.squareFootage ?? property.livingArea),
    lotSquareFootage: toNumber(property.lotSize ?? property.lotSquareFootage),
    yearBuilt: toNumber(property.yearBuilt),
    stories: toNumber(property.floorCount ?? features?.floorCount),
    pool: typeof features?.pool === "boolean" ? features.pool : null,
    garage: toStringValue(features?.garageType ?? features?.garage),
    assessedValue: toNumber(assessedRecord.value ?? assessedRecord.assessedValue),
    taxAmount: toNumber(assessedRecord.taxAmount ?? property.propertyTaxes),
    ownerNames: toStringValue(owner?.names ?? owner?.name),
    ownerMailingAddress: toStringValue(owner?.mailingAddress),
    lastSaleDate: toStringValue(lastSale?.date ?? lastSale?.saleDate),
    lastSalePrice: toNumber(lastSale?.price ?? lastSale?.amount),
    subdivision: toStringValue(property.subdivision),
    matchScore,
    matchMethod,
    raw: property,
  };
}

export function selectBestRentCastMatch(
  candidates: RentCastNormalizedProperty[],
): RentCastNormalizedProperty | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => b.matchScore - a.matchScore);
  const best = ranked[0]!;
  // Require a confident street or very strong combined score.
  if (best.matchScore < 60 && best.matchMethod !== "address") {
    return null;
  }
  return best;
}
