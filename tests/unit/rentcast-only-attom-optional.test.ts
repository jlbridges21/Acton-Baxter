import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  ATTOM_ONLY_CLAIMED_FIELD_KEYS,
  buildProviderFieldComparison,
  SHARED_LICENSED_FIELD_KEYS,
} from "@/lib/research/provider-comparison";
import { FIELD_KEYS } from "@/lib/research/constants";
import { buildPreferredFacts } from "@/lib/research/select-preferred-fact";
import { buildSiteInspectionItems } from "@/lib/research/site-inspection";
import { detectConflicts } from "@/lib/research/conflict-detector";
import type { PropertyFact, SourceClaim } from "@/lib/research/schemas";
import type { FullReport } from "@/lib/research/db-types";

const mockLookupAttom = vi.fn();
const mockLookupRentCast = vi.fn();
const mockSjParcel = vi.fn();
const mockCountyParcel = vi.fn();
const mockSjZoning = vi.fn();
const mockSjGp = vi.fn();
const mockSjHistoric = vi.fn();
const mockSjOverlays = vi.fn();

vi.mock("@/lib/providers/attom/provider", () => ({
  lookupAttomProperty: (...args: unknown[]) => mockLookupAttom(...args),
}));

vi.mock("@/lib/providers/rentcast/provider", () => ({
  lookupRentCastProperty: (...args: unknown[]) => mockLookupRentCast(...args),
}));

vi.mock("@/lib/connectors/california/san-jose/normalizers", () => ({
  fetchSanJoseParcel: (...args: unknown[]) => mockSjParcel(...args),
  fetchSanJoseZoning: (...args: unknown[]) => mockSjZoning(...args),
  fetchSanJoseGeneralPlan: (...args: unknown[]) => mockSjGp(...args),
  fetchSanJoseHistoric: (...args: unknown[]) => mockSjHistoric(...args),
  fetchSanJoseOverlays: (...args: unknown[]) => mockSjOverlays(...args),
}));

vi.mock("@/lib/connectors/california/santa-clara-county/normalizers", () => ({
  fetchSantaClaraCountyParcel: (...args: unknown[]) => mockCountyParcel(...args),
}));

const mockLookupHazards = vi.fn();
const mockLookupHydrant = vi.fn();

vi.mock("@/lib/providers/hazards/lookup", () => ({
  lookupPropertyHazards: (...args: unknown[]) => mockLookupHazards(...args),
}));

vi.mock("@/lib/providers/hydrants/lookup", () => ({
  lookupNearestHydrant: (...args: unknown[]) => mockLookupHydrant(...args),
  HYDRANT_PULL_DISTANCE_CAVEAT:
    "Actual hydrant pull distance is measured along the path of travel and will be longer — measure on site.",
  HYDRANT_MAX_SEARCH_RADIUS_FT: 2500,
}));

function setEnv(overrides: Record<string, string | undefined> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.ENABLE_MOCK_RESEARCH = "false";
  process.env.ATTOM_API_KEY = "attom-key";
  process.env.RENTCAST_API_KEY = "rentcast-key";
  process.env.ALLOW_MOCK_FALLBACK = "false";
  Object.assign(process.env, overrides);
  resetEnvCacheForTests();
}

