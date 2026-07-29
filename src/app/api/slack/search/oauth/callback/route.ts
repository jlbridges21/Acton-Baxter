import { requireActiveUser } from "@/lib/auth/session";
import {
  consumeSlackSearchOAuthState,
  upsertSlackSearchConnection,
} from "@/lib/baxter-data/slack/connections";
import {
  getSlackSearchOAuthRedirectUri,
  SLACK_SEARCH_USER_SCOPES,
} from "@/lib/baxter-data/slack/config";
import { getEnv } from "@/lib/env";
import { callSlackApi } from "@/lib/baxter-data/slack/api";

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
  const returnFallback = "/settings/integrations";

  try {
    await requireActiveUser();
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      return redirectResult(request, returnFallback, {
        slack_search_error: "oauth_cancelled",
      });
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return redirectResult(request, returnFallback, {
        slack_search_error: "missing_code",
      });
    }

    const consumed = await consumeSlackSearchOAuthState(state);
    if (!consumed) {
      return redirectResult(request, returnFallback, {
        slack_search_error: "invalid_state",
      });
    }

    const env = getEnv();
    const body = new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: getSlackSearchOAuthRedirectUri(),
    });

    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const tokenData = (await tokenResponse.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      authed_user?: {
        id?: string;
        access_token?: string;
        scope?: string;
      };
      team?: { id?: string; name?: string };
    } | null;

    if (!tokenData?.ok || !tokenData.authed_user?.access_token || !tokenData.authed_user.id) {
      return redirectResult(request, consumed.returnPath || returnFallback, {
        slack_search_error: "token_exchange_failed",
      });
    }

    const scopes = (tokenData.authed_user.scope ?? SLACK_SEARCH_USER_SCOPES.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let slackUserName: string | null = null;
    const authTest = await callSlackApi("auth.test", {
      token: tokenData.authed_user.access_token,
      body: {},
      form: true,
    });
    if (authTest.ok && typeof authTest.data.user === "string") {
      slackUserName = authTest.data.user;
    }

    const saved = await upsertSlackSearchConnection({
      baxterUserId: consumed.baxterUserId,
      slackUserId: tokenData.authed_user.id,
      slackTeamId: tokenData.team?.id ?? "",
      slackUserName,
      accessToken: tokenData.authed_user.access_token,
      scopes,
    });

    if (!saved.ok) {
      return redirectResult(request, consumed.returnPath || returnFallback, {
        slack_search_error: "save_failed",
      });
    }

    // Also persist identity mapping so /pem works without relying on Search alone.
    if (tokenData.team?.id) {
      const { upsertSlackUserMapping } = await import("@/lib/slack/identity");
      await upsertSlackUserMapping({
        slackTeamId: tokenData.team.id,
        slackUserId: tokenData.authed_user.id,
        appUserId: consumed.baxterUserId,
      }).catch(() => undefined);
    }

    return redirectResult(request, consumed.returnPath || returnFallback, {
      slack_search: "linked",
    });
  } catch {
    return redirectResult(request, returnFallback, {
      slack_search_error: "callback_failed",
    });
  }
}
