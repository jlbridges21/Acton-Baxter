import type { GhlContact } from "./types";

export type GhlContactAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  /** Inline formatted address, or null when no address components exist. */
  formatted: string | null;
  /** True when any address component is present (including city-only). */
  present: boolean;
  /** True when a street line exists. */
  hasStreet: boolean;
};

/**
 * Structured address from a normalized GHL contact.
 * Does not invent missing components.
 */
export function contactAddressFromGhl(
  contact: Pick<GhlContact, "address1" | "city" | "state" | "postalCode" | "country">,
): GhlContactAddress {
  const line1 = contact.address1?.trim() || null;
  const city = contact.city?.trim() || null;
  const state = contact.state?.trim() || null;
  const postalCode = contact.postalCode?.trim() || null;
  const country = contact.country?.trim() || null;
  const hasStreet = Boolean(line1);
  const present = Boolean(line1 || city || state || postalCode || country);

  let formatted: string | null = null;
  if (present) {
    const cityStateZip = [city, [state, postalCode].filter(Boolean).join(" ").trim() || null]
      .filter(Boolean)
      .join(", ");
    formatted = [
      line1,
      cityStateZip || null,
      country && country !== "US" && country !== "USA" ? country : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  return {
    line1,
    line2: null,
    city,
    state,
    postalCode,
    country,
    formatted: formatted || null,
    present,
    hasStreet,
  };
}

/** Multiline display for admin UI. */
export function formatGhlAddressMultiline(address: GhlContactAddress): string | null {
  if (!address.present) return null;
  const lines: string[] = [];
  if (address.line1) lines.push(address.line1);
  if (address.line2) lines.push(address.line2);
  const cityStateZip = [
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(" ").trim() || null,
  ]
    .filter(Boolean)
    .join(", ");
  if (cityStateZip) lines.push(cityStateZip);
  if (address.country && address.country !== "US" && address.country !== "USA") {
    lines.push(address.country);
  }
  return lines.join("\n") || null;
}

export type GhlSnapshotFocus =
  "address" | "owner" | "tags" | "custom_fields" | "opportunity" | "conversation" | "general";

/** Detect which CRM facets the employee question emphasizes. */
export function detectGhlSnapshotFocus(question: string): GhlSnapshotFocus[] {
  const q = question.toLowerCase();
  const focuses: GhlSnapshotFocus[] = [];
  if (/\b(address|street|mailing|live|lives|located|location|zip|postal)\b/.test(q)) {
    focuses.push("address");
  }
  if (/\b(owner|assigned|who owns|who is assigned)\b/.test(q)) {
    focuses.push("owner");
  }
  if (/\b(tags?|tagged)\b/.test(q)) {
    focuses.push("tags");
  }
  if (/\b(custom field|lead city|utm|source field)\b/.test(q)) {
    focuses.push("custom_fields");
  }
  if (/\b(opportunit|pipeline|stage|deal|value)\b/.test(q)) {
    focuses.push("opportunity");
  }
  if (
    /\b(last (talk|contact|message|email|call|communicat)|when did we|replied|conversation)\b/.test(
      q,
    )
  ) {
    focuses.push("conversation");
  }
  if (!focuses.length) focuses.push("general");
  return focuses;
}
