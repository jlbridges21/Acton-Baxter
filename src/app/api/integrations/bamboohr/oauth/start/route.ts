import { requireAiContext } from "@/lib/agents/http";
import { getBambooAccess } from "@/lib/bamboohr/access";
import { startAuthorization } from "@/lib/bamboohr/connection";
import { oauthResultRedirect } from "@/lib/bamboohr/oauth-redirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts the BambooHR OAuth authorization-code flow (COO only). */
export async function GET(request: Request) {
  try {
    const ctx = await requireAiContext();
    const access = await getBambooAccess(ctx.requester);
    if (!access.canManageConnection)
      return oauthResultRedirect(request, {
        bamboohr_error: "Only the COO can connect BambooHR (the COO controls system access).",
      });
    const groups = (new URL(request.url).searchParams.get("groups") ?? "")
      .split(",")
      .filter(Boolean)
      .slice(0, 10);
    const { url } = await startAuthorization({ userId: ctx.user.id, optionalGroups: groups });
    return Response.redirect(url, 302);
  } catch (error) {
    return oauthResultRedirect(request, {
      bamboohr_error:
        error instanceof Error
          ? error.message.slice(0, 300)
          : "Couldn't start the BambooHR connection.",
    });
  }
}
