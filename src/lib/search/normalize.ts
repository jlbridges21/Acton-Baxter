/**
 * Text, identifier, and address normalization for Global Search. Pure and client-safe.
 *
 * Address normalization is deterministic (no geocoding API): case, whitespace, punctuation,
 * street suffixes (Street → st), directionals (North → n), unit designators (Apt/Suite/# →
 * unit), and ZIP+4 → ZIP. The original address is always kept for display.
 */

/** Lowercase, strip diacritics, apostrophes, and punctuation; collapse whitespace. */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(value: string | null | undefined): string[] {
  const n = normalizeText(value);
  return n ? n.split(" ") : [];
}

/** Identifiers compare without spaces, dashes, or a leading "#". */
export function normalizeIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[\s\-_.#]/g, "");
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Digits only; a leading US country code is dropped so 1-555-… and 555-… compare equal. */
export function normalizePhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function looksLikeEmail(query: string): boolean {
  return /@/.test(query) && /^[^\s@]+@[^\s@]*$/.test(query.trim());
}

export function looksLikePhone(query: string): boolean {
  const digits = query.replace(/\D/g, "");
  return digits.length >= 7 && /^[\d\s()+.-]+$/.test(query.trim());
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const SUFFIXES: Record<string, string> = {
  street: "st",
  str: "st",
  st: "st",
  avenue: "ave",
  av: "ave",
  ave: "ave",
  road: "rd",
  rd: "rd",
  drive: "dr",
  dr: "dr",
  boulevard: "blvd",
  blvd: "blvd",
  lane: "ln",
  ln: "ln",
  court: "ct",
  ct: "ct",
  place: "pl",
  pl: "pl",
  circle: "cir",
  cir: "cir",
  terrace: "ter",
  ter: "ter",
  parkway: "pkwy",
  pkwy: "pkwy",
  highway: "hwy",
  hwy: "hwy",
  trail: "trl",
  trl: "trl",
  square: "sq",
  sq: "sq",
  way: "way",
};

const DIRECTIONALS: Record<string, string> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  n: "n",
  s: "s",
  e: "e",
  w: "w",
  ne: "ne",
  nw: "nw",
  se: "se",
  sw: "sw",
};

const UNIT_WORDS = new Set([
  "apt",
  "apartment",
  "unit",
  "suite",
  "ste",
  "no",
  "rm",
  "room",
  "bldg",
]);

const STATES: Record<string, string> = {
  california: "ca",
  nevada: "nv",
  arizona: "az",
  oregon: "or",
  washington: "wa",
  texas: "tx",
};

/** Canonical form of one address word (used for matching and highlighting). */
export function canonicalAddressWord(word: string): string {
  const w = word.toLowerCase().replace(/\.$/, "");
  return SUFFIXES[w] ?? DIRECTIONALS[w] ?? STATES[w] ?? w;
}

/** Normalized address tokens, e.g. "123 N. Main Street, Apt #4" → ["123","n","main","st","unit","4"]. */
export function normalizeAddressTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  const raw = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/#\s*/g, " unit ")
    .replace(/[,;]/g, " ")
    .replace(/\b(\d{5})-\d{4}\b/g, "$1")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of raw) {
    if (UNIT_WORDS.has(w)) {
      if (out[out.length - 1] !== "unit") out.push("unit");
      continue;
    }
    out.push(canonicalAddressWord(w));
  }
  return out;
}

export function normalizeAddress(value: string | null | undefined): string {
  return normalizeAddressTokens(value).join(" ");
}

export type AddressParts = {
  line1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
};

export function formatAddress(parts: AddressParts): string | null {
  const line = [parts.line1, parts.city, [parts.state, parts.postalCode].filter(Boolean).join(" ")]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
  return line || null;
}

/** Does the query look like a street address (number + a word)? */
export function looksLikeAddress(query: string): boolean {
  const tokens = normalizeAddressTokens(query);
  return tokens.length >= 2 && /^\d+[a-z]?$/.test(tokens[0]!) && /[a-z]/.test(tokens[1] ?? "");
}

/**
 * Grouping key for an address: street number + street words (+ unit). City and ZIP are kept
 * separately so two "123 Main St" in different cities never group (see groupAddresses).
 */
export function addressKey(parts: AddressParts): {
  key: string;
  zip: string | null;
  city: string | null;
} | null {
  const tokens = normalizeAddressTokens(parts.line1 ?? "");
  if (tokens.length < 2 || !/^\d/.test(tokens[0]!)) return null;
  const zip = (parts.postalCode ?? "").match(/\d{5}/)?.[0] ?? null;
  const city = normalizeText(parts.city) || null;
  return { key: tokens.join(" "), zip, city };
}

/** Every query address token must prefix-match some address token (order-insensitive). */
export function addressMatches(query: string, address: string | null | undefined): boolean {
  if (!address) return false;
  const q = normalizeAddressTokens(query);
  if (q.length === 0) return false;
  const doc = normalizeAddressTokens(address);
  return q.every((t) => doc.some((d) => d === t || (t.length >= 2 && d.startsWith(t))));
}
