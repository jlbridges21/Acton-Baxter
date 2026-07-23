import type {
  CONFIDENCE_LEVELS,
  CONFLICT_SEVERITIES,
  MATCH_METHODS,
  REPORT_STATUSES,
  SOURCE_STATUSES,
  SOURCE_TYPES,
  USER_ROLES,
} from "./constants";

export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type ConflictSeverity = (typeof CONFLICT_SEVERITIES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];
export type MatchMethod = (typeof MATCH_METHODS)[number];
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export type PropertyLookupInput = {
  address: string;
  standardizedAddress?: string;
  apn?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  zipCode?: string | null;
};

export type JurisdictionLookupInput = {
  city?: string | null;
  county?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type NormalizedParcelResult = {
  apn: string | null;
  lotSquareFootage: number | null;
  geometryGeojson: Record<string, unknown> | null;
  centroidLatitude: number | null;
  centroidLongitude: number | null;
  sourceName: string;
  sourceUrl: string | null;
};

export type NormalizedZoningResult = {
  zoning: string | null;
  sourceName: string;
  sourceUrl: string | null;
};

export type NormalizedGeneralPlanResult = {
  designation: string | null;
  sourceName: string;
  sourceUrl: string | null;
};

export type NormalizedOverlayResult = {
  name: string;
  code: string | null;
  description: string | null;
  sourceName: string;
  sourceUrl: string | null;
};

export type NormalizedHistoricResult = {
  status: string | null;
  designation: string | null;
  sourceName: string;
  sourceUrl: string | null;
};

export type SourceLink = {
  label: string;
  url: string;
  sourceName: string;
  notes?: string;
};

export type ClaimInput = {
  fieldKey: string;
  fieldLabel: string;
  sourceName: string;
  sourceType: SourceType;
  sourceUrl?: string | null;
  rawValue: string | null;
  normalizedValue: string | null;
  numericValue?: number | null;
  matchMethod: MatchMethod;
  confidence: Confidence;
  sourceUpdatedAt?: string | null;
};
