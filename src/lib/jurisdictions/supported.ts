import { SAN_JOSE_CONFIG } from "@/lib/connectors/california/san-jose/config";
import { SANTA_CLARA_COUNTY_CONFIG } from "@/lib/connectors/california/santa-clara-county/config";

/**
 * Client-safe jurisdiction catalog.
 *
 * Keep this free of connector/registry/ArcGIS imports so admin UI and other
 * Client Components can read the list without pulling `server-only` modules.
 * Connector-aware resolution lives in `./keys`.
 */
export const SUPPORTED_JURISDICTION_KEYS = [
  SAN_JOSE_CONFIG.key,
  SANTA_CLARA_COUNTY_CONFIG.key,
] as const;

export type SupportedJurisdictionKey = (typeof SUPPORTED_JURISDICTION_KEYS)[number];

export type SupportedJurisdiction = {
  key: SupportedJurisdictionKey;
  name: string;
  state: "CA";
  county: string;
  /** Cities / labels that typically map to this key during research. */
  matchHints: string[];
};

export const SUPPORTED_JURISDICTIONS: SupportedJurisdiction[] = [
  {
    key: SAN_JOSE_CONFIG.key as SupportedJurisdictionKey,
    name: SAN_JOSE_CONFIG.name,
    state: "CA",
    county: "Santa Clara",
    matchHints: ["san jose", "san josé"],
  },
  {
    key: SANTA_CLARA_COUNTY_CONFIG.key as SupportedJurisdictionKey,
    name: SANTA_CLARA_COUNTY_CONFIG.name,
    state: "CA",
    county: "Santa Clara",
    matchHints: ["santa clara", "unincorporated"],
  },
];

export function isSupportedJurisdictionKey(
  value: string | null | undefined,
): value is SupportedJurisdictionKey {
  return Boolean(value && (SUPPORTED_JURISDICTION_KEYS as readonly string[]).includes(value));
}

export function getJurisdictionDisplayName(key: string | null | undefined): string {
  if (!key) return "Unknown jurisdiction";
  const match = SUPPORTED_JURISDICTIONS.find((item) => item.key === key);
  return match?.name ?? key;
}

/** Best-effort detection from free text (chat / admin search). */
export function detectJurisdictionKeyFromText(text: string): SupportedJurisdictionKey | null {
  const normalized = text.toLowerCase();
  if (/san\s*jos[eé]/.test(normalized)) return "ca-san-jose";
  if (/santa\s*clara|unincorporated/.test(normalized)) return "ca-santa-clara-county";
  return null;
}
