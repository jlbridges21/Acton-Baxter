import type { SelectedAddress } from "./types";

const PO_BOX = /\b(p\.?\s*o\.?\s*box|post\s*office\s*box)\b/i;
const INTERSECTION =
  /\b(and|&|@)\b.+\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|way|ln|lane)\b/i;

export function isRejectableAddressText(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter a property address.";
  if (PO_BOX.test(trimmed)) return "PO Boxes are not supported. Enter a street address.";
  if (!/\d/.test(trimmed)) return "Enter a street number with the address.";
  if (!/[a-zA-Z]/.test(trimmed)) return "Enter a street name with the address.";
  // City-only heuristic: very short and no street-type token
  if (
    trimmed.split(/\s+/).length <= 2 &&
    !/\b(st|street|ave|avenue|rd|road|blvd|dr|drive|way|ln|ct|court|pl|place)\b/i.test(trimmed)
  ) {
    return "Enter a full street address, not only a city.";
  }
  if (INTERSECTION.test(trimmed) && !/^\d/.test(trimmed)) {
    return "Intersection searches are not supported. Enter a street address.";
  }
  return null;
}

export function normalizeCountyName(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+County$/i, "").trim();
  return cleaned
    ? `${cleaned.replace(/\b\w/g, (c) => c.toUpperCase())} County`.replace(
        / County County$/i,
        " County",
      )
    : null;
}

export function normalizeZip(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{5})(?:-?\d{4})?$/);
  return match?.[1] ?? null;
}

export function toTitleCaseStreet(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Ne|Nw|Se|Sw)\b/g, (c) => c.toUpperCase());
}

export function selectedAddressFromParts(input: {
  placeId?: string | null;
  formattedAddress: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  county?: string | null;
  country?: string;
  latitude: number;
  longitude: number;
}): SelectedAddress {
  const state =
    input.state.trim().toUpperCase() === "CALIFORNIA" ? "CA" : input.state.trim().toUpperCase();
  return {
    placeId: input.placeId ?? null,
    formattedAddress: input.formattedAddress.trim(),
    addressLine1: toTitleCaseStreet(input.addressLine1.trim()),
    city: input.city.trim(),
    state,
    zipCode: normalizeZip(input.zipCode) ?? input.zipCode.trim().slice(0, 5),
    county: normalizeCountyName(input.county),
    country: (input.country ?? "US").toUpperCase().startsWith("US")
      ? "US"
      : (input.country ?? "US"),
    latitude: input.latitude,
    longitude: input.longitude,
  };
}

export function formatSelectedAddressOneLine(address: SelectedAddress): string {
  return `${address.addressLine1}, ${address.city}, ${address.state} ${address.zipCode}`;
}
