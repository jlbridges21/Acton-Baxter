import { requireAdmin } from "@/lib/auth/session";
import { consumeGhlOAuthState } from "@/lib/connectors/ghl/oauth-state";
import { getGhlOAuthEnv } from "@/lib/connectors/ghl/oauth-config";
import { upsertGhlOAuthConnection } from "@/lib/connectors/ghl/connections";
import { getExpectedScopesFromEnv } from "@/lib/connectors/ghl/scopes";
import { isTokenEncryptionConfigured } from "@/lib/security/secret-box";
import { GHL_API_BASE_URL } from "@/lib/connectors/ghl/types";
import { getGhlRuntimeConfig } from "@/lib/connectors/ghl/config";

export const runtime = "nodejs";

function redirectResult(request: Request, path: string, params: Record<string, string>) {
  const dest = new URL(path, request.url);
  for (const [key, value] of Object.entries(params)) {
    dest.searchParams.set(key, value);
  }
  return Response.redirect(dest, 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnFallback = "/admin/connectors/ghl";

  try {
    const user = await requireAdmin();
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      return redirectResult(request, returnFallback, {
        oauth_error: "BAXTER_GHL_OAUTH_CALLBACK_FAILED",
        oauth_message: url.searchParams.get("error_description") || errorParam,
      });
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) {
      return redirectResult(request, returnFallback, {
        oauth_error: "BAXTER_GHL_OAUTH_CALLBACK_FAILED",
        oauth_message: "Missing authorization code from GoHighLevel.",
      });
    }

    const { returnPath } = await consumeGhlOAuthState({
      state: state ?? "",
      adminUserId: user.id,
    });

    if (!isTokenEncryptionConfigured()) {
      return redirectResult(request, returnPath, {
        oauth_error: "BAXTER_GHL_NOT_CONFIGURED",
        oauth_message: "GHL_TOKEN_ENCRYPTION_KEY or GOOGLE_TOKEN_ENCRYPTION_KEY is not set.",
      });
    }

    const oauth = getGhlOAuthEnv();
    if (!oauth) {
      return redirectResult(request, returnPath, {
        oauth_error: "BAXTER_GHL_NOT_CONFIGURED",
        oauth_message: "GHL OAuth credentials are not configured.",
      });
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(`${GHL_API_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: oauth.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => "");
      return redirectResult(request, returnPath, {
        oauth_error: "BAXTER_GHL_OAUTH_CALLBACK_FAILED",
        oauth_message: `Token exchange failed (${tokenResponse.status}): ${text.slice(0, 100)}`,
      });
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token as string;
    const refreshToken = tokens.refresh_token as string;
    const expiresIn = (tokens.expires_in as number) || 3600;
    const grantedScopes =
      typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : [];
    const locationId = tokens.locationId as string | undefined;

    if (!refreshToken) {
      return redirectResult(request, returnPath, {
        oauth_error: "BAXTER_GHL_REFRESH_TOKEN_MISSING",
        oauth_message: "GoHighLevel did not return a refresh token. Try reconnecting.",
      });
    }

    // Validate location ID if configured
    const config = getGhlRuntimeConfig();
    if (config.locationId && locationId && locationId !== config.locationId) {
      return redirectResult(request, returnPath, {
        oauth_error: "BAXTER_GHL_LOCATION_INVALID",
        oauth_message: `OAuth connected to location ${locationId} but expected ${config.locationId}. Update GHL_LOCATION_ID or reconnect to the correct location.`,
      });
    }

    // Fetch location details
    let locationName: string | null = null;
    let companyId: string | null = null;
    let timezone: string | null = null;
    const finalLocationId = locationId || config.locationId;

    if (finalLocationId) {
      try {
        const locationResponse = await fetch(`${config.apiBaseUrl}/locations/${finalLocationId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: "2021-07-28",
            Accept: "application/json",
          },
        });

        if (locationResponse.ok) {
          const locationData = await locationResponse.json();
          const loc = locationData.location;
          if (loc) {
            locationName = loc.name ?? null;
            companyId = loc.companyId ?? null;
            timezone = loc.timezone ?? null;
          }
        }
      } catch {
        // Best effort - continue without location details
      }
    }

    if (!finalLocationId) {
      return redirectResult(request, returnPath, {
        oauth_error: "BAXTER_GHL_LOCATION_INVALID",
        oauth_message: "GHL_LOCATION_ID is not configured and OAuth did not return a location ID.",
      });
    }

    const expectedScopes = getExpectedScopesFromEnv();

    await upsertGhlOAuthConnection({
      locationId: finalLocationId,
      companyId,
      locationName,
      locationTimezone: timezone,
      accessToken,
      refreshToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      grantedScopes,
      expectedScopes,
      connectedBy: user.id,
    });

    return redirectResult(request, returnPath, {
      oauth_success: "1",
      connected_location: locationName || finalLocationId,
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_GHL_OAUTH_CALLBACK_FAILED")
        : "BAXTER_GHL_OAUTH_CALLBACK_FAILED";
    const message = error instanceof Error ? error.message.slice(0, 300) : "OAuth callback failed";
    return redirectResult(request, returnFallback, {
      oauth_error: code,
      oauth_message: message,
    });
  }
}
