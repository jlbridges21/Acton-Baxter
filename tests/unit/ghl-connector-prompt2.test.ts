import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetGhlConfigCacheForTests } from "@/lib/connectors/ghl/config";
import {
  classifyGhlApiError,
  userFacingGhlError,
  type GhlErrorCode,
} from "@/lib/connectors/ghl/errors";
import { detectGhlIntent, requiresGhlData, isWriteIntent } from "@/lib/baxter-ai/ghl-intent";
import {
  isContactFieldAllowed,
  isOpportunityFieldAllowed,
  filterContactChanges,
  filterOpportunityChanges,
} from "@/lib/connectors/ghl/actions/allowlist";
import { canUserWriteGhl, isActionAllowed } from "@/lib/connectors/ghl/actions/permissions";
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
  process.env.GHL_LOCATION_ID = "test-location";
  resetEnvCacheForTests();
  resetGhlConfigCacheForTests();
});

describe("GHL Error Classification - Scope vs Auth", () => {
  it("classifies 401 with 'not authorized for this scope' as SCOPE_MISSING", () => {
    const code = classifyGhlApiError(
      401,
      '{"message":"The token is not authorized for this scope."}',
    );
    expect(code).toBe("BAXTER_GHL_SCOPE_MISSING");
  });

  it("classifies 401 with 'scope' and 'not authorized' as SCOPE_MISSING", () => {
    const code = classifyGhlApiError(401, '{"error":"scope not authorized"}');
    expect(code).toBe("BAXTER_GHL_SCOPE_MISSING");
  });

  it("classifies 401 with 'insufficient scope' as SCOPE_MISSING", () => {
    const code = classifyGhlApiError(401, '{"message":"insufficient scope for this request"}');
    expect(code).toBe("BAXTER_GHL_SCOPE_MISSING");
  });

  it("classifies 403 with scope language as SCOPE_MISSING", () => {
    const code = classifyGhlApiError(403, '{"message":"Permission denied for scope"}');
    expect(code).toBe("BAXTER_GHL_SCOPE_MISSING");
  });

  it("classifies 401 with 'expired' as TOKEN_EXPIRED", () => {
    const code = classifyGhlApiError(401, '{"message":"Token has expired"}');
    expect(code).toBe("BAXTER_GHL_TOKEN_EXPIRED");
  });

  it("classifies 401 with 'invalid token' as TOKEN_EXPIRED", () => {
    const code = classifyGhlApiError(401, '{"message":"invalid token provided"}');
    expect(code).toBe("BAXTER_GHL_TOKEN_EXPIRED");
  });

  it("classifies generic 401 as AUTH_FAILED", () => {
    const code = classifyGhlApiError(401, '{"message":"Unauthorized"}');
    expect(code).toBe("BAXTER_GHL_AUTH_FAILED");
  });

  it("classifies 401 with location access issue as LOCATION_ACCESS_DENIED", () => {
    const code = classifyGhlApiError(401, '{"message":"Location access not authorized"}');
    expect(code).toBe("BAXTER_GHL_LOCATION_ACCESS_DENIED");
  });

  it("classifies 403 with location as LOCATION_ACCESS_DENIED", () => {
    const code = classifyGhlApiError(403, '{"message":"Access denied for location"}');
    expect(code).toBe("BAXTER_GHL_LOCATION_ACCESS_DENIED");
  });

  it("isScopeError returns true for scope-related errors", () => {
    expect(classifyGhlApiError(401, "not authorized for this scope")).toBe(
      "BAXTER_GHL_SCOPE_MISSING",
    );
  });

  it("userFacingGhlError provides actionable PIT guidance for scope issues", () => {
    const message = userFacingGhlError("BAXTER_GHL_SCOPE_MISSING", "contacts");
    expect(message).toContain("Private Integration");
    expect(message).toContain("Edit");
    expect(message).toContain("scopes");
  });

  it("userFacingGhlError for LOCATION_ACCESS_DENIED mentions optional scope", () => {
    const message = userFacingGhlError("BAXTER_GHL_LOCATION_ACCESS_DENIED");
    expect(message).toContain("optional");
    expect(message).toContain("contacts");
  });
});

describe("GHL PIT Configuration", () => {
  it("PIT mode does not require CLIENT_ID/SECRET", async () => {
    delete process.env.GHL_CLIENT_ID;
    delete process.env.GHL_CLIENT_SECRET;
    process.env.ENABLE_GHL_INTEGRATION = "true";
    process.env.GHL_AUTH_MODE = "private_integration";
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";
    process.env.GHL_LOCATION_ID = "test-location";
    resetGhlConfigCacheForTests();

    // Import fresh module to get updated config
    const config = await import("@/lib/connectors/ghl/config");
    resetGhlConfigCacheForTests();

    expect(config.getGhlAuthMode()).toBe("private_integration");
    expect(config.isGhlConfigured()).toBe(true);
  });

  it("PIT mode requires ENABLE + TOKEN + LOCATION_ID", async () => {
    delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    resetGhlConfigCacheForTests();

    const config = await import("@/lib/connectors/ghl/config");
    resetGhlConfigCacheForTests();

    expect(config.isGhlConfigured()).toBe(false);
  });
});

