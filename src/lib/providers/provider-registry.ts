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
import { CALFIRE_FHSZ_VIEWER_URL, CALFIRE_WUI_VIEWER_URL, FEMA_VIEWER_URL } from "./hazards/config";
import { lookupCalfireFhsz } from "./hazards/calfire-fhsz";
import { lookupCalfireWui } from "./hazards/calfire-wui";
import { lookupFemaFloodZone } from "./hazards/fema";

class FemaProvider implements HazardProvider {
  readonly key = "fema";
  readonly name = "FEMA";
  async getHazards(input: PropertyLookupInput): Promise<HazardLookupResult | null> {
    if (input.latitude == null || input.longitude == null) {
      return {
        floodZone: null,
        fireZone: null,
        wuiClassification: null,
        sourceName: this.name,
        sourceUrl: FEMA_VIEWER_URL,
        viewerUrl: FEMA_VIEWER_URL,
        status: "manual_review",
        statusMessage: "Coordinates required for FEMA flood-zone lookup.",
      };
    }
    const result = await lookupFemaFloodZone(input.longitude, input.latitude);
    return {
      floodZone: result.displayText,
      fireZone: null,
      wuiClassification: null,
      sourceName: result.sourceName,
      sourceUrl: result.sourceUrl,
      viewerUrl: result.viewerUrl,
      status: result.status,
      statusMessage: result.statusMessage,
      responseTimeMs: result.responseTimeMs,
    };
  }
}

class CaliforniaFireProvider implements HazardProvider {
  readonly key = "ca-fire";
  readonly name = "California Fire Hazards";
  async getHazards(input: PropertyLookupInput): Promise<HazardLookupResult | null> {
    if (input.latitude == null || input.longitude == null) {
      return {
        floodZone: null,
        fireZone: null,
        wuiClassification: null,
        sourceName: this.name,
        sourceUrl: CALFIRE_FHSZ_VIEWER_URL,
        viewerUrl: CALFIRE_FHSZ_VIEWER_URL,
        status: "manual_review",
        statusMessage: "Coordinates required for CAL FIRE hazard lookups.",
      };
    }
    const [fhsz, wui] = await Promise.all([
      lookupCalfireFhsz(input.longitude, input.latitude),
      lookupCalfireWui(input.longitude, input.latitude),
    ]);
    return {
      floodZone: null,
      fireZone: fhsz.displayText,
      wuiClassification: wui.displayText,
      sourceName: this.name,
      sourceUrl: fhsz.sourceUrl ?? CALFIRE_WUI_VIEWER_URL,
      viewerUrl: fhsz.viewerUrl,
      status: fhsz.status === "error" && wui.status === "error" ? "error" : "ok",
      statusMessage: fhsz.statusMessage ?? wui.statusMessage,
      responseTimeMs: Math.max(fhsz.responseTimeMs ?? 0, wui.responseTimeMs ?? 0),
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
