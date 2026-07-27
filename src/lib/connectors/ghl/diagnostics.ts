import "server-only";

import { getGhlRuntimeConfig, getGhlConfigStatus } from "./config";
import { getGhlConnectionSnapshot, resolveGhlCredentialProvider } from "./auth";
import { getActiveGhlConnectionPublic, listGhlConnections } from "./connections";
import { evaluateGhlHealth, type GhlHealthStatus } from "./health";
import { getCacheStatus } from "./cache";
import { getMissingRequiredScopes, getMissingOptionalScopes } from "./scopes";
import { getRecentGhlRequestDiagnostics } from "./request-diagnostics";

export type GhlAdminOverview = {
  config: ReturnType<typeof getGhlConfigStatus>;
  health: GhlHealthStatus;
  connection: Awaited<ReturnType<typeof getActiveGhlConnectionPublic>>;
  authenticated: boolean;
  authCode: string | null;
  authMode: string;
  locationId: string | null;
  missingRequiredScopes: string[];
  missingOptionalScopes: string[];
  cacheStatus: Awaited<ReturnType<typeof getCacheStatus>>;
  guidance: string[];
  recentRequests: ReturnType<typeof getRecentGhlRequestDiagnostics>;
};

export async function getGhlAdminOverview(): Promise<GhlAdminOverview> {
  const config = getGhlConfigStatus();
  const runtimeConfig = getGhlRuntimeConfig();
  const connection = await getActiveGhlConnectionPublic().catch(() => null);

  // Best-effort warm of reference data so UI hydration has names without a manual click.
  if (runtimeConfig.enabled && runtimeConfig.locationId) {
    const { getGhlReferenceData } = await import("./reference-data");
    await getGhlReferenceData().catch(() => null);
  }

  let health: GhlHealthStatus;
  let authenticated = false;
  let authCode: string | null = null;

  try {
    health = await evaluateGhlHealth();
    if (
      health.overall === "healthy" ||
      health.overall === "warning" ||
      health.overall === "connected" ||
      health.overall === "connected_limited"
    ) {
      authenticated = true;
    }
  } catch (error) {
    health = {
      overall: "offline",
      checks: [],
      locationId: runtimeConfig.locationId,
      authMode: runtimeConfig.authMode,
      details: error instanceof Error ? error.message : "Health check failed",
    };
  }

  const authCheck = health.checks.find((c) => c.check === "authentication");
  authCode = authCheck?.code ?? null;

  const grantedScopes = connection?.granted_scopes ?? [];
  const missingRequiredScopes = getMissingRequiredScopes(grantedScopes);
  const missingOptionalScopes = getMissingOptionalScopes(grantedScopes);

  const cacheStatus = runtimeConfig.locationId
    ? await getCacheStatus(runtimeConfig.locationId)
    : [];

  const guidance = buildGuidance(config, health, connection, missingRequiredScopes);

  return {
    config,
    health,
    connection,
    authenticated,
    authCode,
    authMode: runtimeConfig.authMode,
    locationId: runtimeConfig.locationId,
    missingRequiredScopes,
    missingOptionalScopes,
    cacheStatus,
    guidance,
    recentRequests: getRecentGhlRequestDiagnostics(15),
  };
}

