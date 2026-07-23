export type NormalizedAddress = {
  inputAddress: string;
  standardizedAddress: string;
  streetNumber: string | null;
  streetName: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  countyHint: string | null;
};

const CITY_COUNTY_HINTS: Record<string, string> = {
  "san jose": "Santa Clara",
  "santa clara": "Santa Clara",
  sunnyvale: "Santa Clara",
  cupertino: "Santa Clara",
  campbell: "Santa Clara",
  milpitas: "Santa Clara",
  "mountain view": "Santa Clara",
  "palo alto": "Santa Clara",
  "los gatos": "Santa Clara",
};

export function normalizeAddress(inputAddress: string): NormalizedAddress {
  const cleaned = inputAddress.replace(/\s+/g, " ").trim();
  const withState = cleaned.replace(/\bCalifornia\b/i, "CA");
  const parts = withState
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const street = parts[0] ?? withState;
  let city: string | null = parts[1] ?? null;
  let state: string | null = null;
  let zipCode: string | null = null;

  const stateZipPart = parts[2] ?? parts[1] ?? "";
  const stateZipMatch = stateZipPart.match(/\b([A-Z]{2})\b(?:\s+(\d{5}(?:-\d{4})?))?/i);
  if (stateZipMatch) {
    state = stateZipMatch[1]?.toUpperCase() ?? null;
    zipCode = stateZipMatch[2] ?? null;
    if (parts.length === 2 && stateZipMatch.index !== undefined && stateZipMatch.index > 0) {
      city = stateZipPart.slice(0, stateZipMatch.index).trim() || city;
    }
  }

  if (!state && /\bCA\b/i.test(withState)) {
    state = "CA";
  }

  if (!city) {
    const lower = withState.toLowerCase();
    for (const knownCity of Object.keys(CITY_COUNTY_HINTS)) {
      if (lower.includes(knownCity)) {
        city = knownCity
          .split(" ")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
        break;
      }
    }
  }

  const streetMatch = street.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  const streetNumber = streetMatch?.[1] ?? null;
  const streetName = streetMatch?.[2] ?? street;

  const cityLabel = city ?? "Unknown City";
  const stateLabel = state ?? "CA";
  const zipLabel = zipCode ? ` ${zipCode}` : "";
  const standardizedAddress = `${street}, ${cityLabel}, ${stateLabel}${zipLabel}`;

  const countyHint = city ? (CITY_COUNTY_HINTS[city.toLowerCase()] ?? null) : null;

  return {
    inputAddress: cleaned,
    standardizedAddress,
    streetNumber,
    streetName,
    city,
    state: stateLabel,
    zipCode,
    countyHint,
  };
}
