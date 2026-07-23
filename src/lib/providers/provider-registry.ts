import type { PropertyLookupInput } from "@/lib/research/types";
import type { PropertyProvider, PropertyProviderResult } from "./property-provider.interface";
import type { HazardProvider, HazardLookupResult } from "./hazard-provider.interface";
import type { PermitProvider, PermitRecord } from "./permit-provider.interface";
import type { ImageryProvider, ImageryResult } from "./imagery-provider.interface";
import type { AiReportProvider } from "./ai-report-provider.interface";
import type { NormalizedResearchResult, PemPreparation } from "@/lib/research/schemas";
import { NotImplementedError } from "@/lib/errors";
import { AttomProvider } from "./attom/provider";
import { RentCastProvider } from "./rentcast/provider";
import { selectJurisdictionConnector } from "@/lib/connectors/california/registry";

class FemaProvider implements HazardProvider {
  readonly key = "fema";
  readonly name = "FEMA";
  async getHazards(_input: PropertyLookupInput): Promise<HazardLookupResult | null> {
    // Prompt 2 keeps flood as official link / manual review.
    return {
      floodZone: null,
      fireZone: null,
      sourceName: this.name,
      sourceUrl: "https://msc.fema.gov/portal/search",
    };
  }
}

class CaliforniaFireProvider implements HazardProvider {
  readonly key = "ca-fire";
  readonly name = "California Fire Hazards";
  async getHazards(_input: PropertyLookupInput): Promise<HazardLookupResult | null> {
    return {
      floodZone: null,
      fireZone: null,
      sourceName: this.name,
      sourceUrl:
        "https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones",
    };
  }
}

class PlaceholderPermitProvider implements PermitProvider {
  readonly key = "permits-placeholder";
  readonly name = "Permit Search Placeholder";
  async searchPermits(_input: PropertyLookupInput): Promise<PermitRecord[]> {
    return [];
  }
  getPermitSearchLink(input: PropertyLookupInput): string | null {
    const q = encodeURIComponent(input.standardizedAddress ?? input.address);
    return `https://www.sanjoseca.gov/your-government/departments-offices/planning-building-code-enforcement/building-permits?q=${q}`;
  }
}

class PlaceholderImageryProvider implements ImageryProvider {
  readonly key = "imagery-placeholder";
  readonly name = "Imagery Placeholder";
  async getImagery(_input: PropertyLookupInput): Promise<ImageryResult | null> {
    throw new NotImplementedError("Imagery provider");
  }
}

class PlaceholderAiReportProvider implements AiReportProvider {
  readonly key = "ai-report";
  readonly name = "AI Report Generation";
  async generateSummary(_input: NormalizedResearchResult): Promise<string> {
    throw new NotImplementedError("AI report provider");
  }
  async generatePemPreparation(_input: NormalizedResearchResult): Promise<PemPreparation> {
    throw new NotImplementedError("AI report provider");
  }
}

export type ProviderRegistry = {
  property: PropertyProvider[];
  hazards: HazardProvider[];
  permits: PermitProvider;
  imagery: ImageryProvider;
  aiReport: AiReportProvider;
};

export function getProviderRegistry(): ProviderRegistry {
  return {
    property: [new AttomProvider(), new RentCastProvider()],
    hazards: [new FemaProvider(), new CaliforniaFireProvider()],
    permits: new PlaceholderPermitProvider(),
    imagery: new PlaceholderImageryProvider(),
    aiReport: new PlaceholderAiReportProvider(),
  };
}

export function selectPropertyProvider(key: string): PropertyProvider | null {
  return getProviderRegistry().property.find((provider) => provider.key === key) ?? null;
}

export type { PropertyProviderResult };
export { selectJurisdictionConnector };