function buildGuidance(
  config: ReturnType<typeof getGhlConfigStatus>,
  health: GhlHealthStatus,
  connection: Awaited<ReturnType<typeof getActiveGhlConnectionPublic>>,
  missingRequiredScopes: string[],
): string[] {
  const guidance: string[] = [];

  if (!config.enabled) {
    guidance.push("Set ENABLE_GHL_INTEGRATION=true in environment variables.");
    return guidance;
  }

  if (!config.locationIdPresent) {
    guidance.push("Set GHL_LOCATION_ID to the Acton ADU location ID.");
  }

  if (config.authMode === "private_integration") {
    if (!config.privateTokenPresent) {
      guidance.push("Set GHL_PRIVATE_INTEGRATION_TOKEN with a valid Private Integration Token.");
    }
    if (
      health.overall === "offline" &&
      health.checks.some((c) => c.code === "BAXTER_GHL_AUTH_FAILED")
    ) {
      guidance.push("Verify the Private Integration Token is valid and not expired.");
    }
  } else {
    if (!config.oauthConfigured) {
      guidance.push("Set GHL_CLIENT_ID, GHL_CLIENT_SECRET, GHL_REDIRECT_URI.");
    }
    if (!config.encryptionKeyPresent) {
      guidance.push("Set GHL_TOKEN_ENCRYPTION_KEY or GOOGLE_TOKEN_ENCRYPTION_KEY.");
    }
    if (!connection) {
      guidance.push("Click Connect GoHighLevel and authorize the OAuth app.");
    }
    if (connection?.status === "reauthorization_required") {
      guidance.push("GHL OAuth token needs reauthorization. Reconnect in Admin → Connectors.");
    }
  }

  if (missingRequiredScopes.length > 0 && connection) {
    guidance.push(`Missing required scopes: ${missingRequiredScopes.join(", ")}`);
    guidance.push("Reconnect OAuth to request these scopes.");
  }

  if (
    health.overall === "offline" &&
    health.checks.some((c) => c.code === "BAXTER_GHL_LOCATION_INVALID")
  ) {
    guidance.push("The configured GHL_LOCATION_ID may be invalid or the token lacks access.");
  }

  return guidance;
}

export async function testGhlAuthentication() {
  const config = getGhlConfigStatus();

  if (!config.enabled) {
    return {
      pass: false,
      code: "BAXTER_GHL_DISABLED",
      message: "GoHighLevel integration is disabled.",
      authMode: config.authMode,
      guidance: ["Set ENABLE_GHL_INTEGRATION=true in environment."],
    };
  }

  try {
    const provider = await resolveGhlCredentialProvider();
    const health = await provider.health();
    const identity = await provider.getIdentity();

    return {
      pass: health.ok,
      code: health.code,
      message: health.message,
      authMode: provider.mode,
      locationId: identity.locationId,
      locationName: identity.locationName,
      companyId: identity.companyId,
      timezone: identity.timezone,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_GHL_AUTH_FAILED")
        : "BAXTER_GHL_AUTH_FAILED";

    return {
      pass: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 240) : "Authentication failed",
      authMode: config.authMode,
      guidance:
        config.authMode === "private_integration"
          ? [
              "Verify GHL_PRIVATE_INTEGRATION_TOKEN is set correctly.",
              "Ensure the token has not expired.",
              "Check that GHL_LOCATION_ID matches the token's location.",
            ]
          : [
              "Click Connect GoHighLevel in Admin → Connectors.",
              "Ensure GHL_CLIENT_ID and GHL_CLIENT_SECRET are correct.",
              "Verify GHL_REDIRECT_URI matches the OAuth app configuration.",
            ],
    };
  }
}

export async function testGhlLocation() {
  const config = getGhlRuntimeConfig();

  if (!config.locationId) {
    return {
      pass: false,
      code: "BAXTER_GHL_LOCATION_INVALID",
      message: "GHL_LOCATION_ID is not configured.",
      guidance: ["Set GHL_LOCATION_ID to the Acton ADU GoHighLevel location."],
    };
  }

  try {
    const provider = await resolveGhlCredentialProvider();
    const identity = await provider.getIdentity();

    return {
      pass: true,
      code: null,
      locationId: identity.locationId,
      locationName: identity.locationName,
      companyId: identity.companyId,
      timezone: identity.timezone,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_GHL_LOCATION_INVALID")
        : "BAXTER_GHL_LOCATION_INVALID";

    return {
      pass: false,
      code,
      locationId: config.locationId,
      message: error instanceof Error ? error.message.slice(0, 240) : "Location check failed",
      guidance: [
        "Verify the GHL_LOCATION_ID is correct.",
        "Ensure the token has access to this location.",
      ],
    };
  }
}

export async function getGhlConnectionHistory() {
  return listGhlConnections();
}

export { getGhlConnectionSnapshot };