function emptyGis() {
  mockSjParcel.mockResolvedValue({
    parcel: null,
    responseTimeMs: 10,
    statusMessage: "unavailable",
  });
  mockCountyParcel.mockResolvedValue(null);
  mockSjZoning.mockResolvedValue({
    zoning: null,
    responseTimeMs: 10,
    statusMessage: "unavailable",
  });
  mockSjGp.mockResolvedValue({
    generalPlan: null,
    responseTimeMs: 10,
    statusMessage: "unavailable",
  });
  mockSjHistoric.mockResolvedValue({
    historic: null,
    responseTimeMs: 10,
    statusMessage: "unavailable",
  });
  mockSjOverlays.mockResolvedValue({ overlays: [], responseTimeMs: 10, statusMessage: null });
  mockLookupHazards.mockResolvedValue({
    flood: {
      status: "no_coverage",
      value: null,
      displayText: null,
      sourceName: "FEMA NFHL",
      sourceUrl: "https://example.com/fema",
      viewerUrl: "https://example.com/fema-viewer",
      responseTimeMs: 1,
      statusMessage: null,
      details: {},
    },
    fire: {
      status: "no_coverage",
      value: null,
      displayText: null,
      sourceName: "CAL FIRE FHSZ",
      sourceUrl: "https://example.com/fire",
      viewerUrl: "https://example.com/fire-viewer",
      responseTimeMs: 1,
      statusMessage: null,
      details: {},
    },
    wui: {
      status: "no_coverage",
      value: null,
      displayText: null,
      sourceName: "CAL FIRE WUI",
      sourceUrl: "https://example.com/wui",
      viewerUrl: "https://example.com/wui-viewer",
      responseTimeMs: 1,
      statusMessage: null,
      details: {},
    },
  });
  mockLookupHydrant.mockResolvedValue({
    status: "no_data",
    hydrant: null,
    attemptedSources: ["scfd", "campbell", "osm"],
    statusMessage: "No mapped hydrant found within 2,500 ft of this location.",
    manualLookupUrl: "https://www.openstreetmap.org/#map=18/37.34/-121.87",
    responseTimeMs: 1,
  });
}

function rentCastProperty() {
  return {
    id: "rc-1",
    formattedAddress: "655 13th St, San Jose, CA 95112",
    city: "San Jose",
    state: "CA",
    zipCode: "95112",
    county: "Santa Clara",
    latitude: 37.34,
    longitude: -121.87,
    livingAreaSquareFootage: 1200,
    lotSquareFootage: 6000,
    bedrooms: 3,
    bathrooms: 2,
    yearBuilt: 1925,
    stories: 1,
    propertyType: "Single Family",
    assessedValue: 400000,
    lastSaleDate: "2020-01-01",
    lastSalePrice: 800000,
    ownerNames: "Owner A",
    ownerMailingAddress: "655 13th St",
    subdivision: "Hensley",
    pool: false,
    matchMethod: "address" as const,
    matchScore: 90,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  resetEnvCacheForTests();
});

describe("ATTOM-only claimed field audit", () => {
  it("lists every live-pipeline field ATTOM claims with no RentCast claim", () => {
    expect([...ATTOM_ONLY_CLAIMED_FIELD_KEYS]).toEqual([
      FIELD_KEYS.foundationType,
      FIELD_KEYS.tractNumber,
      FIELD_KEYS.buildingCount,
      FIELD_KEYS.estimatedValue,
      FIELD_KEYS.apn,
    ]);
    expect(SHARED_LICENSED_FIELD_KEYS).not.toContain(FIELD_KEYS.foundationType);
    expect(SHARED_LICENSED_FIELD_KEYS).toContain(FIELD_KEYS.lotSqFt);
  });
});

