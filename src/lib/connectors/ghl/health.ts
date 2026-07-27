import "server-only";

import type { ConnectorHealth } from "../types";
import { getGhlRuntimeConfig, isGhlConfigured } from "./config";
import { resolveGhlCredentialProvider } from "./auth";
import { ghlGet } from "./client";
import {
  ghlContactsSearchResponseSchema,
  ghlPipelinesResponseSchema,
  ghlOpportunitiesSearchResponseSchema,
} from "./types";
import { GhlConnectorError } from "./errors";
import { getActiveGhlConnection } from "./connections";

export type GhlHealthCheckResult = {
  check: string;
  ok: boolean;
  code: string | null;
  message: string;
  optional?: boolean;
};

export type GhlHealthStatus = {
  overall: "healthy" | "warning" | "offline" | "not_configured";
  checks: GhlHealthCheckResult[];
  locationId: string | null;
  authMode: string;
  details: string | null;
};

async function checkAuth(): Promise<GhlHealthCheckResult> {
  try {
    const provider = await resolveGhlCredentialProvider();
    const health = await provider.health();
    return {
      check: "authentication",
      ok: health.ok,
      code: health.code,
      message: health.message,
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_AUTH_FAILED";
    return {
      check: "authentication",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Authentication check failed",
    };
  }
}

async function checkLocation(): Promise<GhlHealthCheckResult> {
  const config = getGhlRuntimeConfig();
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
    };
  } catch (error) {
    const code = error instanceof GhlConnectorError ? error.code : "BAXTER_GHL_LOCATION_INVALID";
    return {
      check: "location",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Location check failed",
    };
  }
}

async function checkContacts(): Promise<GhlHealthCheckResult> {
  try {
    const response = await ghlGet("/contacts/", { limit: 1 });
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
    return {
      check: "pipelines",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Pipelines check failed",
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
    return {
      check: "opportunities",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Opportunities check failed",
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
    return {
      check: "calendars",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Calendars check failed",
      optional: true,
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
    return {
      check: "conversations",
      ok: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Conversations check failed",
      optional: true,
    };
  }
}

export async function evaluateGhlHealth(): Promise<GhlHealthStatus> {
  const config = getGhlRuntimeConfig();

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

  const [authCheck, locationCheck] = await Promise.all([checkAuth(), checkLocation()]);

  if (!authCheck.ok || !locationCheck.ok) {
    return {
      overall: "offline",
      checks: [authCheck, locationCheck],
      locationId: config.locationId,
      authMode: config.authMode,
      details: authCheck.message || locationCheck.message,
    };
  }

  const [contactsCheck, pipelinesCheck, opportunitiesCheck, calendarsCheck, conversationsCheck] =
    await Promise.all([
      checkContacts(),
      checkPipelines(),
      checkOpportunities(),
      checkCalendars(),
      checkConversations(),
    ]);

  const requiredChecks = [
    authCheck,
    locationCheck,
    contactsCheck,
    pipelinesCheck,
    opportunitiesCheck,
  ];
  const optionalChecks = [calendarsCheck, conversationsCheck];

  const requiredOk = requiredChecks.every((c) => c.ok);
  const optionalWarnings = optionalChecks.filter((c) => !c.ok);

  let overall: "healthy" | "warning" | "offline";
  let details: string | null = null;

  if (!requiredOk) {
    overall = "offline";
    const failed = requiredChecks.find((c) => !c.ok);
    details = failed?.message ?? "Required API check failed.";
  } else if (optionalWarnings.length > 0) {
    overall = "warning";
    details = `Optional resources unavailable: ${optionalWarnings.map((c) => c.check).join(", ")}`;
  } else {
    overall = "healthy";
  }

  return {
    overall,
    checks: [...requiredChecks, ...optionalChecks],
    locationId: config.locationId,
    authMode: config.authMode,
    details,
  };
}

export async function GhlConnectorHealth(): Promise<ConnectorHealth> {
  try {
    const health = await evaluateGhlHealth();

    // Avoid DB lookups when GHL is disabled/unconfigured (keeps connector list fast in tests).
    if (health.overall !== "not_configured") {
      await getActiveGhlConnection().catch(() => null);
    }

    return {
      key: "gohighlevel",
      name: "GoHighLevel",
      status:
        health.overall === "not_configured"
          ? "offline"
          : health.overall === "healthy"
            ? "healthy"
            : health.overall === "warning"
              ? "warning"
              : "offline",
      label:
        health.overall === "not_configured"
          ? "Not Configured"
          : health.overall === "healthy"
            ? "Connected"
            : health.overall === "warning"
              ? "Needs Attention"
              : "Offline",
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
