import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetGhlConfigCacheForTests } from "@/lib/connectors/ghl/config";
import { classifyGhlApiError } from "@/lib/connectors/ghl/errors";
import {
  buildOpportunitySearchQuery,
  assertNoDeprecatedOpportunityParams,
  DEPRECATED_OPPORTUNITY_SEARCH_PARAMS,
} from "@/lib/connectors/ghl/request-contracts";
import {
  resolveGhlApiVersion,
  inferGhlResourceFromPath,
  GHL_API_VERSIONS,
} from "@/lib/connectors/ghl/api-versions";
import { sanitizeGhlQuery } from "@/lib/connectors/ghl/client";
import { detectGhlIntent } from "@/lib/baxter-ai/ghl-intent";
import { isOpportunityUnowned } from "@/lib/connectors/ghl/insights";
import { canUserWriteGhl } from "@/lib/connectors/ghl/actions/permissions";
import type { Profile } from "@/lib/research/db-types";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_GHL_INTEGRATION = "true";
  process.env.ENABLE_GHL_WRITES_FOR_SALES = "false";
  process.env.GHL_AUTH_MODE = "private_integration";
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";
  process.env.GHL_LOCATION_ID = "loc-acton";
  resetEnvCacheForTests();
  resetGhlConfigCacheForTests();
});

describe("GHL Prompt 3 — opportunity search contract", () => {
  it("builds v3 camelCase locationId query and omits empties", () => {
    const q = buildOpportunitySearchQuery({
      locationId: "loc-acton",
      limit: 1,
      status: "open",
      pipelineId: "pipe1",
      pipelineStageId: "stage1",
      contactId: "c1",
      assignedTo: "u1",
    });
    expect(q.locationId).toBe("loc-acton");
    expect(q.limit).toBe(1);
    expect(q.pipelineId).toBe("pipe1");
    expect(q.pipelineStageId).toBe("stage1");
    expect(q.contactId).toBe("c1");
    expect(q.assignedTo).toBe("u1");
    expect("location_id" in q).toBe(false);
    expect("pipeline_id" in q).toBe(false);
  });

  it("rejects deprecated snake_case opportunity params", () => {
    expect(() =>
      assertNoDeprecatedOpportunityParams({ location_id: "x", locationId: "y" }),
    ).toThrow(/Deprecated|both/i);
    for (const key of DEPRECATED_OPPORTUNITY_SEARCH_PARAMS) {
      expect(() => assertNoDeprecatedOpportunityParams({ [key]: "x" })).toThrow(/Deprecated/);
    }
  });

  it("rejects empty locationId", () => {
    expect(() => buildOpportunitySearchQuery({ locationId: "  " })).toThrow();
  });

  it("opportunities resource resolves Version v3", () => {
    expect(resolveGhlApiVersion("opportunities")).toBe("v3");
    expect(inferGhlResourceFromPath("/opportunities/search")).toBe("opportunities");
    expect(GHL_API_VERSIONS.pipelines).toBe("v3");
  });

  it("sanitizeGhlQuery omits empty and undefined", () => {
    expect(sanitizeGhlQuery({ locationId: "abc", q: "", limit: 1, x: undefined })).toEqual({
      locationId: "abc",
      limit: 1,
    });
  });
});

describe("GHL Prompt 3 — error mapping", () => {
  it("maps 422 locationId/location_id conflict to CONTRACT_ERROR not offline", () => {
    const code = classifyGhlApiError(
      422,
      JSON.stringify({
        message: [
          "property locationId should not exist",
          "location_id must be a string",
          "location_id should not be empty",
        ],
        error: "Unprocessable Entity",
      }),
    );
    expect(code).toBe("BAXTER_GHL_CONTRACT_ERROR");
  });

  it("maps 429 to RATE_LIMITED", () => {
    expect(classifyGhlApiError(429, "too many")).toBe("BAXTER_GHL_RATE_LIMITED");
  });

  it("maps 5xx to API_UNAVAILABLE", () => {
    expect(classifyGhlApiError(503, "down")).toBe("BAXTER_GHL_API_UNAVAILABLE");
  });
});

describe("GHL Prompt 3 — insights intents", () => {
  it("detects unowned opportunity insight", () => {
    const intent = detectGhlIntent("Show me open opportunities without an owner");
    expect(intent.intent).toBe("insight_unowned");
    expect(intent.isWriteIntent).toBe(false);
  });

  it("detects appointment insight", () => {
    const intent = detectGhlIntent("Who has appointments this week?");
    expect(intent.intent).toBe("insight_appointments");
  });

  it("isOpportunityUnowned filters assignedTo", () => {
    expect(
      isOpportunityUnowned({
        id: "1",
        name: "A",
        pipelineId: "p",
        pipelineStageId: "s",
        status: "open",
        monetaryValue: null,
        contactId: "c",
        assignedTo: null,
        source: null,
        dateAdded: null,
        dateUpdated: null,
        customFields: {},
      }),
    ).toBe(true);
  });
});

describe("GHL Prompt 3 — write permission UX", () => {
  it("sales denied message separates employee auth from API scope", () => {
    const sales: Profile = {
      id: "u1",
      full_name: "Sales",
      role: "salesperson",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const perm = canUserWriteGhl(sales);
    expect(perm.canWrite).toBe(false);
    expect(perm.reason).toMatch(/restricted to admins/i);
    expect(perm.reason).not.toMatch(/scope/i);
  });
});
