import { requireAiContext } from "@/lib/agents/http";
import { getBambooAccess } from "@/lib/bamboohr/access";
import { completeAuthorization } from "@/lib/bamboohr/connection";
import { oauthResultRedirect } from "@/lib/bamboohr/oauth-redirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * BambooHR redirects here after the COO approves the Baxter app. Register exactly:
 *   {APP_BASE_URL}/api/integrations/bamboohr/oauth/callback
 * Tokens never appear in the redirect back to the app.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const ctx = await requireAiContext();
    const access = await getBambooAccess(ctx.requester);
    if (!access.canManageConnection)
      return oauthResultRedirect(request, { bamboohr_error: "Only the COO can connect BambooHR." });
    const providerError = url.searchParams.get("error");
    if (providerError)
      return oauthResultRedirect(request, {
        bamboohr_error: `BambooHR authorization was not completed (${(url.searchParams.get("error_description") ?? providerError).slice(0, 150)}).`,
      });
    const code = url.searchParams.get("code");
    if (!code)
      return oauthResultRedirect(request, {
        bamboohr_error: "BambooHR didn't return an authorization code. Try Connect again.",
      });
    const row = await completeAuthorization({
      code,
      state: url.searchParams.get("state") ?? "",
      userId: ctx.user.id,
      actorLabel: ctx.user.profile.full_name || ctx.user.email,
    });
    return oauthResultRedirect(request, { bamboohr_connected: row.company_domain });
  } catch (error) {
    return oauthResultRedirect(request, {
      bamboohr_error:
        error instanceof Error ? error.message.slice(0, 300) : "The BambooHR connection failed.",
    });
  }
}
