import { requireAdmin } from "@/lib/auth/session";
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserInfo,
} from "@/lib/connectors/google/credentials/workspace-oauth";
import {
  isGoogleAccountAllowed,
  requiredScopesGranted,
} from "@/lib/connectors/google/oauth-config";
import { consumeGoogleOAuthState } from "@/lib/connectors/google/oauth-state";
import { upsertWorkspaceOauthConnection } from "@/lib/connectors/google/connections";
import { isGoogleTokenEncryptionConfigured } from "@/lib/security/secret-box";

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
  const returnFallback = "/admin/connectors/google";

  try {
    const user = await requireAdmin();
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      return redirectResult(request, returnFallback, {
        oauth_error: "BAXTER_GOOGLE_OAUTH_CALLBACK_FAILED",
        oauth_message: url.searchParams.get("error_description") || errorParam,
      });
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) {
      return redirectResult(request, returnFallback, {
        oauth_error: "BAXTER_GOOGLE_OAUTH_CALLBACK_FAILED",
        oauth_message: "Missing authorization code from Google.",
      });
    }

    const { returnPath } = await consumeGoogleOAuthState({
      state: state ?? "",
      adminUserId: user.id,
    });

    if (!isGoogleTokenEncryptionConfigured()) {
      return redirectResult(request, returnPath, {
        oauth_error: "BAXTER_GOOGLE_OAUTH_NOT_CONFIGURED",
        oauth_message: "GOOGLE_TOKEN_ENCRYPTION_KEY is not set.",
      });
    }

    const tokens = await exchangeGoogleAuthorizationCode(code);
    if (!tokens.refreshToken) {
      return redirectResult(request, returnPath, {
        oauth_error: "BAXTER_GOOGLE_REFRESH_TOKEN_MISSING",
        oauth_message:
          "Google did not return a refresh token. Click Reconnect and approve access again (consent may be required).",
      });
    }

    const profile = await fetchGoogleUserInfo(tokens.accessToken);
    const allowed = isGoogleAccountAllowed({
      email: profile.email,
      hostedDomain: profile.hd,
    });
    if (!allowed.ok) {
      return redirectResult(request, returnPath, {
        oauth_error: allowed.code,
        oauth_message: allowed.message,
      });
    }

    const scopes = tokens.scope.split(/\s+/).filter(Boolean);
    if (!requiredScopesGranted(scopes)) {
      return redirectResult(request, returnPath, {
        oauth_error: "BAXTER_GOOGLE_SCOPE_MISSING",
        oauth_message:
          "Required read-only Drive/Docs/Sheets scopes were not granted. Reconnect and accept all requested permissions.",
      });
    }

    const connection = await upsertWorkspaceOauthConnection({
      email: profile.email,
      subject: profile.sub,
      hostedDomain: profile.hd,
      refreshToken: tokens.refreshToken,
      grantedScopes: scopes,
      connectedBy: user.id,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    });

    // Never put tokens in the redirect URL.
    return redirectResult(request, returnPath, {
      oauth_success: "1",
      connected_as: connection.google_account_email ?? profile.email,
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_GOOGLE_OAUTH_CALLBACK_FAILED")
        : "BAXTER_GOOGLE_OAUTH_CALLBACK_FAILED";
    const message = error instanceof Error ? error.message.slice(0, 300) : "OAuth callback failed";
    return redirectResult(request, returnFallback, {
      oauth_error: code,
      oauth_message: message,
    });
  }
}
