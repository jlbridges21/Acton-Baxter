import "server-only";

import type {
  GhlAuthMode,
  GhlConnectorIdentity,
  GhlCredentialHealth,
  GhlCredentialProvider,
} from "./types";
import { GHL_API_BASE_URL, ghlLocationResponseSchema } from "./types";
import { GhlAuthError, GhlConfigError } from "./errors";
import {
  getGhlRuntimeConfig,
  getGhlAuthMode,
  isGhlConfigured,
  isGhlOAuthConfigured,
} from "./config";
import {
  getActiveGhlConnection,
  decryptGhlConnectionAccessToken,
  decryptGhlConnectionRefreshToken,
} from "./connections";

export class PrivateIntegrationCredentialProvider implements GhlCredentialProvider {
  readonly mode: GhlAuthMode = "private_integration";

  async getAccessToken(): Promise<string> {
    const config = getGhlRuntimeConfig();
    if (!config.privateIntegrationToken) {
      throw new GhlConfigError(
        "GHL_PRIVATE_INTEGRATION_TOKEN is not configured",
        "BAXTER_GHL_NOT_CONFIGURED",
      );
    }
    return config.privateIntegrationToken;
  }

  async getIdentity(): Promise<GhlConnectorIdentity> {
    const config = getGhlRuntimeConfig();
    if (!config.locationId) {
      throw new GhlConfigError("GHL_LOCATION_ID is not configured", "BAXTER_GHL_LOCATION_INVALID");
    }

    try {
      const token = await this.getAccessToken();
      const url = `${config.apiBaseUrl}/locations/${config.locationId}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "v3",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return {
          mode: this.mode,
          locationId: config.locationId,
          locationName: null,
          companyId: null,
          timezone: null,
        };
      }

      const data = await response.json();
      const parsed = ghlLocationResponseSchema.safeParse(data);

      if (!parsed.success) {
        return {
          mode: this.mode,
          locationId: config.locationId,
          locationName: null,
          companyId: null,
          timezone: null,
        };
      }

      return {
        mode: this.mode,
        locationId: parsed.data.location.id,
        locationName: parsed.data.location.name ?? null,
        companyId: parsed.data.location.companyId ?? null,
        timezone: parsed.data.location.timezone ?? null,
      };
    } catch {
      return {
        mode: this.mode,
        locationId: config.locationId,
        locationName: null,
        companyId: null,
        timezone: null,
      };
    }
  }

  /**
   * Health check for PIT mode.
   *
   * IMPORTANT: We do NOT require GET /locations for PIT health.
   * Acton's PIT may not have locations.readonly scope, but core CRM (contacts/opportunities/pipelines)
   * may still work. We prove token validity via POST /contacts/search with limit=1.
   *
   * Location name is fetched as optional enrichment; failure is a warning, not an auth failure.
   */
  async health(): Promise<GhlCredentialHealth> {
    const config = getGhlRuntimeConfig();

    if (!config.privateIntegrationToken) {
      return {
        ok: false,
        mode: this.mode,
        code: "BAXTER_GHL_NOT_CONFIGURED",
        message: "GHL_PRIVATE_INTEGRATION_TOKEN is not set.",
        locationId: config.locationId,
      };
    }

    if (!config.locationId) {
      return {
        ok: false,
        mode: this.mode,
        code: "BAXTER_GHL_LOCATION_INVALID",
        message: "GHL_LOCATION_ID is not set.",
        locationId: null,
      };
    }

    try {
      const token = await this.getAccessToken();

      // Use POST /contacts/search to prove token validity (contacts.readonly scope)
      // This is more reliable than GET /locations which requires locations.readonly
      const searchUrl = `${config.apiBaseUrl}/contacts/search`;
      const searchResponse = await fetch(searchUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "v3",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId: config.locationId,
          pageLimit: 1,
        }),
      });

      if (!searchResponse.ok) {
        const text = await searchResponse.text().catch(() => "");
        const lower = text.toLowerCase();

        // Check for scope issues vs true auth failures
        if (searchResponse.status === 401 || searchResponse.status === 403) {
          const isScopeIssue =
            lower.includes("not authorized for this scope") ||
            lower.includes("scope") ||
            lower.includes("permission");

          if (isScopeIssue) {
            return {
              ok: false,
              mode: this.mode,
              code: "BAXTER_GHL_SCOPE_MISSING",
              message: `Token lacks required scopes for contacts. Add 'contacts.readonly' to your Private Integration in GHL.`,
              locationId: config.locationId,
            };
          }

          // True auth failure
          return {
            ok: false,
            mode: this.mode,
            code: "BAXTER_GHL_AUTH_FAILED",
            message: `Authentication failed (${searchResponse.status}): ${text.slice(0, 100)}`,
            locationId: config.locationId,
          };
        }

        return {
          ok: false,
          mode: this.mode,
          code: "BAXTER_GHL_API_UNAVAILABLE",
          message: `API error (${searchResponse.status}): ${text.slice(0, 100)}`,
          locationId: config.locationId,
        };
      }

      // Token is valid for core CRM access
      return {
        ok: true,
        mode: this.mode,
        code: null,
        message: "Private integration token is valid for core CRM access.",
        locationId: config.locationId,
      };
    } catch (error) {
      return {
        ok: false,
        mode: this.mode,
        code: "BAXTER_GHL_API_UNAVAILABLE",
        message: error instanceof Error ? error.message.slice(0, 200) : "Health check failed",
        locationId: config.locationId,
      };
    }
  }

  /**
   * Soft-fetch location name as optional enrichment.
   * Returns null on failure instead of throwing.
   */
  async getLocationNameSoft(): Promise<string | null> {
    const config = getGhlRuntimeConfig();
    if (!config.locationId) return null;

    try {
      const token = await this.getAccessToken();
      const url = `${config.apiBaseUrl}/locations/${config.locationId}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "v3",
          Accept: "application/json",
        },
      });

      if (!response.ok) return null;

      const data = await response.json();
      const parsed = ghlLocationResponseSchema.safeParse(data);
      return parsed.success ? (parsed.data.location.name ?? null) : null;
    } catch {
      return null;
    }
  }
}