describe("GHL Intent Detection", () => {
  it("detects contact lookup intent", () => {
    const detection = detectGhlIntent("Who is John Smith?");
    expect(detection.intent).toBe("contact_lookup");
    expect(detection.confidence).toBeGreaterThan(0.5);
    expect(detection.entities.contactName).toBe("John Smith");
  });

  it("detects email lookup intent", () => {
    const detection = detectGhlIntent("Find contact for jane@example.com");
    expect(detection.intent).toBe("contact_lookup");
    expect(detection.entities.contactEmail).toBe("jane@example.com");
  });

  it("detects opportunity lookup intent", () => {
    const detection = detectGhlIntent("What's the status of the ADU project?");
    expect(detection.intent).toBe("opportunity_lookup");
    expect(detection.confidence).toBeGreaterThan(0.5);
  });

  it("detects pipeline info intent", () => {
    const detection = detectGhlIntent("What are the stages in our sales pipeline?");
    expect(detection.intent).toBe("pipeline_info");
  });

  it("detects write intent for contact update", () => {
    const detection = detectGhlIntent("Update John's phone number to 555-1234");
    expect(detection.intent).toBe("write_contact");
    expect(detection.isWriteIntent).toBe(true);
    expect(detection.requiresConfirmation).toBe(true);
  });

  it("detects write intent for opportunity status change", () => {
    const detection = detectGhlIntent("Mark the Smith opportunity as won");
    expect(detection.intent).toBe("write_opportunity");
    expect(detection.isWriteIntent).toBe(true);
  });

  it("detects write intent for tag operations", () => {
    const detection = detectGhlIntent("Add the 'VIP' tag to John Smith");
    expect(detection.intent).toBe("write_tag");
    expect(detection.isWriteIntent).toBe(true);
  });

  it("returns none for non-CRM queries", () => {
    const detection = detectGhlIntent("What is the weather today?");
    expect(detection.intent).toBe("none");
    expect(detection.confidence).toBe(0);
  });

  it("requiresGhlData returns true for CRM queries", () => {
    expect(requiresGhlData("Who is John Smith?")).toBe(true);
    expect(requiresGhlData("What is the weather?")).toBe(false);
  });

  it("isWriteIntent returns true only for write operations", () => {
    expect(isWriteIntent("Update John's email")).toBe(true);
    expect(isWriteIntent("Who is John Smith?")).toBe(false);
  });
});

describe("GHL Field Allowlist", () => {
  it("allows standard contact fields", () => {
    expect(isContactFieldAllowed("firstName")).toBe(true);
    expect(isContactFieldAllowed("lastName")).toBe(true);
    expect(isContactFieldAllowed("email")).toBe(true);
    expect(isContactFieldAllowed("phone")).toBe(true);
    expect(isContactFieldAllowed("companyName")).toBe(true);
  });

  it("rejects non-allowlisted contact fields", () => {
    expect(isContactFieldAllowed("customField_123")).toBe(false);
    expect(isContactFieldAllowed("id")).toBe(false);
    expect(isContactFieldAllowed("dateAdded")).toBe(false);
  });

  it("allows standard opportunity fields", () => {
    expect(isOpportunityFieldAllowed("name")).toBe(true);
    expect(isOpportunityFieldAllowed("monetaryValue")).toBe(true);
    expect(isOpportunityFieldAllowed("status")).toBe(true);
    expect(isOpportunityFieldAllowed("pipelineStageId")).toBe(true);
  });

  it("filterContactChanges filters to allowed fields only", () => {
    const changes = {
      firstName: "John",
      email: "john@example.com",
      customField: "value",
      id: "should-be-rejected",
    };

    const { allowed, rejected } = filterContactChanges(changes);

    expect(allowed).toEqual({
      firstName: "John",
      email: "john@example.com",
    });
    expect(rejected).toContain("customField");
    expect(rejected).toContain("id");
  });

  it("filterOpportunityChanges validates status values", () => {
    const validChanges = { status: "won", monetaryValue: 50000 };
    const invalidChanges = { status: "invalid_status" };

    const validResult = filterOpportunityChanges(validChanges);
    const invalidResult = filterOpportunityChanges(invalidChanges);

    expect(validResult.allowed.status).toBe("won");
    expect(invalidResult.rejected).toContain("status (invalid value: invalid_status)");
  });
});

