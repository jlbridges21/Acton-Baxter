import "server-only";

import type { ConnectorHealth } from "../types";
import { getGhlRuntimeConfig, isGhlConfigured, getGhlAuthMode } from "./config";
import { resolveGhlCredentialProvider } from "./auth";
import { ghlGet, ghlPost } from "./client";
import {
  ghlContactsSearchResponseSchema,
  ghlPipelinesResponseSchema,
  ghlOpportunitiesSearchResponseSchema,
} from "./types";
import { GhlConnectorError, isScopeError } from "./errors";
import { getActiveGhlConnection } from "./connections";
import type { GhlCapabilityMatrix } from "./capabilities";
import { probeGhlCapabilities } from "./capabilities";

export type GhlHealthCheckResult = {
  check: string;
  ok: boolean;
  code: string | null;
  message: string;
  optional?: boolean;
  isScopeIssue?: boolean;
};

export type GhlHealthStatus = {
  overall:
    "healthy" | "warning" | "offline" | "not_configured" | "connected_limited" | "needs_attention";
  checks: GhlHealthCheckResult[];
  locationId: string | null;
  authMode: string;
  details: string | null;
  capabilityMatrix?: GhlCapabilityMatrix;
};

async function checkAuth(): Promise<GhlHealthCheckResult> {
  try {
    const provider = await resolveGhlCredentialProvider();
    const health = await provider.health();

    // Check if this is a scope issue (not a true auth failure)
    const scopeIssue =
      health.code === "BAXTER_GHL_SCOPE_MISSING" ||
      health.code === "BAXTER_GHL_LOCATION_ACCESS_DENIED" ||
      health.code === "BAXTER_GHL_PERMISSION_DENIED";

    return {
      check: "authentication",
      ok: health.ok,
      code: health.code,
      message: health.message,
      isScopeIssue: scopeIssue,
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_AUTH_FAILED";
    const scopeIssue = isScopeError(error);
    return {
      check: "authentication",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Authentication check failed",
      isScopeIssue: scopeIssue,
    };
  }
}

/**
 * Check location access. For PIT mode, this is OPTIONAL.
 * Many PITs don't have locations.readonly scope but can still access contacts/opportunities.
 */
async function checkLocation(): Promise<GhlHealthCheckResult> {
  const config = getGhlRuntimeConfig();
  const authMode = getGhlAuthMode();

  if (!config.locationId) {
    return {
      check: "location",
      ok: false,
      code: "BAXTER_GHL_LOCATION_INVALID",
      message: "GHL_LOCATION_ID is not configured.",
    };
  }

  try {
    await ghlGet(`/locations/${config.locationId}`, undefined, { injectLocationId: false });
    return {
      check: "location",
      ok: true,
      code: null,
      message: `Location ${config.locationId} is accessible.`,
      optional: authMode === "private_integration",
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_LOCATION_INVALID";
    const scopeIssue = isScopeError(error) || code === "BAXTER_GHL_LOCATION_ACCESS_DENIED";

    // For PIT mode, location check failure due to scope is a warning, not an error
    if (authMode === "private_integration" && scopeIssue) {
      return {
        check: "location",
        ok: false,
        code,
        message:
          "Location endpoint unavailable (locations.readonly scope not granted). This is optional for PIT mode.",
        optional: true,
        isScopeIssue: true,
      };
    }

    return {
      check: "location",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Location check failed",
      isScopeIssue: scopeIssue,
    };
  }
}

async function checkContacts(): Promise<GhlHealthCheckResult> {
  try {
    // Use POST /contacts/search which is more reliable than GET /contacts/
    const response = await ghlPost("/contacts/search", { pageLimit: 1 });
    ghlContactsSearchResponseSchema.parse(response);
    return {
      check: "contacts",
      ok: true,
      code: null,
      message: "Contacts API is accessible.",
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_API_UNAVAILABLE";
    const scopeIssue = isScopeError(error);
    return {
      check: "contacts",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Contacts check failed",
      isScopeIssue: scopeIssue,
    };
  }
}

async function checkPipelines(): Promise<GhlHealthCheckResult> {
  try {
    const response = await ghlGet("/opportunities/pipelines");
    ghlPipelinesResponseSchema.parse(response);
    return {
      check: "pipelines",
      ok: true,
      code: null,
      message: "Pipelines API is accessible.",
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_API_UNAVAILABLE";
    const scopeIssue = isScopeError(error);
    return {
      check: "pipelines",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Pipelines check failed",
      isScopeIssue: scopeIssue,
    };
  }
}

async function checkOpportunities(): Promise<GhlHealthCheckResult> {
  try {
    const response = await ghlGet("/opportunities/search", { limit: 1 });
    ghlOpportunitiesSearchResponseSchema.parse(response);
    return {
      check: "opportunities",
      ok: true,
      code: null,
      message: "Opportunities API is accessible.",
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_API_UNAVAILABLE";
    const scopeIssue = isScopeError(error);
    return {
      check: "opportunities",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Opportunities check failed",
      isScopeIssue: scopeIssue,
    };
  }
}

async function checkCalendars(): Promise<GhlHealthCheckResult> {
  try {
    await ghlGet("/calendars/");
    return {
      check: "calendars",
      ok: true,
      code: null,
      message: "Calendars API is accessible.",
      optional: true,
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_SCOPE_MISSING";
    const scopeIssue = isScopeError(error);
    return {
      check: "calendars",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Calendars check failed",
      optional: true,
      isScopeIssue: scopeIssue,
    };
  }
}

async function checkConversations(): Promise<GhlHealthCheckResult> {
  try {
    await ghlGet("/conversations/search", { limit: 1 });
    return {
      check: "conversations",
      ok: true,
      code: null,
      message: "Conversations API is accessible.",
      optional: true,
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_SCOPE_MISSING";
    const scopeIssue = isScopeError(error);
    return {
      check: "conversations",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Conversations check failed",
      optional: true,
      isScopeIssue: scopeIssue,
    };
  }
}

/**
 * Evaluate GHL health with staged core vs optional checks.
 *
 * For PIT mode:
 * - Location check failure due to missing locations.readonly is a WARNING, not an error
 * - Core CRM (contacts, pipelines, opportunities) determines Connected vs Offline
 * - Optional failures result in "Connected with limited capabilities"
 *
 * Overall status mapping:
 * - "connected" (healthy): all core available, most optional available
 * - "connected_limited" (warning): core available, some optional missing
 * - "needs_attention" (warning): core missing due to scope issues (fixable)
 * - "offline": core missing due to auth/API failure (not just scope)
 * - "not_configured": disabled or missing configuration
 */
export async function evaluateGhlHealth(): Promise<GhlHealthStatus> {
  const config = getGhlRuntimeConfig();
  const authMode = getGhlAuthMode();

  if (!config.enabled) {
    return {
      overall: "not_configured",
      checks: [],
      locationId: config.locationId,
      authMode: config.authMode,
      details: "ENABLE_GHL_INTEGRATION is false.",
    };
  }

  if (!isGhlConfigured()) {
    return {
      overall: "not_configured",
      checks: [],
      locationId: config.locationId,
      authMode: config.authMode,
      details:
        config.authMode === "private_integration"
          ? "GHL_PRIVATE_INTEGRATION_TOKEN or GHL_LOCATION_ID is missing."
          : "GHL OAuth configuration is incomplete.",
    };
  }

  // Stage 1: Check auth (uses contacts search for PIT)
  const authCheck = await checkAuth();

  // If auth completely fails (not a scope issue), we're offline
  if (!authCheck.ok && !authCheck.isScopeIssue) {
    return {
      overall: "offline",
      checks: [authCheck],
      locationId: config.locationId,
      authMode: config.authMode,
      details: authCheck.message,
    };
  }

  // Stage 2: Check core CRM capabilities (contacts, pipelines, opportunities)
  const [contactsCheck, pipelinesCheck, opportunitiesCheck] = await Promise.all([
    checkContacts(),
    checkPipelines(),
    checkOpportunities(),
  ]);

  const coreChecks = [contactsCheck, pipelinesCheck, opportunitiesCheck];
  const coreOk = coreChecks.every((c) => c.ok);
  const coreScopeIssues = coreChecks.filter((c) => !c.ok && c.isScopeIssue);
  const coreHardFailures = coreChecks.filter((c) => !c.ok && !c.isScopeIssue);

  // Stage 3: Check optional capabilities (location is optional for PIT)
  const [locationCheck, calendarsCheck, conversationsCheck] = await Promise.all([
    checkLocation(),
    checkCalendars(),
    checkConversations(),
  ]);

  // For PIT mode, location check is optional
  const effectiveLocationCheck =
    authMode === "private_integration" ? { ...locationCheck, optional: true } : locationCheck;

  const optionalChecks = [effectiveLocationCheck, calendarsCheck, conversationsCheck];
  const optionalWarnings = optionalChecks.filter((c) => !c.ok);

  // Determine overall status
  let overall: GhlHealthStatus["overall"];
  let details: string | null = null;

  if (!coreOk) {
    if (coreHardFailures.length > 0) {
      // Hard failure (API error, not scope)
      overall = "offline";
      details = coreHardFailures[0]?.message ?? "Core API check failed.";
    } else if (coreScopeIssues.length > 0) {
      // Scope issue - fixable by updating PIT permissions
      overall = "needs_attention";
      details =
        `Missing scopes for core CRM: ${coreScopeIssues.map((c) => c.check).join(", ")}. ` +
        "Edit your Private Integration in GHL to add the required scopes.";
    } else {
      overall = "offline";
      details = "Core CRM check failed.";
    }
  } else if (optionalWarnings.length > 0) {
    // Core works, but optional features missing
    const scopeWarnings = optionalWarnings.filter((c) => c.isScopeIssue);
    if (scopeWarnings.length > 0) {
      overall = "connected_limited";
      details = `Connected with limited capabilities. Missing scopes: ${optionalWarnings.map((c) => c.check).join(", ")}.`;
    } else {
      overall = "warning";
      details = `Optional resources unavailable: ${optionalWarnings.map((c) => c.check).join(", ")}`;
    }
  } else {
    overall = "healthy";
  }

  const allChecks = [authCheck, ...coreChecks, ...optionalChecks];

  return {
    overall,
    checks: allChecks,
    locationId: config.locationId,
    authMode: config.authMode,
    details,
  };
}

/**
 * Full capability probe with matrix. More detailed than evaluateGhlHealth.
 * Use for admin diagnostics and refresh permissions action.
 */
export async function evaluateGhlHealthWithCapabilities(): Promise<GhlHealthStatus> {
  const basicHealth = await evaluateGhlHealth();

  // Only probe capabilities if we have some connection
  if (basicHealth.overall === "not_configured" || basicHealth.overall === "offline") {
    return basicHealth;
  }

  const capabilityMatrix = await probeGhlCapabilities();

  // Map capability status to health status
  let overall: GhlHealthStatus["overall"];
  switch (capabilityMatrix.overallStatus) {
    case "connected":
      overall = "healthy";
      break;
    case "connected_limited":
      overall = "connected_limited";
      break;
    case "needs_attention":
      overall = "needs_attention";
      break;
    case "offline":
      overall = "offline";
      break;
    case "not_configured":
      overall = "not_configured";
      break;
    default:
      overall = basicHealth.overall;
  }

  return {
    ...basicHealth,
    overall,
    capabilityMatrix,
  };
}

export async function GhlConnectorHealth(): Promise<ConnectorHealth> {
  try {
    const health = await evaluateGhlHealth();

    // Avoid DB lookups when GHL is disabled/unconfigured (keeps connector list fast in tests).
    if (health.overall !== "not_configured") {
      await getActiveGhlConnection().catch(() => null);
    }

    // Map new status types to ConnectorHealth status
    let status: ConnectorHealth["status"];
    let label: string;

    switch (health.overall) {
      case "healthy":
        status = "healthy";
        label = "Connected";
        break;
      case "connected_limited":
        status = "warning";
        label = "Connected (Limited)";
        break;
      case "needs_attention":
        status = "warning";
        label = "Needs Attention";
        break;
      case "warning":
        status = "warning";
        label = "Needs Attention";
        break;
      case "offline":
        status = "offline";
        label = "Offline";
        break;
      case "not_configured":
      default:
        status = "offline";
        label = "Not Configured";
        break;
    }

    return {
      key: "gohighlevel",
      name: "GoHighLevel",
      status,
      label,
      lastSyncAt: null,
      lastError: health.details,
      itemsSynced: null,
      details:
        health.overall === "not_configured"
          ? "Acton's CRM, contacts, opportunities, calendars, conversations, and sales pipeline."
          : health.details,
    };
  } catch {
    return {
      key: "gohighlevel",
      name: "GoHighLevel",
      status: "offline",
      label: "Offline",
      lastSyncAt: null,
      lastError: "Health check failed.",
      itemsSynced: null,
      details:
        "Acton's CRM, contacts, opportunities, calendars, conversations, and sales pipeline.",
    };
  }
}
