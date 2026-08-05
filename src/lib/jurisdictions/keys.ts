import { selectJurisdictionConnector } from "@/lib/connectors/california/registry";
import { SAN_JOSE_CONFIG } from "@/lib/connectors/california/san-jose/config";
import { SANTA_CLARA_COUNTY_CONFIG } from "@/lib/connectors/california/santa-clara-county/config";
import type { JurisdictionLookupInput } from "@/lib/research/types";

/**
 * Connector-aligned jurisdiction keys used across research, knowledge tagging,
 * structured rules, and the admin jurisdictions surface.
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

/**
 * Resolve connector-aligned jurisdiction_key using the same city→connector
 * preference as live property research (`selectJurisdictionConnector`).
 * Returns null for the California fallback connector (unsupported automation).
 */
export function resolveJurisdictionKey(
  input: JurisdictionLookupInput & {
    jurisdictionName?: string | null;
  },
): SupportedJurisdictionKey | null {
  const city = input.city?.trim() || input.jurisdictionName?.trim() || undefined;
  const county = input.county?.trim() || undefined;
  const connector = selectJurisdictionConnector({
    city,
    county,
    state: input.state ?? "CA",
  });
  if (!isSupportedJurisdictionKey(connector.key)) return null;
  return connector.key;
}

/**
 * Map a completed report’s stored identity fields back to a connector key.
 * Prefer human jurisdiction_name (as live research stores it), then city-ish
 * mailing locality, with county as the San Jose vs unincorporated discriminator.
 */
export function resolveJurisdictionKeyFromReport(report: {
  jurisdiction_name?: string | null;
  county?: string | null;
  state?: string | null;
  mailing_locality?: string | null;
}): SupportedJurisdictionKey | null {
  return resolveJurisdictionKey({
    city: report.jurisdiction_name ?? report.mailing_locality ?? undefined,
    county: report.county ?? undefined,
    state: report.state ?? "CA",
    jurisdictionName: report.jurisdiction_name,
  });
}

/** Best-effort detection from free text (chat / admin search). */
export function detectJurisdictionKeyFromText(text: string): SupportedJurisdictionKey | null {
  const normalized = text.toLowerCase();
  if (/san\s*jos[eé]/.test(normalized)) return "ca-san-jose";
  if (/santa\s*clara|unincorporated/.test(normalized)) return "ca-santa-clara-county";
  return null;
}
