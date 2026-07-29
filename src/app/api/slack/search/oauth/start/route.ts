import { requireActiveUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { createSlackSearchOAuthState } from "@/lib/baxter-data/slack/connections";
import {
  getSlackSearchOAuthRedirectUri,
  getSlackSearchRuntimeConfig,
  SLACK_SEARCH_USER_SCOPES,
} from "@/lib/baxter-data/slack/config";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Start per-user Slack OAuth for Real-time Search.
 * Admins can link from /admin/slack; employees can link when Prompt 2 exposes settings.
 */
export async function GET(request: Request) {
  try {
    const user = await requireActiveUser();
    const url = new URL(request.url);
    const returnPath = url.searchParams.get("return") || "/admin/slack";

    // For Prompt 1, OAuth linking is admin-initiated; Prompt 2 may open to all employees.
    if (!isAdminRole(user.profile.role) && !url.searchParams.get("self")) {
      return Response.redirect(
        new URL("/admin/slack?slack_search_error=admin_only", request.url),
        302,
      );
    }

    const config = getSlackSearchRuntimeConfig();
    if (!config.searchEnabled) {
      return Response.redirect(
        new URL(`${returnPath}?slack_search_error=disabled`, request.url),
        302,
      );
    }
    if (!config.readyForUserOauth) {
      return Response.redirect(
        new URL(`${returnPath}?slack_search_error=misconfigured`, request.url),
        302,
      );
    }

    const stateRow = await createSlackSearchOAuthState({
      baxterUserId: user.profile.id,
      returnPath,
    });
    if (!stateRow) {
      return Response.redirect(
        new URL(`${returnPath}?slack_search_error=state_failed`, request.url),
        302,
      );
    }

    const env = getEnv();
    const params = new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      user_scope: SLACK_SEARCH_USER_SCOPES.join(","),
      redirect_uri: getSlackSearchOAuthRedirectUri(),
      state: stateRow.state,
    });

    return Response.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`, 302);
  } catch {
    return Response.redirect(new URL("/login", request.url), 302);
  }
}