export class OAuthCredentialProvider implements GhlCredentialProvider {
  readonly mode: GhlAuthMode = "oauth";
  private connectionId: string;
  private cachedAccessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  async getAccessToken(): Promise<string> {
    if (this.cachedAccessToken && this.tokenExpiresAt && this.tokenExpiresAt > new Date()) {
      return this.cachedAccessToken;
    }

    const connection = await getActiveGhlConnection();
    if (!connection || connection.id !== this.connectionId) {
      throw new GhlAuthError(
        "GHL OAuth connection not found or changed",
        "BAXTER_GHL_REAUTH_REQUIRED",
      );
    }

    if (connection.token_expires_at && new Date(connection.token_expires_at) > new Date()) {
      const accessToken = decryptGhlConnectionAccessToken(connection);
      this.cachedAccessToken = accessToken;
      this.tokenExpiresAt = new Date(connection.token_expires_at);
      return accessToken;
    }

    const refreshToken = decryptGhlConnectionRefreshToken(connection);
    const config = getGhlRuntimeConfig();

    const response = await fetch(`${GHL_API_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.oauthClientId ?? "",
        client_secret: config.oauthClientSecret ?? "",
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new GhlAuthError(
        `OAuth token refresh failed: ${text.slice(0, 100)}`,
        "BAXTER_GHL_REAUTH_REQUIRED",
      );
    }

    const data = await response.json();
    const accessToken = data.access_token as string;
    const expiresIn = (data.expires_in as number) || 3600;

    this.cachedAccessToken = accessToken;
    this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000 - 60000);

    return accessToken;
  }

  async getIdentity(): Promise<GhlConnectorIdentity> {
    const connection = await getActiveGhlConnection();
    if (!connection) {
      throw new GhlAuthError("No active GHL OAuth connection", "BAXTER_GHL_REAUTH_REQUIRED");
    }

    return {
      mode: this.mode,
      locationId: connection.location_id,
      locationName: connection.location_name,
      companyId: connection.company_id,
      timezone: connection.location_timezone,
    };
  }

  async health(): Promise<GhlCredentialHealth> {
    try {
      const connection = await getActiveGhlConnection();
      if (!connection) {
        return {
          ok: false,
          mode: this.mode,
          code: "BAXTER_GHL_REAUTH_REQUIRED",
          message: "No active GHL OAuth connection found.",
          locationId: null,
        };
      }

      const token = await this.getAccessToken();
      const config = getGhlRuntimeConfig();
      const locationId = connection.location_id;

      const url = `${config.apiBaseUrl}/locations/${locationId}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "v3",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          ok: false,
          mode: this.mode,
          code: response.status === 401 ? "BAXTER_GHL_AUTH_FAILED" : "BAXTER_GHL_API_UNAVAILABLE",
          message: `API check failed (${response.status}): ${text.slice(0, 100)}`,
          locationId,
        };
      }