describe("RentCast-only mode (ATTOM_API_KEY unset)", () => {
  it("getEnv allows live mode without ATTOM_API_KEY", async () => {
    setEnv({ ATTOM_API_KEY: "" });
    const { getEnv } = await import("@/lib/env");
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().ATTOM_API_KEY).toBe("");
    expect(getEnv().RENTCAST_API_KEY).toBe("rentcast-key");
  });

  it("skips ATTOM lookup and completes research from RentCast alone", async () => {
    setEnv({ ATTOM_API_KEY: "" });
    emptyGis();
    mockLookupRentCast.mockResolvedValue({
      property: rentCastProperty(),
      request: { responseTimeMs: 12, httpStatus: 200, data: {}, endpoint: "properties" },
      status: "active",
      statusMessage: null,
    });

    const { runLivePropertyResearch } =
      await import("@/lib/research/live/run-live-property-research");
    const result = await runLivePropertyResearch("655 13th St, San Jose, CA 95112");

    expect(mockLookupAttom).not.toHaveBeenCalled();
    expect(result.identity.rentcastId).toBe("rc-1");
    expect(result.identity.attomId).toBeNull();
    expect(result.diagnostics?.attomConfigured).toBe(false);
    expect(
      result.diagnostics?.providerStatuses?.some(
        (p) => p.provider === "ATTOM" && p.status === "skipped",
      ),
    ).toBe(true);
    expect(result.facts.some((f) => f.fieldKey === FIELD_KEYS.livingAreaSqFt)).toBe(true);
    expect(result.facts.some((f) => f.fieldKey === FIELD_KEYS.foundationType)).toBe(false);
    expect(result.facts.some((f) => f.fieldKey === FIELD_KEYS.estimatedValue)).toBe(false);
    expect(result.facts.some((f) => f.fieldKey === FIELD_KEYS.tractNumber)).toBe(false);
    expect(result.facts.some((f) => f.fieldKey === FIELD_KEYS.buildingCount)).toBe(false);
    // No ATTOM↔RentCast conflicts in single-source mode
    expect(
      result.conflicts.filter((c) => c.description.includes("ATTOM and RentCast")),
    ).toHaveLength(0);
    const comparison = result.diagnostics?.providerFieldComparison ?? [];
    expect(comparison.some((r) => r.attomValue != null && r.rentcastValue != null)).toBe(false);

    const siteItems = buildSiteInspectionItems({
      apn: result.identity.apn,
      property_profile_url: null,
      maps_json: result.maps,
      facts: result.facts.map((f, index) => ({
        id: String(index),
        report_id: "r",
        category: f.category,
        field_key: f.fieldKey,
        field_label: f.fieldLabel,
        normalized_value_text: f.normalizedValueText,
        normalized_value_number: f.normalizedValueNumber,
        normalized_value_boolean: f.normalizedValueBoolean,
        unit: f.unit ?? null,
        preferred_source_name: f.preferredSourceName ?? null,
        preferred_source_url: f.preferredSourceUrl ?? null,
        confidence: f.confidence,
        created_at: new Date().toISOString(),
      })),
    } as FullReport);
    expect(siteItems.map((i) => i.id)).toContain("foundation-type");
    expect(siteItems.map((i) => i.id)).toContain("utilities");
    expect(siteItems.map((i) => i.id)).toContain("easements-tract-maps");
    expect(siteItems.map((i) => i.id)).toContain("hydrant-pull-distance");
    expect(siteItems.map((i) => i.id)).toContain("buildable-area-verify");
  });
});

describe("dual-source comparison diagnostic", () => {
  it("builds side-by-side rows when both providers claim shared fields", () => {
    const now = new Date().toISOString();
    const claims: SourceClaim[] = [
      {
        fieldKey: FIELD_KEYS.bedrooms,
        sourceName: "ATTOM",
        sourceType: "licensed_property_api",
        rawValue: "3",
        normalizedValue: "3",
        matchMethod: "address",
        confidence: "high",
        retrievedAt: now,
      },
      {
        fieldKey: FIELD_KEYS.bedrooms,
        sourceName: "RentCast",
        sourceType: "licensed_property_api",
        rawValue: "3",
        normalizedValue: "3",
        matchMethod: "address",
        confidence: "high",
        retrievedAt: now,
      },
      {
        fieldKey: FIELD_KEYS.lotSqFt,
        sourceName: "ATTOM",
        sourceType: "licensed_property_api",
        rawValue: "6000",
        normalizedValue: "6000",
        matchMethod: "address",
        confidence: "high",
        retrievedAt: now,
      },
      {
        fieldKey: FIELD_KEYS.lotSqFt,
        sourceName: "RentCast",
        sourceType: "licensed_property_api",
        rawValue: "6050",
        normalizedValue: "6050",
        matchMethod: "address",
        confidence: "medium",
        retrievedAt: now,
      },
    ];
    const facts = buildPreferredFacts(claims);
    const rows = buildProviderFieldComparison(claims, facts);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const bedrooms = rows.find((r) => r.fieldKey === FIELD_KEYS.bedrooms);
    expect(bedrooms?.attomValue).toBe("3");
    expect(bedrooms?.rentcastValue).toBe("3");
    expect(bedrooms?.preferredSource).toBeTruthy();
    const lot = rows.find((r) => r.fieldKey === FIELD_KEYS.lotSqFt);
    expect(lot?.attomValue).toBe("6000");
    expect(lot?.rentcastValue).toBe("6050");
  });

  it("returns no dual comparison rows for RentCast-only claims", () => {
    const claims: SourceClaim[] = [
      {
        fieldKey: FIELD_KEYS.bedrooms,
        sourceName: "RentCast",
        sourceType: "licensed_property_api",
        rawValue: "3",
        normalizedValue: "3",
        matchMethod: "address",
        confidence: "high",
        retrievedAt: new Date().toISOString(),
      },
    ];
    const facts: PropertyFact[] = buildPreferredFacts(claims);
    const rows = buildProviderFieldComparison(claims, facts);
    expect(rows.every((r) => r.attomValue == null)).toBe(true);
  });

  it("conflict detection is quiet with a single licensed source", () => {
    const claims: SourceClaim[] = [
      {
        fieldKey: FIELD_KEYS.lotSqFt,
        sourceName: "RentCast",
        sourceType: "licensed_property_api",
        rawValue: "6000",
        normalizedValue: "6000",
        matchMethod: "address",
        confidence: "high",
        retrievedAt: new Date().toISOString(),
      },
    ];
    expect(detectConflicts(claims)).toHaveLength(0);
  });
});

