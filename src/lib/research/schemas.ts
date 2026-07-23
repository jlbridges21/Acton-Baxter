import { z } from "zod";
import {
  CONFIDENCE_LEVELS,
  CONFLICT_SEVERITIES,
  MATCH_METHODS,
  REPORT_STATUSES,
  SOURCE_STATUSES,
  SOURCE_TYPES,
  USER_ROLES,
} from "./constants";

export const addressRequestSchema = z.object({
  address: z
    .string()
    .trim()
    .min(5, "Enter a full California property address")
    .max(300, "Address is too long")
    .refine((value) => /[a-zA-Z]/.test(value), {
      message: "Address must include a street name",
    })
    .refine((value) => /\d/.test(value), {
      message: "Address must include a street number",
    }),
});

export type AddressRequest = z.infer<typeof addressRequestSchema>;

export const reportStatusSchema = z.enum(REPORT_STATUSES);
export const userRoleSchema = z.enum(USER_ROLES);
export const confidenceSchema = z.enum(CONFIDENCE_LEVELS);
export const conflictSeveritySchema = z.enum(CONFLICT_SEVERITIES);
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export const matchMethodSchema = z.enum(MATCH_METHODS);
export const sourceStatusSchema = z.enum(SOURCE_STATUSES);

export const sourceClaimSchema = z.object({
  fieldKey: z.string(),
  sourceName: z.string(),
  sourceType: sourceTypeSchema,
  sourceUrl: z.string().url().nullable().optional(),
  sourceRecordId: z.string().nullable().optional(),
  rawValue: z.string().nullable(),
  normalizedValue: z.string().nullable(),
  matchMethod: matchMethodSchema,
  confidence: confidenceSchema,
  retrievedAt: z.string(),
  sourceUpdatedAt: z.string().nullable().optional(),
  rawResponseJson: z.unknown().optional(),
  matchScore: z.number().nullable().optional(),
  isPreferred: z.boolean().optional(),
});

export const propertyFactSchema = z.object({
  category: z.string(),
  fieldKey: z.string(),
  fieldLabel: z.string(),
  normalizedValueText: z.string().nullable(),
  normalizedValueNumber: z.number().nullable(),
  normalizedValueBoolean: z.boolean().nullable(),
  unit: z.string().nullable().optional(),
  preferredSourceName: z.string().nullable().optional(),
  preferredSourceUrl: z.string().nullable().optional(),
  confidence: confidenceSchema,
});

export const conflictSchema = z.object({
  fieldKey: z.string(),
  fieldLabel: z.string(),
  severity: conflictSeveritySchema,
  description: z.string(),
  values: z.array(
    z.object({
      sourceName: z.string(),
      value: z.string(),
      sourceUrl: z.string().nullable().optional(),
    }),
  ),
  recommendedResolution: z.string(),
});

export const reportSourceSchema = z.object({
  sourceName: z.string(),
  sourceType: sourceTypeSchema,
  sourceUrl: z.string().nullable().optional(),
  status: sourceStatusSchema,
  retrievedAt: z.string().nullable().optional(),
  sourceUpdatedAt: z.string().nullable().optional(),
  responseTimeMs: z.number().nullable().optional(),
  statusMessage: z.string().nullable().optional(),
  endpointName: z.string().nullable().optional(),
  httpStatus: z.number().nullable().optional(),
});

export const siteObservationSchema = z.object({
  observationType: z.string(),
  title: z.string(),
  description: z.string(),
  confidence: confidenceSchema,
  sourceName: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
});

export const pemPreparationSchema = z.object({
  overview: z.string(),
  propertyFindings: z.array(z.string()).min(1).max(5),
  propertyQuestions: z.array(z.string()).min(1).max(5),
  verifyDuringPem: z.array(z.string()),
  verifyDuringFeasibility: z.array(z.string()),
  verifyThroughTitleOrSurvey: z.array(z.string()),
  verifyWithPlanning: z.array(z.string()),
});

export const parcelGeometrySchema = z.object({
  geometryGeojson: z.record(z.string(), z.unknown()),
  centroidLatitude: z.number().nullable(),
  centroidLongitude: z.number().nullable(),
  calculatedAreaSqFt: z.number().nullable(),
  sourceName: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
});

export const permitRecordSchema = z.object({
  permitNumber: z.string(),
  description: z.string(),
  status: z.string(),
  appliedDate: z.string().nullable().optional(),
  issuedDate: z.string().nullable().optional(),
  finalDate: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
});

export const sourceLinkSchema = z.object({
  label: z.string(),
  url: z.string().url(),
  sourceName: z.string(),
  notes: z.string().optional(),
});

