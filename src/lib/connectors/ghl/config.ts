import "server-only";

import { GHL_API_BASE_URL, type GhlAuthMode } from "./types";
import { getExpectedScopesFromEnv } from "./scopes";

export type GhlRuntimeConfig = {
  enabled: boolean;
  authMode: GhlAuthMode;
  privateIntegrationToken: string | null;
  locationId: string | null;
  apiBaseUrl: string;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthRedirectUri: string | null;
  tokenEncryptionKey: string | null;
  expectedScopes: string[];
};

let cachedConfig: GhlRuntimeConfig | null = null;

function defaultRedirectUri(): string {
  const base =
    (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") ||
    "https://acton-baxter.vercel.app";
  return `${base}/api/admin/connectors/ghl/oauth/callback`;
}

export function getGhlRuntimeConfig(): GhlRuntimeConfig {
  if (cachedConfig) return cachedConfig;

  const enabled =
    (process.env.ENABLE_GHL_INTEGRATION ?? "").toLowerCase() === "true" ||
    process.env.ENABLE_GHL_INTEGRATION === "1";

  const authModeRaw = (process.env.GHL_AUTH_MODE ?? "private_integration").trim().toLowerCase();
  const authMode: GhlAuthMode = authModeRaw === "oauth" ? "oauth" : "private_integration";

  const privateIntegrationToken = (process.env.GHL_PRIVATE_INTEGRATION_TOKEN ?? "").trim() || null;

  const locationId = (process.env.GHL_LOCATION_ID ?? "").trim() || null;

  const apiBaseUrl = (process.env.GHL_API_BASE_URL ?? "").trim() || GHL_API_BASE_URL;

  const oauthClientId = (process.env.GHL_CLIENT_ID ?? "").trim() || null;
  const oauthClientSecret = (process.env.GHL_CLIENT_SECRET ?? "").trim() || null;
  const oauthRedirectUri = (process.env.GHL_REDIRECT_URI ?? "").trim() || defaultRedirectUri();

  const tokenEncryptionKey =
    (process.env.GHL_TOKEN_ENCRYPTION_KEY ?? "").trim() ||
    (process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? "").trim() ||
    null;

  const expectedScopes = getExpectedScopesFromEnv();

  cachedConfig = {
    enabled,
    authMode,
    privateIntegrationToken,
    locationId,
    apiBaseUrl,
    oauthClientId,
    oauthClientSecret,
    oauthRedirectUri,
    tokenEncryptionKey,
    expectedScopes,
  };

  return cachedConfig;
}

export function isGhlEnabled(): boolean {
  return getGhlRuntimeConfig().enabled;
}

export function isGhlConfigured(): boolean {
  const config = getGhlRuntimeConfig();
  if (!config.enabled) return false;
  if (!config.locationId) return false;

  if (config.authMode === "private_integration") {
    return Boolean(config.privateIntegrationToken);
  }

  return Boolean(config.oauthClientId && config.oauthClientSecret && config.tokenEncryptionKey);
}

export function isGhlOAuthConfigured(): boolean {
  const config = getGhlRuntimeConfig();
  return Boolean(
    config.oauthClientId &&
    config.oauthClientSecret &&
    config.oauthRedirectUri &&
    config.tokenEncryptionKey,
  );
}

export function getGhlAuthMode(): GhlAuthMode {
  return getGhlRuntimeConfig().authMode;
}

export function getGhlLocationId(): string | null {
  return getGhlRuntimeConfig().locationId;
}

export function requireGhlLocationId(): string {
  const locationId = getGhlLocationId();
  if (!locationId) {
    throw new Error("GHL_LOCATION_ID is required but not configured");
  }
  return locationId;
}

export function getGhlConfigStatus(): {
  enabled: boolean;
  configured: boolean;
  authMode: GhlAuthMode;
  locationIdPresent: boolean;
  privateTokenPresent: boolean;
  oauthConfigured: boolean;
  encryptionKeyPresent: boolean;
} {
  const config = getGhlRuntimeConfig();
  return {
    enabled: config.enabled,
    configured: isGhlConfigured(),
    authMode: config.authMode,
    locationIdPresent: Boolean(config.locationId),
    privateTokenPresent: Boolean(config.privateIntegrationToken),
    oauthConfigured: isGhlOAuthConfigured(),
    encryptionKeyPresent: Boolean(config.tokenEncryptionKey),
  };
}

export function resetGhlConfigCacheForTests(): void {
  cachedConfig = null;
}
