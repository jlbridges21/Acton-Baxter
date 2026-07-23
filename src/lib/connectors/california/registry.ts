import type { JurisdictionConnector } from "@/lib/providers/jurisdiction-connector.interface";
import type { JurisdictionLookupInput } from "@/lib/research/types";
import { sanJoseConnector } from "./san-jose/connector";
import { santaClaraCountyConnector } from "./santa-clara-county/connector";
import { fallbackConnector } from "../fallback/connector";

const californiaConnectors: JurisdictionConnector[] = [sanJoseConnector, santaClaraCountyConnector];

export function listJurisdictionConnectors(): JurisdictionConnector[] {
  return [...californiaConnectors, fallbackConnector];
}

/**
 * Prefer a city connector when the city matches, otherwise a county connector,
 * otherwise the California fallback link connector.
 */
export function selectJurisdictionConnector(input: JurisdictionLookupInput): JurisdictionConnector {
  const cityMatch = californiaConnectors.find(
    (connector) => connector.key.includes("san-jose") && connector.supports(input),
  );
  if (cityMatch) return cityMatch;

  const countyMatch = californiaConnectors.find(
    (connector) => connector.key.includes("county") && connector.supports(input),
  );
  if (countyMatch) return countyMatch;

  const anyMatch = californiaConnectors.find((connector) => connector.supports(input));
  return anyMatch ?? fallbackConnector;
}