describe("dual-source live run still calls ATTOM when configured", () => {
  it("invokes ATTOM and includes comparison when both succeed", async () => {
    setEnv();
    emptyGis();
    mockLookupAttom.mockResolvedValue({
      property: {
        identity: {
          attomId: "1",
          apn: "47222019",
          originalApn: null,
          fips: "06085",
          oneLineAddress: "655 13th St, San Jose, CA 95112",
          addressLine1: "655 13th St",
          locality: "San Jose",
          county: "Santa Clara",
          state: "CA",
          zipCode: "95112",
          latitude: 37.34,
          longitude: -121.87,
          matchCode: null,
          publicationDate: null,
          lastModified: null,
        },
        propertyType: "SFR",
        propertySubtype: null,
        landUseCode: null,
        lotAcres: null,
        lotSquareFootage: 6000,
        livingAreaSquareFootage: 1200,
        grossAreaSquareFootage: null,
        bedrooms: 3,
        bathroomsFull: 2,
        bathroomsPartial: null,
        bathroomsTotal: 2,
        stories: 1,
        yearBuilt: 1925,
        buildingCount: 1,
        pool: false,
        constructionType: null,
        foundationType: "Concrete Slab",
        roofType: null,
        heating: null,
        cooling: null,
        garage: null,
        legalDescription: null,
        subdivision: "Hensley",
        block: null,
        tract: "Tract 512",
        assessedValueTotal: 400000,
        assessedValueLand: null,
        assessedValueImprovement: null,
        taxAmount: null,
        assessmentYear: null,
        taxYear: null,
        estimatedValue: 900000,
        estimatedValueLow: null,
        estimatedValueHigh: null,
        avmConfidence: null,
        avmDate: null,
        lastSaleDate: null,
        lastSaleAmount: null,
        recordingDate: null,
        documentNumber: null,
        documentType: null,
        ownerNames: "Owner A",
        ownerOccupied: null,
        ownerMailingAddress: null,
        raw: {},
      },
      packageResults: [
        {
          packagePath: "property/detail",
          responseTimeMs: 20,
          httpStatus: 200,
          data: {},
        },
      ],
      statusMessage: null,
    });
    mockLookupRentCast.mockResolvedValue({
      property: rentCastProperty(),
      request: { responseTimeMs: 12, httpStatus: 200, data: {}, endpoint: "properties" },
      status: "active",
      statusMessage: null,
    });

    const { runLivePropertyResearch } =
      await import("@/lib/research/live/run-live-property-research");
    const result = await runLivePropertyResearch("655 13th St, San Jose, CA 95112");
    expect(mockLookupAttom).toHaveBeenCalled();
    expect(result.diagnostics?.attomConfigured).toBe(true);
    expect(result.facts.some((f) => f.fieldKey === FIELD_KEYS.foundationType)).toBe(true);
    const comparison = result.diagnostics?.providerFieldComparison ?? [];
    expect(comparison.some((r) => r.attomValue && r.rentcastValue)).toBe(true);
  });
});
