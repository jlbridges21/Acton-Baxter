import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acresToSquareFeet,
  normalizeAttomProperty,
  toNumber,
} from "@/lib/providers/attom/normalizer";
import { attomRequest, extractAttomProperties } from "@/lib/providers/attom/client";
import { AttomError } from "@/lib/providers/attom/errors";
import { resetEnvCacheForTests } from "@/lib/env";

function setBaseEnv(overrides: Record<string, string> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.ATTOM_API_KEY = "test-attom-key";
  process.env.EXTERNAL_API_MAX_RETRIES = "2";
  process.env.EXTERNAL_API_TIMEOUT_MS = "5000";
  Object.assign(process.env, overrides);
  resetEnvCacheForTests();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetEnvCacheForTests();
});

describe("ATTOM normalizer", () => {
  it("normalizes a successful property/detail payload", () => {
    const property = normalizeAttomProperty({
      identifier: { attomId: 12345, apn: "47222019", fips: "06085" },
      address: {
        oneLine: "655 13TH ST, SAN JOSE, CA 95112",
        line1: "655 13TH ST",
        locality: "San Jose",
        countrySubd: "CA",
        postal1: "95112",
        matchCode: "A",
      },
      location: { latitude: "37.34", longitude: "-121.87" },
      summary: { propType: "SFR", yearBuilt: "1925" },
      lot: { lotsize2: "6000", lotsize1: "0.1377", acres: "0.1377" },
      building: {
        size: { livingSize: "1200", bldgSize: "1300" },
        rooms: { beds: "3", bathsTotal: "2", bathsFull: "2", bathsPartial: "0" },
        summary: { levels: "1", bldgsNum: "1" },
      },
    });

    expect(property.identity.attomId).toBe("12345");
    expect(property.identity.apn).toBe("47222019");
    expect(property.identity.fips).toBe("06085");
    expect(property.lotSquareFootage).toBe(6000);
    expect(property.livingAreaSquareFootage).toBe(1200);
    expect(property.bedrooms).toBe(3);
    expect(property.bathroomsTotal).toBe(2);
    expect(property.yearBuilt).toBe(1925);
  });

  it("handles missing fields without throwing", () => {
    const property = normalizeAttomProperty({});
    expect(property.identity.attomId).toBeNull();
    expect(property.lotSquareFootage).toBeNull();
    expect(property.livingAreaSquareFootage).toBeNull();
  });

  it("converts acres to square feet", () => {
    expect(acresToSquareFeet(1)).toBe(43560);
    expect(acresToSquareFeet(0.1377)).toBe(5998);
    expect(acresToSquareFeet(null)).toBeNull();
  });

  it("parses numerical strings safely", () => {
    expect(toNumber("1,200")).toBe(1200);
    expect(toNumber("$450,000")).toBe(450000);
    expect(toNumber("")).toBeNull();
    expect(toNumber("abc")).toBeNull();
  });

  it("handles malformed nested responses", () => {
    const properties = extractAttomProperties({ unexpected: true });
    expect(properties).toEqual([]);
  });
});

describe("ATTOM client", () => {
  it("throws on HTTP 401", async () => {
    setBaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ status: { msg: "Unauthorized" } }),
      }),
    );

    await expect(
      attomRequest("property/detail", { address1: "655 13th St" }),
    ).rejects.toBeInstanceOf(AttomError);
  });

  it("retries on HTTP 429 then succeeds", async () => {
    setBaseEnv({ EXTERNAL_API_MAX_RETRIES: "2" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 429,
        ok: false,
        text: async () => "rate limited",
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () =>
          JSON.stringify({
            property: [{ identifier: { attomId: 1 }, address: { oneLine: "A" } }],
          }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await attomRequest("property/detail", { address1: "655 13th St" });
    expect(result.httpStatus).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks optional package failures as unavailable without throwing", async () => {
    setBaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        text: async () => JSON.stringify({ status: { msg: "Not Found" } }),
      }),
    );

    const result = await attomRequest("avm/detail", { attomid: "1" });
    expect(result.unavailable).toBe(true);
    expect(result.httpStatus).toBe(404);
  });
});
