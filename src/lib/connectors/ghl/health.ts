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
import { GhlConnectorError, isScopeError, isContractError } from "./errors";
import { getActiveGhlConnection } from "./connections";
import type { GhlCapabilityMatrix } from "./capabilities";
import { probeGhlCapabilities } from "./capabilities";
import { buildOpportunitySearchQuery } from "./request-contracts";
import { requireGhlLocationId } from "./config";

export type GhlHealthCheckResult = {
  check: string;
  ok: boolean;
  code: string | null;
  message: string;
  optional?: boolean;
  isScopeIssue?: boolean;
  isContractIssue?: boolean;
};

/**
 * Canonical health states (Prompt 3).
 * "healthy" retained as alias of connected for ConnectorHealth mapping.
 */
export type GhlHealthOverall =
  | "disabled"
  | "not_configured"
  | "connected"
  | "connected_limited"
  | "warning"
  | "reauthorization_required"
  | "offline"
  /** @deprecated use connected */
  | "healthy"
  /** @deprecated use warning */
  | "needs_attention";

export type GhlHealthStatus = {
  overall: GhlHealthOverall;
  checks: GhlHealthCheckResult[];
  locationId: string | null;
  authMode: string;
  details: string | null;
  capabilityMatrix?: GhlCapabilityMatrix;
  lastVerifiedAt?: string;
};

async function checkAuth(): Promise<GhlHealthCheckResult> {
  try {
    const provider = await resolveGhlCredentialProvider();
    const health = await provider.health();

    const scopeIssue =
      health.code === "BAXTER_GHL_SCOPE_MISSING" ||
      health.code === "BAXTER_GHL_LOCATION_ACCESS_DENIED" ||
      health.code === "BAXTER_GHL_PERMISSION_DENIED";

    const reauth =
      health.code === "BAXTER_GHL_AUTH_FAILED" ||
      health.code === "BAXTER_GHL_TOKEN_EXPIRED" ||
      health.code === "BAXTER_GHL_REAUTH_REQUIRED";

    return {
      check: "authentication",
      ok: health.ok,
      code: health.code,
      message: health.message,
      isScopeIssue: scopeIssue,
      isContractIssue: health.code === "BAXTER_GHL_CONTRACT_ERROR",
      ...(reauth && !health.ok ? {} : {}),
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_AUTH_FAILED";
    return {
      check: "authentication",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Authentication check failed",
      isScopeIssue: isScopeError(error),
      isContractIssue: isContractError(error),
    };
  }
}

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
    await ghlGet(`/locations/${config.locationId}`, undefined, {
      resource: "locations",
      injectLocationId: false,
    });
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

    if (authMode === "private_integration" && (scopeIssue || isContractError(error))) {
      return {
        check: "location",
        ok: false,
        code,
        message:
          "Location endpoint unavailable (optional for PIT). Core CRM can still work without locations.readonly.",
        optional: true,
        isScopeIssue: scopeIssue,
        isContractIssue: isContractError(error),
      };
    }

    return {
      check: "location",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Location check failed",
      isScopeIssue: scopeIssue,
      isContractIssue: isContractError(error),
    };
  }
}