describe("GHL Write Permissions", () => {
  const adminUser: Profile = {
    id: "admin-1",
    full_name: "Admin User",
    role: "admin",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const salespersonUser: Profile = {
    id: "sales-1",
    full_name: "Sales User",
    role: "user",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const newUser: Profile = {
    id: "new-1",
    full_name: "New User",
    role: "new_user",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it("admins can always write when GHL is enabled", () => {
    const permission = canUserWriteGhl(adminUser);
    expect(permission.canWrite).toBe(true);
    expect(permission.allowedActions).toBeDefined();
    expect(permission.allowedActions?.length).toBeGreaterThan(0);
  });

  it("salespeople cannot write by default", () => {
    const permission = canUserWriteGhl(salespersonUser);
    expect(permission.canWrite).toBe(false);
    expect(permission.reason).toMatch(/restricted to admins|not enabled/i);
  });

  it("salespeople can write when ENABLE_GHL_WRITES_FOR_SALES is true", () => {
    process.env.ENABLE_GHL_WRITES_FOR_SALES = "true";

    const permission = canUserWriteGhl(salespersonUser);
    expect(permission.canWrite).toBe(true);
  });

  it("new users cannot write", () => {
    const permission = canUserWriteGhl(newUser);
    expect(permission.canWrite).toBe(false);
  });

  it("null user cannot write", () => {
    const permission = canUserWriteGhl(null);
    expect(permission.canWrite).toBe(false);
    expect(permission.reason).toContain("not authenticated");
  });

  it("isActionAllowed checks specific action types", () => {
    expect(isActionAllowed(adminUser, "update_contact_fields")).toBe(true);
    expect(isActionAllowed(newUser, "update_contact_fields")).toBe(false);
  });

  it("write is disabled when GHL integration is disabled", () => {
    process.env.ENABLE_GHL_INTEGRATION = "false";

    const permission = canUserWriteGhl(adminUser);
    expect(permission.canWrite).toBe(false);
    expect(permission.reason).toContain("disabled");
  });
});

describe("GHL Read Never Writes", () => {
  it("read functions do not export write operations", async () => {
    const baxterDataGhl = await import("@/lib/baxter-data/ghl");
    const exports = Object.keys(baxterDataGhl);

    // Read functions should be present
    expect(exports).toContain("searchBaxterContacts");
    expect(exports).toContain("searchBaxterOpportunities");
    expect(exports).toContain("buildGhlContext");
    expect(exports).toContain("resolveContact");

    // Write functions should NOT be present in baxter-data
    expect(exports).not.toContain("createPendingAction");
    expect(exports).not.toContain("executeAction");
    expect(exports).not.toContain("confirmAndExecuteAction");
  });
});

describe("GHL Capability Matrix", () => {
  it("core capabilities are defined", async () => {
    const { CORE_CAPABILITIES, OPTIONAL_READ_CAPABILITIES } =
      await import("@/lib/connectors/ghl/capabilities");

    expect(CORE_CAPABILITIES).toContain("contacts.read");
    expect(CORE_CAPABILITIES).toContain("pipelines.read");
    expect(CORE_CAPABILITIES).toContain("opportunities.read");
    expect(CORE_CAPABILITIES).not.toContain("location.read"); // Optional

    expect(OPTIONAL_READ_CAPABILITIES).toContain("location.read");
    expect(OPTIONAL_READ_CAPABILITIES).toContain("calendars.read");
  });
});

describe("GHL Pending Action Status Flow", () => {
  it("pending action types are properly defined", async () => {
    const { toGhlPendingAction } = await import("@/lib/connectors/ghl/actions/types");

    const mockRow = {
      id: "action-1",
      user_id: "user-1",
      external_user_id: null,
      conversation_id: "conv-1",
      channel: "web" as const,
      action_type: "update_contact_fields" as const,
      resource_type: "contact" as const,
      resource_id: "contact-1",
      resource_name: "John Smith",
      before_state: { phone: "555-0000" },
      proposed_changes: { phone: "555-1234" },
      status: "pending" as const,
      expires_at: new Date(Date.now() + 600000).toISOString(),
      created_at: new Date().toISOString(),
      confirmed_at: null,
      executed_at: null,
      error_code: null,
      error_message: null,
      metadata: {},
    };

    const action = toGhlPendingAction(mockRow);

    expect(action.id).toBe("action-1");
    expect(action.actionType).toBe("update_contact_fields");
    expect(action.status).toBe("pending");
    expect(action.proposedChanges).toEqual({ phone: "555-1234" });
  });
});

describe("GHL Error Codes for Actions", () => {
  it("action-related error codes exist", () => {
    const code1: GhlErrorCode = "BAXTER_GHL_STALE_STATE";
    const code2: GhlErrorCode = "BAXTER_GHL_ACTION_EXPIRED";
    const code3: GhlErrorCode = "BAXTER_GHL_WRITE_DISABLED";

    const msg1 = userFacingGhlError(code1);
    const msg2 = userFacingGhlError(code2);
    const msg3 = userFacingGhlError(code3);

    expect(msg1).toContain("modified");
    expect(msg2).toContain("expired");
    expect(msg3).toContain("disabled");
  });
});
