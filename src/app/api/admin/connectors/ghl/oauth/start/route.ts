import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api";
import {
  isGhlOAuthFullyConfigured,
  ghlOAuthAuthorizationUrl,
} from "@/lib/connectors/ghl/oauth-config";
import { createGhlOAuthState } from "@/lib/connectors/ghl/oauth-state";

export async function GET(request: Request) {
  try {
    const user = await requireAdmin();

    if (!isGhlOAuthFullyConfigured()) {
      return NextResponse.json(
        {
          error: {
            code: "BAXTER_GHL_NOT_CONFIGURED",
            message:
              "GHL OAuth is not fully configured. Set GHL_CLIENT_ID, GHL_CLIENT_SECRET, GHL_REDIRECT_URI, and token encryption key.",
          },
        },
        { status: 400 },
      );
    }

    const url = new URL(request.url);
    const returnPath = url.searchParams.get("returnPath") || "/admin/connectors/ghl";

    const { state } = await createGhlOAuthState({
      adminUserId: user.id,
      returnPath,
    });

    const authUrl = ghlOAuthAuthorizationUrl(state);

    return NextResponse.redirect(authUrl);
  } catch (error) {
    return jsonError(error, "GET /api/admin/connectors/ghl/oauth/start");
  }
}