async function checkContacts(): Promise<GhlHealthCheckResult> {
  try {
    const response = await ghlPost("/contacts/search", { pageLimit: 1 }, { resource: "contacts" });
    ghlContactsSearchResponseSchema.parse(response);
    return {
      check: "contacts",
      ok: true,
      code: null,
      message: "Contacts API is accessible.",
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_API_UNAVAILABLE";
    return {
      check: "contacts",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Contacts check failed",
      isScopeIssue: isScopeError(error),
      isContractIssue: isContractError(error),
    };
  }
}

async function checkPipelines(): Promise<GhlHealthCheckResult> {
  try {
    const response = await ghlGet("/opportunities/pipelines", undefined, {
      resource: "pipelines",
    });
    ghlPipelinesResponseSchema.parse(response);
    return {
      check: "pipelines",
      ok: true,
      code: null,
      message: "Pipelines API is accessible.",
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_API_UNAVAILABLE";
    return {
      check: "pipelines",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Pipelines check failed",
      isScopeIssue: isScopeError(error),
      isContractIssue: isContractError(error),
    };
  }
}

async function checkOpportunities(): Promise<GhlHealthCheckResult> {
  try {
    const locationId = requireGhlLocationId();
    const query = buildOpportunitySearchQuery({ locationId, limit: 1 });
    const response = await ghlGet("/opportunities/search", query, {
      resource: "opportunities",
      injectLocationId: false,
    });
    ghlOpportunitiesSearchResponseSchema.parse(response);
    return {
      check: "opportunities",
      ok: true,
      code: null,
      message: "Opportunities API is accessible (v3 locationId).",
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_API_UNAVAILABLE";
    return {
      check: "opportunities",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Opportunities check failed",
      isScopeIssue: isScopeError(error),
      isContractIssue: isContractError(error),
    };
  }
}

async function checkCalendars(): Promise<GhlHealthCheckResult> {
  try {
    await ghlGet("/calendars/", undefined, { resource: "calendars" });
    return {
      check: "calendars",
      ok: true,
      code: null,
      message: "Calendars API is accessible.",
      optional: true,
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_SCOPE_MISSING";
    return {
      check: "calendars",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Calendars check failed",
      optional: true,
      isScopeIssue: isScopeError(error),
      isContractIssue: isContractError(error),
    };
  }
}

async function checkConversations(): Promise<GhlHealthCheckResult> {
  try {
    await ghlGet("/conversations/search", { limit: 1 }, { resource: "conversations" });
    return {
      check: "conversations",
      ok: true,
      code: null,
      message: "Conversations API is accessible.",
      optional: true,
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_SCOPE_MISSING";
    return {
      check: "conversations",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Conversations check failed",
      optional: true,
      isScopeIssue: isScopeError(error),
      isContractIssue: isContractError(error),
    };
  }
}

function isReauthCode(code: string | null): boolean {
  return (
    code === "BAXTER_GHL_AUTH_FAILED" ||
    code === "BAXTER_GHL_TOKEN_EXPIRED" ||
    code === "BAXTER_GHL_REAUTH_REQUIRED"
  );
}

/**
 * Evaluate GHL health with staged core vs optional checks.
 *
 * Core: contacts, pipelines, opportunities (correct v3 contracts).
 * 422/contract errors → warning (not offline).
 * Scope missing → connected_limited / warning.
 * Invalid token → reauthorization_required / offline.
 */
export async function evaluateGhlHealth(): Promise<GhlHealthStatus> {
  const config = getGhlRuntimeConfig();
  const authMode = getGhlAuthMode();
  const lastVerifiedAt = new Date().toISOString();

  if (!config.enabled) {
    return {
      overall: "disabled",
      checks: [],
      locationId: config.locationId,
      authMode: config.authMode,
      details: "ENABLE_GHL_INTEGRATION is false.",
      lastVerifiedAt,
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
      lastVerifiedAt,
    };
  }

  const authCheck = await checkAuth();

  if (!authCheck.ok && isReauthCode(authCheck.code)) {
    return {
      overall: "reauthorization_required",
      checks: [authCheck],
      locationId: config.locationId,
      authMode: config.authMode,
      details: authCheck.message,
      lastVerifiedAt,
    };
  }

  if (!authCheck.ok && !authCheck.isScopeIssue && !authCheck.isContractIssue) {
    return {
      overall: "offline",
      checks: [authCheck],
      locationId: config.locationId,
      authMode: config.authMode,
      details: authCheck.message,
      lastVerifiedAt,
    };
  }

  const [contactsCheck, pipelinesCheck, opportunitiesCheck] = await Promise.all([
    checkContacts(),
    checkPipelines(),
    checkOpportunities(),
  ]);

  const coreChecks = [contactsCheck, pipelinesCheck, opportunitiesCheck];
  const coreOk = coreChecks.every((c) => c.ok);
  const coreScopeIssues = coreChecks.filter((c) => !c.ok && c.isScopeIssue);
  const coreContractIssues = coreChecks.filter((c) => !c.ok && c.isContractIssue);
  const coreHardFailures = coreChecks.filter((c) => !c.ok && !c.isScopeIssue && !c.isContractIssue);

  const [locationCheck, calendarsCheck, conversationsCheck] = await Promise.all([
    checkLocation(),
    checkCalendars(),
    checkConversations(),
  ]);

  const effectiveLocationCheck =
    authMode === "private_integration" ? { ...locationCheck, optional: true } : locationCheck;

  const optionalChecks = [effectiveLocationCheck, calendarsCheck, conversationsCheck];
  const optionalWarnings = optionalChecks.filter((c) => !c.ok);

  let overall: GhlHealthOverall;
  let details: string | null = null;

  if (!coreOk) {
    if (
      coreContractIssues.length > 0 &&
      coreHardFailures.length === 0 &&
      coreScopeIssues.length === 0
    ) {
      // Malformed Baxter request — connector may still be usable for other resources
      const someCoreOk = coreChecks.some((c) => c.ok);
      overall = someCoreOk ? "warning" : "warning";
      details =
        `Integration request error (422/contract) on: ${coreContractIssues.map((c) => c.check).join(", ")}. ` +
        "This is not an offline HighLevel outage — check API Version and locationId parameters.";
    } else if (coreHardFailures.length > 0 && coreHardFailures.every((c) => isReauthCode(c.code))) {
      overall = "reauthorization_required";
      details = coreHardFailures[0]?.message ?? "Token invalid or revoked.";
    } else if (coreHardFailures.length > 0 && coreChecks.every((c) => !c.ok)) {
      overall = "offline";
      details = coreHardFailures[0]?.message ?? "All core CRM checks failed.";
    } else if (coreScopeIssues.length > 0 && coreHardFailures.length === 0) {
      overall = "connected_limited";
      details =
        `Missing scopes for: ${coreScopeIssues.map((c) => c.check).join(", ")}. ` +
        "Edit Private Integration permissions in HighLevel (token rotate usually not required).";
    } else if (coreChecks.some((c) => c.ok)) {
      overall = "warning";
      details = `Partial core CRM failure: ${coreChecks
        .filter((c) => !c.ok)
        .map((c) => c.check)
        .join(", ")}`;
    } else {
      overall = "offline";
      details = "Core CRM check failed.";
    }
  } else if (optionalWarnings.length > 0) {
    const scopeWarnings = optionalWarnings.filter((c) => c.isScopeIssue);
    const contractWarnings = optionalWarnings.filter((c) => c.isContractIssue);
    if (scopeWarnings.length > 0) {
      overall = "connected_limited";
      details = `Connected with limited capabilities. Optional missing: ${optionalWarnings.map((c) => c.check).join(", ")}.`;
    } else if (contractWarnings.length > 0) {
      overall = "warning";
      details = `Optional resource contract issues: ${contractWarnings.map((c) => c.check).join(", ")}`;
    } else {
      overall = "connected_limited";
      details = `Optional resources unavailable: ${optionalWarnings.map((c) => c.check).join(", ")}`;
    }
  } else {
    overall = "connected";
  }

  return {
    overall,
    checks: [authCheck, ...coreChecks, ...optionalChecks],
    locationId: config.locationId,
    authMode: config.authMode,
    details,
    lastVerifiedAt,
  };
}

export async function evaluateGhlHealthWithCapabilities(): Promise<GhlHealthStatus> {
  const basicHealth = await evaluateGhlHealth();

  if (
    basicHealth.overall === "not_configured" ||
    basicHealth.overall === "disabled" ||
    basicHealth.overall === "offline" ||
    basicHealth.overall === "reauthorization_required"
  ) {
    return basicHealth;
  }

  const capabilityMatrix = await probeGhlCapabilities();

  let overall: GhlHealthOverall = basicHealth.overall;
  switch (capabilityMatrix.overallStatus) {
    case "connected":
      overall = basicHealth.overall === "warning" ? "warning" : "connected";
      break;
    case "connected_limited":
      overall = "connected_limited";
      break;
    case "needs_attention":
      overall = "warning";
      break;
    case "offline":
      // Capability probe offline should not override a working core health unless all core failed
      if (basicHealth.overall === "connected" || basicHealth.overall === "connected_limited") {
        overall = basicHealth.overall;
      } else {
        overall = "offline";
      }
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

    if (health.overall !== "not_configured" && health.overall !== "disabled") {
      await getActiveGhlConnection().catch(() => null);
    }

    let status: ConnectorHealth["status"];
    let label: string;

    switch (health.overall) {
      case "connected":
      case "healthy":
        status = "healthy";
        label = "Connected";
        break;
      case "connected_limited":
        status = "warning";
        label = "Connected (Limited)";
        break;
      case "warning":
      case "needs_attention":
        status = "warning";
        label = "Needs Attention";
        break;
      case "reauthorization_required":
        status = "offline";
        label = "Reauthorization Required";
        break;
      case "offline":
        status = "offline";
        label = "Offline";
        break;
      case "disabled":
      case "not_configured":
      default:
        status = "offline";
        label = health.overall === "disabled" ? "Disabled" : "Not Configured";
        break;
    }

    return {
      key: "gohighlevel",
      name: "GoHighLevel",
      label,
      status,
      details: health.details,
      lastSyncAt: health.lastVerifiedAt ?? null,
      lastError:
        health.overall === "offline" || health.overall === "reauthorization_required"
          ? health.details
          : null,
      itemsSynced: null,
    };
  } catch (error) {
    return {
      key: "gohighlevel",
      name: "GoHighLevel",
      label: "Error",
      status: "offline",
      details: error instanceof Error ? error.message.slice(0, 200) : "Health check failed",
      lastSyncAt: null,
      lastError: error instanceof Error ? error.message.slice(0, 200) : "Health check failed",
      itemsSynced: null,
    };
  }
}
