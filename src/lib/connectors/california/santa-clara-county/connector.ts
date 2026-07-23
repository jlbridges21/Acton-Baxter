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
import { SANTA_CLARA_COUNTY_CONFIG } from "./config";
import { fetchSantaClaraCountyParcel } from "./normalizers";
import { buildAssessorSearchUrl, resolvePropertyProfileAccess } from "./property-profile";

export const santaClaraCountyConnector: JurisdictionConnector = {
  key: SANTA_CLARA_COUNTY_CONFIG.key,
  name: SANTA_CLARA_COUNTY_CONFIG.name,

  supports(input: JurisdictionLookupInput): boolean {
    const county = input.county?.toLowerCase() ?? "";
    return county.includes("santa clara");
  },

  async getParcel(input: PropertyLookupInput): Promise<NormalizedParcelResult | null> {
    const parcel = await fetchSantaClaraCountyParcel(input);
    if (!parcel || parcel.statusMessage) {
      return parcel
        ? {
            apn: parcel.apn,
            lotSquareFootage: parcel.lotSquareFootage,
            geometryGeojson: parcel.geometryGeojson,
            centroidLatitude: parcel.centroidLatitude,
            centroidLongitude: parcel.centroidLongitude,
            sourceName: parcel.sourceName,
            sourceUrl: parcel.sourceUrl,
          }
        : null;
    }
    return {
      apn: parcel.apn,
      lotSquareFootage: parcel.lotSquareFootage,
      geometryGeojson: parcel.geometryGeojson,
      centroidLatitude: parcel.centroidLatitude,
      centroidLongitude: parcel.centroidLongitude,
      sourceName: parcel.sourceName,
      sourceUrl: parcel.sourceUrl,
    };
  },

  async getZoning(_input: PropertyLookupInput): Promise<NormalizedZoningResult | null> {
    // Incorporated San Jose zoning is owned by the city connector.
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

  async getPropertyProfileLink(input: PropertyLookupInput): Promise<string | null> {
    return resolvePropertyProfileAccess(input).url;
  },

  async getTractMapLink(input: PropertyLookupInput): Promise<string | null> {
    return buildAssessorSearchUrl(input.apn);
  },

  getPermitSearchLink(_input: PropertyLookupInput): string | null {
    return null;
  },

  getPublicSourceLinks(input: PropertyLookupInput): SourceLink[] {
    const profile = resolvePropertyProfileAccess(input);
    const links: SourceLink[] = [
      {
        label: "Santa Clara County Property Explorer",
        url: SANTA_CLARA_COUNTY_CONFIG.propertyProfile.experienceUrl,
        sourceName: SANTA_CLARA_COUNTY_CONFIG.name,
        notes: profile.statusMessage,
      },
      {
        label: "Santa Clara County parcel layer",
        url: SANTA_CLARA_COUNTY_CONFIG.parcels.url,
        sourceName: SANTA_CLARA_COUNTY_CONFIG.name,
      },
    ];
    const assessor = buildAssessorSearchUrl(input.apn);
    if (assessor) {
      links.push({
        label: "County assessor search",
        url: assessor,
        sourceName: "Santa Clara County Assessor",
      });
    }
    return links;
  },
};
