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

export interface JurisdictionConnector {
  key: string;
  name: string;
  supports(input: JurisdictionLookupInput): boolean;

  getParcel(input: PropertyLookupInput): Promise<NormalizedParcelResult | null>;

  getZoning(input: PropertyLookupInput): Promise<NormalizedZoningResult | null>;

  getGeneralPlan(input: PropertyLookupInput): Promise<NormalizedGeneralPlanResult | null>;

  getOverlays(input: PropertyLookupInput): Promise<NormalizedOverlayResult[]>;

  getHistoricStatus(input: PropertyLookupInput): Promise<NormalizedHistoricResult | null>;

  getPropertyProfileLink(input: PropertyLookupInput): Promise<string | null>;

  getTractMapLink(input: PropertyLookupInput): Promise<string | null>;

  getPermitSearchLink(input: PropertyLookupInput): string | null;

  getPublicSourceLinks(input: PropertyLookupInput): SourceLink[];
}
