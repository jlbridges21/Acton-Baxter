import "server-only";

import { GoogleConfigError, GoogleConnectorError } from "../errors";
import {
  decryptConnectionRefreshToken,
  getActiveGoogleConnection,
  markGoogleConnectionReauth,
  markGoogleConnectionSuccess,
  updateConnectionAccessExpiry,
  type GoogleConnectionRow,
} from "../connections";
import { getGoogleOAuthEnv } from "../oauth-config";
import type {
  GoogleCredentialHealth,
  GoogleCredentialProvider,
  GoogleConnectorIdentity,
} from "./types";

type TokenCache = {
  connectionId: string;
  accessToken: string;
  expiresAtMs: number;
};

const globalOauth = globalThis as typeof globalThis & {
  __baxterGoogleOauthToken?: TokenCache;
};

export class WorkspaceOAuthCredentialProvider implements GoogleCredentialProvider {
  mode = "workspace_oauth" as const;
  private connection: GoogleConnectionRow | null = null;

  constructor(connection?: GoogleConnectionRow | null) {
    this.connection = connection ?? null;
  }

  private async loadConnection(): Promise<GoogleConnectionRow> {
    if (this.connection) return this.connection;
    const row = await getActiveGoogleConnection();
    if (!row || row.auth_mode !== "workspace_oauth") {
      throw new GoogleConfigError(
        "Connect Google Workspace first (Connect Google Workspace).",
        "BAXTER_GOOGLE_OAUTH_NOT_CONFIGURED",
      );
    }
    if (row.status === "reauthorization_required" || row.status === "disconnected") {
      throw new GoogleConnectorError(
        "Google Workspace authorization expired. Reconnect Google Workspace.",
        {
          code: "BAXTER_GOOGLE_REAUTHORIZATION_REQUIRED",
          statusCode: 401,
          expose: true,
        },
      );
    }
    this.connection = row;
    return row;
  }

  async getIdentity(): Promise<GoogleConnectorIdentity> {
    const row = await this.loadConnection();
    return {
      mode: "workspace_oauth",
      email: row.google_account_email,
      subject: row.google_account_subject,
      hostedDomain: row.hosted_domain,
    };
  }

  async health(): Promise<GoogleCredentialHealth> {
    try {
      const identity = await this.getIdentity();
      await this.getAccessToken();
      return {
        ok: true,
        mode: "workspace_oauth",
        code: null,
        message: "Google Workspace OAuth connected.",
        email: identity.email,
      };
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "BAXTER_GOOGLE_AUTH_FAILED";
      let email: string | null = null;
      try {
        email = (await this.getIdentity()).email;
      } catch {
        // ignore
      }
      return {
        ok: false,
        mode: "workspace_oauth",
        code,
        message: error instanceof Error ? error.message.slice(0, 240) : "OAuth health failed",
        email,
      };
    }
  }

  async getAccessToken(): Promise<string> {
    const row = await this.loadConnection();
    const cached = globalOauth.__baxterGoogleOauthToken;
    if (cached && cached.connectionId === row.id && cached.expiresAtMs > Date.now() + 60_000) {
      return cached.accessToken;
    }

    const oauth = getGoogleOAuthEnv();
    if (!oauth) {
      throw new GoogleConfigError(
        "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured.",
        "BAXTER_GOOGLE_OAUTH_NOT_CONFIGURED",
      );
    }

    let refreshToken: string;
    try {
      refreshToken = decryptConnectionRefreshToken(row);
    } catch {
      await markGoogleConnectionReauth({
        connectionId: row.id,
        code: "BAXTER_GOOGLE_REFRESH_TOKEN_MISSING",
        message: "Encrypted refresh token is missing or could not be decrypted.",
      });
      throw new GoogleConnectorError("Refresh token missing. Reconnect Google Workspace.", {
        code: "BAXTER_GOOGLE_REFRESH_TOKEN_MISSING",
        statusCode: 401,
        expose: true,
      });
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const data = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    } | null;

    if (!response.ok || !data?.access_token) {
      const err = data?.error ?? "";
      if (err === "invalid_grant" || response.status === 400 || response.status === 401) {
        await markGoogleConnectionReauth({
          connectionId: row.id,
          code: "BAXTER_GOOGLE_REAUTHORIZATION_REQUIRED",
          message: data?.error_description || "Google refresh token revoked or invalid.",
        });
        throw new GoogleConnectorError(
          "Google authorization was revoked or expired. Reconnect Google Workspace.",
          {
            code: "BAXTER_GOOGLE_REAUTHORIZATION_REQUIRED",
            statusCode: 401,
            expose: true,
          },
        );
      }
      throw new GoogleConnectorError(
        data?.error_description || data?.error || "Failed to refresh Google access token",
        {
          code: "BAXTER_GOOGLE_REFRESH_FAILED",
          statusCode: response.status || 502,
          expose: true,
        },
      );
    }

    const expiresAtMs = Date.now() + (data.expires_in ?? 3600) * 1000;
    globalOauth.__baxterGoogleOauthToken = {
      connectionId: row.id,
      accessToken: data.access_token,
      expiresAtMs,
    };
    await updateConnectionAccessExpiry(row.id, new Date(expiresAtMs).toISOString());
    await markGoogleConnectionSuccess(row.id);
    return data.access_token;
  }
}

export function clearWorkspaceOauthTokenCacheForTests() {
  delete globalOauth.__baxterGoogleOauthToken;
}

export async function exchangeGoogleAuthorizationCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
  idToken?: string;
}> {
  const oauth = getGoogleOAuthEnv();
  if (!oauth) {
    throw new GoogleConfigError(
      "Google OAuth client is not configured.",
      "BAXTER_GOOGLE_OAUTH_NOT_CONFIGURED",
    );
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      redirect_uri: oauth.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !data?.access_token) {
    throw new GoogleConnectorError(
      data?.error_description || data?.error || "OAuth token exchange failed",
      {
        code: "BAXTER_GOOGLE_OAUTH_CALLBACK_FAILED",
        statusCode: 400,
        expose: true,
      },
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in ?? 3600,
    scope: data.scope ?? "",
    idToken: data.id_token,
  };
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<{
  email: string;
  sub: string | null;
  hd: string | null;
  name: string | null;
}> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await response.json().catch(() => null)) as {
    email?: string;
    sub?: string;
    hd?: string;
    name?: string;
  } | null;
  if (!response.ok || !data?.email) {
    throw new GoogleConnectorError("Could not read Google account profile.", {
      code: "BAXTER_GOOGLE_OAUTH_CALLBACK_FAILED",
      statusCode: 400,
      expose: true,
    });
  }
  return {
    email: data.email,
    sub: data.sub ?? null,
    hd: data.hd ?? null,
    name: data.name ?? null,
  };
}
