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
import { SAN_JOSE_CONFIG } from "./config";
import {
  fetchSanJoseGeneralPlan,
  fetchSanJoseHistoric,
  fetchSanJoseOverlays,
  fetchSanJoseParcel,
  fetchSanJoseZoning,
} from "./normalizers";

export const sanJoseConnector: JurisdictionConnector = {
  key: SAN_JOSE_CONFIG.key,
  name: SAN_JOSE_CONFIG.name,

  supports(input: JurisdictionLookupInput): boolean {
    const city = input.city?.toLowerCase() ?? "";
    return city.includes("san jose") || city.includes("san josé");
  },

  async getParcel(input: PropertyLookupInput): Promise<NormalizedParcelResult | null> {
    const result = await fetchSanJoseParcel(input);
    return result.parcel;
  },

  async getZoning(input: PropertyLookupInput): Promise<NormalizedZoningResult | null> {
    const result = await fetchSanJoseZoning(input);
    return result.zoning;
  },

  async getGeneralPlan(input: PropertyLookupInput): Promise<NormalizedGeneralPlanResult | null> {
    const result = await fetchSanJoseGeneralPlan(input);
    return result.generalPlan;
  },

  async getOverlays(input: PropertyLookupInput): Promise<NormalizedOverlayResult[]> {
    const result = await fetchSanJoseOverlays(input);
    return result.overlays;
  },

  async getHistoricStatus(input: PropertyLookupInput): Promise<NormalizedHistoricResult | null> {
    const result = await fetchSanJoseHistoric(input);
    return result.historic;
  },

  async getPropertyProfileLink(_input: PropertyLookupInput): Promise<string | null> {
    return null;
  },

  async getTractMapLink(_input: PropertyLookupInput): Promise<string | null> {
    return null;
  },

  getPermitSearchLink(_input: PropertyLookupInput): string | null {
    return SAN_JOSE_CONFIG.links.permitSearch;
  },

  getPublicSourceLinks(input: PropertyLookupInput): SourceLink[] {
    return [
      {
        label: "San Jose parcels open data",
        url: SAN_JOSE_CONFIG.links.parcelsOpenData,
        sourceName: SAN_JOSE_CONFIG.name,
      },
      {
        label: "San Jose zoning map data",
        url: SAN_JOSE_CONFIG.links.zoningMap,
        sourceName: SAN_JOSE_CONFIG.name,
      },
      {
        label: "San Jose building permits",
        url: this.getPermitSearchLink(input) ?? SAN_JOSE_CONFIG.links.permitSearch,
        sourceName: SAN_JOSE_CONFIG.name,
      },
    ];
  },
};
