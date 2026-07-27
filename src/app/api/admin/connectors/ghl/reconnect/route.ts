import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api";
import { getGhlRuntimeConfig } from "@/lib/connectors/ghl/config";
import { resolveGhlCredentialProvider } from "@/lib/connectors/ghl/auth";
import { upsertGhlPrivateIntegrationConnection } from "@/lib/connectors/ghl/connections";

export async function GET(request: Request) {
  try {
    const user = await requireAdmin();
    const config = getGhlRuntimeConfig();

    // For OAuth mode, redirect to OAuth start
    if (config.authMode === "oauth") {
      return NextResponse.redirect(new URL("/api/admin/connectors/ghl/oauth/start", request.url));
    }

    // For Private Integration mode, verify and mark connected
    if (config.authMode === "private_integration") {
      if (!config.locationId) {
        return NextResponse.json(
          {
            error: {
              code: "BAXTER_GHL_LOCATION_INVALID",
              message: "GHL_LOCATION_ID is not configured.",
            },
          },
          { status: 400 },
        );
      }

      try {
        const provider = await resolveGhlCredentialProvider();
        const identity = await provider.getIdentity();
        const health = await provider.health();

        if (!health.ok) {
          return NextResponse.json(
            {
              error: {
                code: health.code ?? "BAXTER_GHL_AUTH_FAILED",
                message: `Cannot verify Private Integration Token: ${health.message}`,
              },
            },
            { status: 400 },
          );
        }

        await upsertGhlPrivateIntegrationConnection({
          locationId: identity.locationId,
          companyId: identity.companyId,
          locationName: identity.locationName,
          locationTimezone: identity.timezone,
          connectedBy: user.id,
        });

        return NextResponse.redirect(
          new URL("/admin/connectors/ghl?reconnect_success=1", request.url),
        );
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code ?? "BAXTER_GHL_AUTH_FAILED")
            : "BAXTER_GHL_AUTH_FAILED";
        const message = error instanceof Error ? error.message : "Connection verification failed";

        return NextResponse.json(
          {
            error: {
              code,
              message,
            },
          },
          { status: 400 },
        );
      }
    }

    return NextResponse.json(
      {
        error: {
          code: "BAXTER_GHL_NOT_CONFIGURED",
          message: "GHL auth mode is not configured.",
        },
      },
      { status: 400 },
    );
  } catch (error) {
    return jsonError(error, "GET /api/admin/connectors/ghl/reconnect");
  }
}
