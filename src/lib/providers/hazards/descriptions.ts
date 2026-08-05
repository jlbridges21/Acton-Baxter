/** Plain-language FEMA flood zone descriptions for report display. */

const ZONE_DESCRIPTIONS: Record<string, string> = {
  A: "Special Flood Hazard Area (1% annual chance flood) — no base flood elevation shown",
  AE: "Special Flood Hazard Area (1% annual chance flood) with base flood elevations",
  AH: "Special Flood Hazard Area — shallow flooding (usually ponding)",
  AO: "Special Flood Hazard Area — shallow flooding (usually sheet flow)",
  AR: "Special Flood Hazard Area — temporary flood protection restoration",
  A99: "Special Flood Hazard Area — federal flood protection system under construction",
  V: "Coastal high hazard area (1% annual chance flood with wave action)",
  VE: "Coastal high hazard area with base flood elevations",
  X: "Area of Minimal Flood Hazard (outside the 1% annual chance floodplain)",
  D: "Flood hazard undetermined (no analysis completed)",
};

export function describeFemaFloodZone(
  fldZone: string | null | undefined,
  zoneSubtype: string | null | undefined,
): string {
  const zone = (fldZone ?? "").trim().toUpperCase();
  const subtype = (zoneSubtype ?? "").trim();
  if (!zone) return "Flood zone not determined";

  if (zone === "X" && /0\.2\s*PCT/i.test(subtype)) {
    return "X — 0.2% annual chance flood hazard (moderate/500-year)";
  }

  const base = ZONE_DESCRIPTIONS[zone] ?? `FEMA flood zone ${zone}`;
  if (subtype && subtype !== "0" && !/^AREA OF MINIMAL/i.test(subtype)) {
    const prettySubtype = subtype
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    if (zone === "X" && /MINIMAL/i.test(subtype)) {
      return `X — ${base}`;
    }
    return `${zone} — ${base} (${prettySubtype})`;
  }
  return `${zone} — ${base}`;
}
