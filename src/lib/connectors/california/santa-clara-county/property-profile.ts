import type { PropertyLookupInput } from "@/lib/research/types";
import { SANTA_CLARA_COUNTY_CONFIG, type PropertyProfileAccessType } from "./config";

export type PropertyProfileAccess = {
  available: boolean;
  url: string | null;
  accessType: PropertyProfileAccessType;
  statusMessage: string;
  openLabel: string;
};

/**
 * Santa Clara County's Property Explorer Experience does not expose a documented,
 * stable direct printable-report URL that can be generated from APN alone.
 * We therefore provide a generic public Experience search link plus APN guidance,
 * and recreate selected parcel attributes from public FeatureServer layers.
 */
export function resolvePropertyProfileAccess(input: PropertyLookupInput): PropertyProfileAccess {
  if (!input.apn) {
    return {
      available: true,
      url: SANTA_CLARA_COUNTY_CONFIG.propertyProfile.experienceUrl,
      accessType: "generic_search",
      statusMessage:
        "Official printable Property Profile URL is not stably addressable. Open Property Explorer and search by address or APN.",
      openLabel: "Search County Property Profile",
    };
  }

  const experienceUrl = SANTA_CLARA_COUNTY_CONFIG.propertyProfile.experienceUrl;
  return {
    available: true,
    url: experienceUrl,
    accessType: "generic_search",
    statusMessage: `Search using APN ${input.apn}. A stable direct printable report URL was not found from public Experience metadata.`,
    openLabel: "Search County Property Profile",
  };
}

export function buildAssessorSearchUrl(apn: string | null | undefined): string | null {
  // County search no longer accepts a reliable APN deep-link; salespeople copy APN in the UI.
  void apn;
  return SANTA_CLARA_COUNTY_CONFIG.propertyProfile.assessorSearchUrl;
}
