import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateAiReportContent,
  sanitizeAiInput,
  validateAndGroundAiContent,
} from "@/lib/providers/ai/provider";
import { buildDeterministicAiContent } from "@/lib/providers/ai/deterministic-provider";
import type { NormalizedResearchResult } from "@/lib/research/schemas";
import { FIELD_KEYS } from "@/lib/research/constants";
import { resetEnvCacheForTests } from "@/lib/env";

function setTestEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.AI_PROVIDER = "deterministic";
  resetEnvCacheForTests();
}

beforeEach(() => {
  setTestEnv();
});

afterEach(() => {
  resetEnvCacheForTests();
});

function sampleResult(): NormalizedResearchResult {
  return {
    identity: {
      inputAddress: "655 13th St, San Jose, CA",
      standardizedAddress: "655 13th St, San Jose, CA 95112",
      apn: "47222019",
      latitude: 37.34,
      longitude: -121.87,
      jurisdiction: "San Jose",
      county: "Santa Clara",
      state: "CA",
      zipCode: "95112",
    },
    characteristics: {
      lotSquareFootage: 6000,
      livingAreaSquareFootage: 1200,
      bedrooms: 3,
      bathrooms: 2,
      yearBuilt: 1925,
    },
    planning: {
      zoning: "R-1-8",
      relevantOverlays: [],
    },
    maps: {},
    permits: [],
    facts: [
      {
        category: "identity",
        fieldKey: FIELD_KEYS.apn,
        fieldLabel: "APN",
        normalizedValueText: "47222019",
        normalizedValueNumber: null,
        normalizedValueBoolean: null,
        unit: null,
        preferredSourceName: "ATTOM",
        preferredSourceUrl: null,
        confidence: "high",
      },
      {
        category: "characteristics",
        fieldKey: FIELD_KEYS.lotSqFt,
        fieldLabel: "Lot size",
        normalizedValueText: "6000",
        normalizedValueNumber: 6000,
        normalizedValueBoolean: null,
        unit: "sq ft",
        preferredSourceName: "ATTOM",
        preferredSourceUrl: null,
        confidence: "medium",
      },
    ],
    claims: [],
    conflicts: [
      {
        fieldKey: FIELD_KEYS.lotSqFt,
        fieldLabel: "Lot size",
        severity: "warning",
        description: "Lot sizes differ",
        values: [
          { sourceName: "ATTOM", value: "6000" },
          { sourceName: "County", value: "6200" },
        ],
        recommendedResolution: "Verify during feasibility.",
      },
    ],
    sources: [
      {
        sourceName: "ATTOM",
        sourceType: "licensed_property_api",
        sourceUrl: "https://api.developer.attomdata.com/",
        status: "active",
      },
    ],
    parcelGeometry: null,
    siteObservations: [],
    pemPreparation: {
      overview: "x",
      propertyFindings: ["a"],
      propertyQuestions: ["b"],
      verifyDuringPem: [],
      verifyDuringFeasibility: [],
      verifyThroughTitleOrSurvey: [],
      verifyWithPlanning: [],
    },
    summary: "summary",
  };
}

describe("AI report generation", () => {
  it("sanitizes input without owner mailing details", () => {
    const input = sanitizeAiInput(sampleResult());
    expect(input.availableFieldKeys).not.toContain("owner_mailing_address");
    expect(input.availableFieldKeys).not.toContain("owner_name");
    expect(input.apn).toBe("47222019");
  });

  it("builds deterministic content within limits", () => {
    const content = buildDeterministicAiContent(sanitizeAiInput(sampleResult()));
    expect(content.importantPropertyFindings.length).toBeGreaterThan(0);
    expect(content.importantPropertyFindings.length).toBeLessThanOrEqual(3);
    expect(content.propertySpecificQuestions.length).toBeGreaterThan(0);
    expect(content.propertySpecificQuestions.length).toBeLessThanOrEqual(5);
  });

  it("rejects findings with unknown field keys", () => {
    const input = sanitizeAiInput(sampleResult());
    expect(() =>
      validateAndGroundAiContent(
        {
          researchSummary: Array.from({ length: 90 }, () => "word").join(" "),
          importantPropertyFindings: [
            {
              title: "Invented",
              description: "Made up",
              sourceFieldKeys: ["not_a_real_field"],
            },
          ],
          propertySpecificQuestions: ["Q?"],
          verifyDuringPem: ["A"],
          verifyDuringFeasibility: ["B"],
          verifyThroughTitleOrSurvey: ["C"],
          verifyWithPlanning: ["D"],
        },
        input,
      ),
    ).toThrow(/grounded/i);
  });

  it("falls back to deterministic when AI_PROVIDER is deterministic", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.AI_PROVIDER = "deterministic";
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const result = await generateAiReportContent(sampleResult());
    expect(result.provider).toBe("deterministic");
    expect(result.status).toBe("success");
    expect(result.content.researchSummary.length).toBeGreaterThan(40);
  });
});