      return {
        ok: true,
        mode: this.mode,
        code: null,
        message: "OAuth connection is healthy.",
        locationId,
      };
    } catch (error) {
      return {
        ok: false,
        mode: this.mode,
        code: "BAXTER_GHL_API_UNAVAILABLE",
        message: error instanceof Error ? error.message.slice(0, 200) : "Health check failed",
        locationId: null,
      };
    }
  }
}

let cachedProvider: GhlCredentialProvider | null = null;

export async function resolveGhlCredentialProvider(): Promise<GhlCredentialProvider> {
  const mode = getGhlAuthMode();
  const config = getGhlRuntimeConfig();

  if (!config.enabled) {
    throw new GhlConfigError(
      "GoHighLevel integration is disabled. Set ENABLE_GHL_INTEGRATION=true.",
      "BAXTER_GHL_DISABLED",
    );
  }

  if (mode === "private_integration") {
    if (!config.privateIntegrationToken) {
      throw new GhlConfigError(
        "GHL_PRIVATE_INTEGRATION_TOKEN is not configured.",
        "BAXTER_GHL_NOT_CONFIGURED",
      );
    }
    if (!cachedProvider || cachedProvider.mode !== "private_integration") {
      cachedProvider = new PrivateIntegrationCredentialProvider();
    }
    return cachedProvider;
  }

  const connection = await getActiveGhlConnection().catch(() => null);
  if (connection && connection.status !== "disconnected") {
    return new OAuthCredentialProvider(connection.id);
  }

  if (!isGhlOAuthConfigured()) {
    throw new GhlConfigError(
      "GHL OAuth is not fully configured. Set GHL_CLIENT_ID, GHL_CLIENT_SECRET, GHL_REDIRECT_URI, and token encryption key.",
      "BAXTER_GHL_NOT_CONFIGURED",
    );
  }

  throw new GhlConfigError(
    "No GHL OAuth connection exists. Connect GoHighLevel in Admin → Connectors.",
    "BAXTER_GHL_REAUTH_REQUIRED",
  );
}

export function isGhlConnectorConfigured(): boolean {
  return isGhlConfigured();
}

export async function getGhlConnectionSnapshot() {
  const config = getGhlRuntimeConfig();
  const connection = await getActiveGhlConnection().catch(() => null);
  return {
    enabled: config.enabled,
    authMode: config.authMode,
    locationId: config.locationId,
    oauthConfigured: isGhlOAuthConfigured(),
    connection: connection
      ? {
          id: connection.id,
          status: connection.status,
          locationId: connection.location_id,
          locationName: connection.location_name,
          connectedAt: connection.connected_at,
          lastSuccessAt: connection.last_success_at,
          lastErrorCode: connection.last_error_code,
        }
      : null,
  };
}

export function clearGhlCredentialCacheForTests(): void {
  cachedProvider = null;
}
