import type { AiReportContent } from "./schemas";

export const AI_PROMPT_VERSION = "pem-v1" as const;

export type AiProviderName = "openai" | "anthropic" | "deterministic";

export type AiGenerationStatus = "success" | "fallback" | "skipped" | "error";

export type SanitizedAiConflict = {
  fieldKey: string;
  fieldLabel: string;
  severity: string;
  description: string;
};

export type SanitizedAiPermit = {
  permitNumber: string;
  description: string;
  status: string;
};

export type SanitizedAiObservation = {
  title: string;
  description: string;
  confidence: string;
};

export type SanitizedAiSourceLink = {
  label: string;
  url: string;
  sourceName: string;
};

export type SanitizedAiInput = {
  standardizedAddress: string;
  apn: string | null;
  governingJurisdiction: string | null;
  county: string | null;
  lotSquareFootage: number | null;
  livingAreaSquareFootage: number | null;
  yearBuilt: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  stories: number | null;
  propertyType: string | null;
  buildingCount: number | null;
  poolIndicator: boolean | null;
  zoning: string | null;
  generalPlanDesignation: string | null;
  historicDesignation: string | null;
  floodZone: string | null;
  fireZone: string | null;
  wuiClassification: string | null;
  relevantOverlays: string[];
  permits: SanitizedAiPermit[];
  conflicts: SanitizedAiConflict[];
  missingCriticalFields: string[];
  officialSourceLinks: SanitizedAiSourceLink[];
  siteObservations: SanitizedAiObservation[];
  availableFieldKeys: string[];
};

export type AiReportGenerationResult = {
  provider: AiProviderName;
  model: string;
  status: AiGenerationStatus;
  promptVersion: typeof AI_PROMPT_VERSION;
  generatedAt: string;
  inputHash: string;
  content: AiReportContent;
  errorMessage?: string | null;
};

export interface AiReportGenerator {
  readonly key: AiProviderName;
  readonly name: string;
  readonly model: string;
  generate(input: SanitizedAiInput): Promise<AiReportContent>;
}
