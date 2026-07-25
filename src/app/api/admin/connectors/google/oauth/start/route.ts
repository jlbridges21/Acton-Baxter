import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api";
import { GoogleConfigError, GoogleConnectorError } from "@/lib/connectors/google/errors";
import {
  googleOAuthAuthorizationUrl,
  isGoogleOAuthConfigured,
} from "@/lib/connectors/google/oauth-config";
import { createGoogleOAuthState } from "@/lib/connectors/google/oauth-state";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireAdmin();
    if (!isGoogleOAuthConfigured()) {
      throw new GoogleConfigError(
        "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, and GOOGLE_TOKEN_ENCRYPTION_KEY in Vercel, then redeploy.",
        "BAXTER_GOOGLE_OAUTH_NOT_CONFIGURED",
      );
    }

    const url = new URL(request.url);
    const returnPath = url.searchParams.get("return") ?? "/admin/connectors/google";
    const forceConsent = url.searchParams.get("consent") === "1";

    const { state } = await createGoogleOAuthState({
      adminUserId: user.id,
      returnPath,
    });

    const authUrl = googleOAuthAuthorizationUrl(state, forceConsent);
    return Response.redirect(authUrl, 302);
  } catch (error) {
    if (error instanceof GoogleConfigError || error instanceof GoogleConnectorError) {
      const dest = new URL("/admin/connectors/google", request.url);
      dest.searchParams.set("oauth_error", error.code);
      dest.searchParams.set("oauth_message", error.message.slice(0, 300));
      return Response.redirect(dest, 302);
    }
    return jsonError(error, "GET /api/admin/connectors/google/oauth/start");
  }
}