export const normalizedPropertyIdentitySchema = z.object({
  inputAddress: z.string(),
  standardizedAddress: z.string(),
  apn: z.string().nullable(),
  attomId: z.string().nullable().optional(),
  rentcastId: z.string().nullable().optional(),
  fips: z.string().nullable().optional(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  jurisdiction: z.string().nullable(),
  jurisdictionType: z.string().nullable().optional(),
  mailingLocality: z.string().nullable().optional(),
  county: z.string().nullable(),
  state: z.string().nullable(),
  zipCode: z.string().nullable().optional(),
});

export const normalizedPropertyCharacteristicsSchema = z.object({
  propertyType: z.string().nullable().optional(),
  lotSquareFootage: z.number().nullable().optional(),
  livingAreaSquareFootage: z.number().nullable().optional(),
  bedrooms: z.number().nullable().optional(),
  bathrooms: z.number().nullable().optional(),
  stories: z.number().nullable().optional(),
  yearBuilt: z.number().nullable().optional(),
  buildingCount: z.number().nullable().optional(),
  existingStructures: z.string().nullable().optional(),
  estimatedValue: z.number().nullable().optional(),
  assessedValue: z.number().nullable().optional(),
  lastSaleDate: z.string().nullable().optional(),
  lastSalePrice: z.number().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  ownerMailingAddress: z.string().nullable().optional(),
  subdivision: z.string().nullable().optional(),
  tractNumber: z.string().nullable().optional(),
  taxRateArea: z.string().nullable().optional(),
});

export const normalizedPlanningSchema = z.object({
  zoning: z.string().nullable().optional(),
  generalPlanDesignation: z.string().nullable().optional(),
  jurisdictionType: z.string().nullable().optional(),
  relevantOverlays: z.array(z.string()).default([]),
  historicDesignation: z.string().nullable().optional(),
  floodZone: z.string().nullable().optional(),
  fireZone: z.string().nullable().optional(),
});

export const normalizedMapsSchema = z.object({
  parcelMapUrl: z.string().nullable().optional(),
  countyPropertyProfileReportUrl: z.string().nullable().optional(),
  tractMapUrl: z.string().nullable().optional(),
  assessorUrl: z.string().nullable().optional(),
  zoningMapUrl: z.string().nullable().optional(),
  permitSearchUrl: z.string().nullable().optional(),
  redfinUrl: z.string().nullable().optional(),
  googleMapsUrl: z.string().nullable().optional(),
  streetViewUrl: z.string().nullable().optional(),
  satelliteImageAvailable: z.boolean().optional(),
  streetViewImageAvailable: z.boolean().optional(),
  femaUrl: z.string().nullable().optional(),
  fireZoneUrl: z.string().nullable().optional(),
});

export type NormalizedMaps = z.infer<typeof normalizedMapsSchema>;

export const propertyProfileAccessSchema = z.object({
  available: z.boolean(),
  url: z.string().nullable(),
  accessType: z.enum([
    "direct_report",
    "deep_link",
    "generic_search",
    "recreated_from_layers",
    "unavailable",
  ]),
  statusMessage: z.string(),
  openLabel: z.string(),
});

export const researchDiagnosticsSchema = z
  .object({
    attomId: z.string().nullable().optional(),
    rentcastId: z.string().nullable().optional(),
    connectorKeys: z.array(z.string()).optional(),
    providerStatuses: z
      .array(
        z.object({
          provider: z.string(),
          status: z.string(),
          responseTimeMs: z.number().nullable().optional(),
          message: z.string().nullable().optional(),
        }),
      )
      .optional(),
    selectedSources: z.record(z.string(), z.string()).optional(),
    mockFallback: z.boolean().optional(),
    aiProvider: z.string().optional(),
    aiStatus: z.string().optional(),
  })
  .optional();

export const normalizedResearchResultSchema = z.object({
  identity: normalizedPropertyIdentitySchema,
  characteristics: normalizedPropertyCharacteristicsSchema,
  planning: normalizedPlanningSchema,
  maps: normalizedMapsSchema,
  permits: z.array(permitRecordSchema).default([]),
  facts: z.array(propertyFactSchema),
  claims: z.array(sourceClaimSchema),
  conflicts: z.array(conflictSchema),
  sources: z.array(reportSourceSchema),
  parcelGeometry: parcelGeometrySchema.nullable(),
  siteObservations: z.array(siteObservationSchema),
  pemPreparation: pemPreparationSchema,
  summary: z.string(),
  propertyProfile: propertyProfileAccessSchema.optional(),
  diagnostics: researchDiagnosticsSchema,
  aiGeneration: z
    .object({
      provider: z.string(),
      model: z.string(),
      status: z.enum(["success", "fallback", "skipped", "error"]),
      promptVersion: z.string(),
      generatedAt: z.string(),
      inputHash: z.string(),
    })
    .optional(),
});

export type NormalizedResearchResult = z.infer<typeof normalizedResearchResultSchema>;
export type SourceClaim = z.infer<typeof sourceClaimSchema>;
export type PropertyFact = z.infer<typeof propertyFactSchema>;
export type ReportConflict = z.infer<typeof conflictSchema>;
export type ReportSource = z.infer<typeof reportSourceSchema>;
export type SiteObservation = z.infer<typeof siteObservationSchema>;
export type PemPreparation = z.infer<typeof pemPreparationSchema>;
export type SourceLink = z.infer<typeof sourceLinkSchema>;
