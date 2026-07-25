import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api";
import { isGoogleOAuthConfigured } from "@/lib/connectors/google/oauth-config";
import { GoogleConfigError } from "@/lib/connectors/google/errors";

export const runtime = "nodejs";

/**
 * Reconnect = force consent OAuth start so Google issues a fresh refresh token.
 * Selections and roots are preserved in the database.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    if (!isGoogleOAuthConfigured()) {
      throw new GoogleConfigError(
        "Google OAuth is not configured.",
        "BAXTER_GOOGLE_OAUTH_NOT_CONFIGURED",
      );
    }
    const dest = new URL("/api/admin/connectors/google/oauth/start", request.url);
    dest.searchParams.set("consent", "1");
    dest.searchParams.set("return", "/admin/connectors/google");
    return Response.redirect(dest, 302);
  } catch (error) {
    return jsonError(error, "POST /api/admin/connectors/google/reconnect");
  }
}

export async function GET(request: Request) {
  return POST(request);
}
