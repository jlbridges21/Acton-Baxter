import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";

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

function setEnv(overrides: Record<string, string> = {}) {
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
}

afterEach(() => {
  vi.clearAllMocks();
  resetEnvCacheForTests();
});

describe("live research orchestration", () => {
  it("completes when ATTOM and RentCast both succeed", async () => {
    setEnv();
    emptyGis();
    mockLookupAttom.mockResolvedValue({
      property: {
        identity: {
          attomId: "1",
          apn: "47222019",
          fips: "06085",
          oneLineAddress: "655 13th St, San Jose, CA 95112",
          locality: "San Jose",
          county: "Santa Clara",
          state: "CA",
          zipCode: "95112",
          latitude: 37.34,
          longitude: -121.87,
        },
        lotSquareFootage: 6000,
        lotAcres: null,
        livingAreaSquareFootage: 1200,
        bedrooms: 3,
        bathroomsTotal: 2,
        stories: 1,
        yearBuilt: 1925,
        propertyType: "SFR",
        estimatedValue: 900000,
        assessedValueTotal: 400000,
        lastSaleDate: null,
        lastSaleAmount: null,
        ownerNames: "Owner A",
        ownerMailingAddress: null,
        subdivision: null,
        tract: null,
        buildingCount: 1,
        pool: false,
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
      property: {
        id: "rc-1",
        formattedAddress: "655 13th St, San Jose, CA 95112",
        city: "San Jose",
        state: "CA",
        zipCode: "95112",
        county: "Santa Clara",
        latitude: 37.3401,
        longitude: -121.8701,
        livingAreaSquareFootage: 1180,
        lotSquareFootage: 6050,
        bedrooms: 3,
        bathrooms: 2,
        yearBuilt: 1925,
        stories: 1,
        propertyType: "Single Family",
        assessedValue: 400000,
        lastSaleDate: null,
        lastSalePrice: null,
        ownerNames: "Owner A",
        ownerMailingAddress: null,
        subdivision: null,
        pool: false,
        matchMethod: "address",
        matchScore: 90,
      },
      request: { responseTimeMs: 15, httpStatus: 200, data: {}, endpoint: "properties" },
      status: "active",
      statusMessage: null,
    });

    const { runLivePropertyResearch } =
      await import("@/lib/research/live/run-live-property-research");
    const result = await runLivePropertyResearch("655 13th St, San Jose, CA 95112");
    expect(result.identity.apn).toBe("47222019");
    expect(result.identity.attomId).toBe("1");
    expect(result.identity.rentcastId).toBe("rc-1");
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.facts.length).toBeGreaterThan(0);
  });

  it("completes when ATTOM succeeds and RentCast fails", async () => {
    setEnv();
    emptyGis();
    mockLookupAttom.mockResolvedValue({
      property: {
        identity: {
          attomId: "1",
          apn: "47222019",
          fips: "06085",
          oneLineAddress: "655 13th St, San Jose, CA 95112",
          locality: "San Jose",
          county: "Santa Clara",
          state: "CA",
          zipCode: "95112",
          latitude: 37.34,
          longitude: -121.87,
        },
        lotSquareFootage: 6000,
        lotAcres: null,
        livingAreaSquareFootage: 1200,
        bedrooms: 3,
        bathroomsTotal: 2,
        stories: 1,
        yearBuilt: 1925,
        propertyType: "SFR",
        estimatedValue: null,
        assessedValueTotal: null,
        lastSaleDate: null,
        lastSaleAmount: null,
        ownerNames: null,
        ownerMailingAddress: null,
        subdivision: null,
        tract: null,
        buildingCount: 1,
        pool: false,
      },
      packageResults: [],
      statusMessage: null,
    });
    mockLookupRentCast.mockRejectedValue(new Error("RentCast down"));

    const { runLivePropertyResearch } =
      await import("@/lib/research/live/run-live-property-research");
    const result = await runLivePropertyResearch("655 13th St, San Jose, CA");
    expect(result.identity.attomId).toBe("1");
    expect(result.sources.some((source) => source.sourceName === "RentCast")).toBe(true);
  });

  it("completes when RentCast succeeds and ATTOM fails", async () => {
    setEnv();
    emptyGis();
    mockLookupAttom.mockRejectedValue(new Error("ATTOM down"));
    mockLookupRentCast.mockResolvedValue({
      property: {
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
        assessedValue: null,
        lastSaleDate: null,
        lastSalePrice: null,
        ownerNames: null,
        ownerMailingAddress: null,
        subdivision: null,
        pool: false,
        matchMethod: "address",
        matchScore: 90,
      },
      request: { responseTimeMs: 12, httpStatus: 200, data: {}, endpoint: "properties" },
      status: "active",
      statusMessage: null,
    });

    const { runLivePropertyResearch } =
      await import("@/lib/research/live/run-live-property-research");
    const result = await runLivePropertyResearch("655 13th St, San Jose, CA");
    expect(result.identity.rentcastId).toBe("rc-1");
  });

  it("continues when GIS fails", async () => {
    setEnv();
    mockLookupAttom.mockResolvedValue({
      property: {
        identity: {
          attomId: "1",
          apn: "47222019",
          fips: "06085",
          oneLineAddress: "655 13th St, San Jose, CA 95112",
          locality: "San Jose",
          county: "Santa Clara",
          state: "CA",
          zipCode: "95112",
          latitude: 37.34,
          longitude: -121.87,
        },
        lotSquareFootage: 6000,
        lotAcres: null,
        livingAreaSquareFootage: 1200,
        bedrooms: 3,
        bathroomsTotal: 2,
        stories: 1,
        yearBuilt: 1925,
        propertyType: "SFR",
        estimatedValue: null,
        assessedValueTotal: null,
        lastSaleDate: null,
        lastSaleAmount: null,
        ownerNames: null,
        ownerMailingAddress: null,
        subdivision: null,
        tract: null,
        buildingCount: 1,
        pool: false,
      },
      packageResults: [],
      statusMessage: null,
    });
    mockLookupRentCast.mockResolvedValue({
      property: null,
      request: { responseTimeMs: 5, httpStatus: 200, data: [], endpoint: "properties" },
      status: "unavailable",
      statusMessage: "no match",
    });
    mockSjParcel.mockRejectedValue(new Error("GIS down"));
    mockCountyParcel.mockRejectedValue(new Error("County GIS down"));
    mockSjZoning.mockRejectedValue(new Error("Zoning down"));
    mockSjGp.mockRejectedValue(new Error("GP down"));
    mockSjHistoric.mockRejectedValue(new Error("Historic down"));
    mockSjOverlays.mockRejectedValue(new Error("Overlays down"));

    const { runLivePropertyResearch } =
      await import("@/lib/research/live/run-live-property-research");
    const result = await runLivePropertyResearch("655 13th St, San Jose, CA");
    expect(result.identity.attomId).toBe("1");
    expect(result.planning.zoning).toBeNull();
  });

  it("fails when all primary providers fail", async () => {
    setEnv();
    emptyGis();
    mockLookupAttom.mockRejectedValue(new Error("ATTOM down"));
    mockLookupRentCast.mockRejectedValue(new Error("RentCast down"));

    const { runLivePropertyResearch } =
      await import("@/lib/research/live/run-live-property-research");
    await expect(runLivePropertyResearch("655 13th St, San Jose, CA")).rejects.toThrow(
      /no provider returned a confident property match/,
    );
  });

  it("saves GIS success into preferred zoning when available", async () => {
    setEnv();
    mockLookupAttom.mockResolvedValue({
      property: {
        identity: {
          attomId: "1",
          apn: "47222019",
          fips: "06085",
          oneLineAddress: "655 13th St, San Jose, CA 95112",
          locality: "San Jose",
          county: "Santa Clara",
          state: "CA",
          zipCode: "95112",
          latitude: 37.34,
          longitude: -121.87,
        },
        lotSquareFootage: 6000,
        lotAcres: null,
        livingAreaSquareFootage: 1200,
        bedrooms: 3,
        bathroomsTotal: 2,
        stories: 1,
        yearBuilt: 1925,
        propertyType: "SFR",
        estimatedValue: null,
        assessedValueTotal: null,
        lastSaleDate: null,
        lastSaleAmount: null,
        ownerNames: null,
        ownerMailingAddress: null,
        subdivision: null,
        tract: null,
        buildingCount: 1,
        pool: false,
      },
      packageResults: [],
      statusMessage: null,
    });
    mockLookupRentCast.mockResolvedValue({
      property: null,
      request: { responseTimeMs: 5, httpStatus: 200, data: [], endpoint: "properties" },
      status: "unavailable",
      statusMessage: "no match",
    });
    mockSjParcel.mockResolvedValue({
      parcel: {
        apn: "47222019",
        geometryGeojson: {
          type: "Polygon",
          coordinates: [
            [
              [-121.88, 37.34],
              [-121.87, 37.34],
              [-121.87, 37.35],
              [-121.88, 37.35],
              [-121.88, 37.34],
            ],
          ],
        },
        centroidLatitude: 37.345,
        centroidLongitude: -121.875,
        lotSquareFootage: 6001,
        sourceName: "San Jose ArcGIS Parcels",
        sourceUrl: "https://example.com",
      },
      responseTimeMs: 20,
      statusMessage: null,
    });
    mockCountyParcel.mockResolvedValue({
      apn: "47222019",
      lotSquareFootage: 6001,
      taxRateArea: "17194",
      situsCity: "SAN JOSE",
      situsZip: "95112",
      geometryGeojson: null,
      centroidLatitude: null,
      centroidLongitude: null,
      sourceName: "Santa Clara County Parcels (ArcGIS)",
      sourceUrl: "https://example.com/county",
      responseTimeMs: 18,
      statusMessage: null,
    });
    mockSjZoning.mockResolvedValue({
      zoning: {
        zoning: "R-1-8",
        sourceUrl: "https://example.com/zoning",
      },
      responseTimeMs: 12,
      statusMessage: null,
    });
    mockSjGp.mockResolvedValue({
      generalPlan: {
        designation: "Residential Neighborhood",
        sourceUrl: "https://example.com/gp",
      },
      responseTimeMs: 12,
      statusMessage: null,
    });
    mockSjHistoric.mockResolvedValue({
      historic: null,
      responseTimeMs: 5,
      statusMessage: "none",
    });
    mockSjOverlays.mockResolvedValue({ overlays: [], responseTimeMs: 5, statusMessage: null });

    const { runLivePropertyResearch } =
      await import("@/lib/research/live/run-live-property-research");
    const result = await runLivePropertyResearch("655 13th St, San Jose, CA");
    expect(result.planning.zoning).toBe("R-1-8");
    expect(result.propertyProfile?.accessType).toBe("generic_search");
    expect(result.parcelGeometry).not.toBeNull();
  });
});
