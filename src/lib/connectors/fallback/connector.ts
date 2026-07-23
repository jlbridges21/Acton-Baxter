import type { JurisdictionConnector } from "@/lib/providers/jurisdiction-connector.interface";
import type {
  JurisdictionLookupInput,
  NormalizedGeneralPlanResult,
  NormalizedHistoricResult,
  NormalizedOverlayResult,
  NormalizedParcelResult,
  NormalizedZoningResult,
  PropertyLookupInput,
  SourceLink,
} from "@/lib/research/types";

/**
 * Fallback connector returns official search links when automated data is unavailable.
 */
export const fallbackConnector: JurisdictionConnector = {
  key: "fallback",
  name: "California Fallback Links",

  supports(_input: JurisdictionLookupInput): boolean {
    return true;
  },

  async getParcel(_input: PropertyLookupInput): Promise<NormalizedParcelResult | null> {
    return null;
  },

  async getZoning(_input: PropertyLookupInput): Promise<NormalizedZoningResult | null> {
    return null;
  },

  async getGeneralPlan(_input: PropertyLookupInput): Promise<NormalizedGeneralPlanResult | null> {
    return null;
  },

  async getOverlays(_input: PropertyLookupInput): Promise<NormalizedOverlayResult[]> {
    return [];
  },

  async getHistoricStatus(_input: PropertyLookupInput): Promise<NormalizedHistoricResult | null> {
    return null;
  },

  async getPropertyProfileLink(_input: PropertyLookupInput): Promise<string | null> {
    return null;
  },

  async getTractMapLink(_input: PropertyLookupInput): Promise<string | null> {
    return null;
  },

  getPermitSearchLink(input: PropertyLookupInput): string | null {
    const q = encodeURIComponent(input.standardizedAddress ?? input.address);
    return `https://www.google.com/search?q=${q}+building+permit`;
  },

  getPublicSourceLinks(input: PropertyLookupInput): SourceLink[] {
    const q = encodeURIComponent(input.standardizedAddress ?? input.address);
    return [
      {
        label: "Google Maps",
        url: `https://www.google.com/maps/search/?api=1&query=${q}`,
        sourceName: "Google Maps",
        notes: "Fallback map link when jurisdiction GIS is unavailable.",
      },
      {
        label: "FEMA MSC Search",
        url: "https://msc.fema.gov/portal/search",
        sourceName: "FEMA",
        notes: "Manual flood map search.",
      },
      {
        label: "CAL FIRE Hazard Severity Zones",
        url: "https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones",
        sourceName: "CAL FIRE",
        notes: "Manual fire hazard lookup.",
      },
    ];
  },
};
