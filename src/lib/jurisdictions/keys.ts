import { selectJurisdictionConnector } from "@/lib/connectors/california/registry";
import type { JurisdictionLookupInput } from "@/lib/research/types";
import {
  isSupportedJurisdictionKey,
  type SupportedJurisdictionKey,
} from "./supported";

export {
  SUPPORTED_JURISDICTION_KEYS,
  SUPPORTED_JURISDICTIONS,
  detectJurisdictionKeyFromText,
  getJurisdictionDisplayName,
  isSupportedJurisdictionKey,
  type SupportedJurisdiction,
  type SupportedJurisdictionKey,
} from "./supported";

/**
 * Resolve connector-aligned jurisdiction_key using the same city→connector
 * preference as live property research (`selectJurisdictionConnector`).
 * Returns null for the California fallback connector (unsupported automation).
 *
 * Server-oriented: pulls the connector registry. Client UI should use
 * `./supported` instead of this module.
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
