import "server-only";

import {
  getSlackSearchRuntimeConfig,
  getSlackSearchUserTokenFromEnv,
  scopesToCapabilities,
  SLACK_SEARCH_USER_SCOPES,
} from "./config";
import { SLACK_SEARCH_ERROR_CODES } from "./errors";
import type {
  SlackAccessCapabilities,
  SlackChannelKind,
  SlackCredentialResolution,
  SlackRequester,
  SlackSearchDeps,
} from "./types";

function emptyCapabilities(): SlackAccessCapabilities {
  return {
    publicChannels: false,
    privateChannels: false,
    dms: false,
    groupDms: false,
    threadContext: false,
    permalinks: false,
    userLevelAuthorization: "not_configured",
    tokenKind: "none",
    allowedChannelTypes: [],
  };
}

export function capabilitiesFromScopes(
  scopes: string[],
  tokenKind: SlackAccessCapabilities["tokenKind"],
  userLevel: SlackAccessCapabilities["userLevelAuthorization"],
): SlackAccessCapabilities {
  const base = scopesToCapabilities(scopes);
  const allowed: SlackChannelKind[] = [];
  if (base.publicChannels) allowed.push("public_channel");
  if (base.privateChannels) allowed.push("private_channel");
  if (base.dms) allowed.push("im");
  if (base.groupDms) allowed.push("mpim");

  // Bot path is public-only regardless of accidental private scopes.
  if (tokenKind === "bot_with_action_token") {
    return {
      publicChannels: base.publicChannels,
      privateChannels: false,
      dms: false,
      groupDms: false,
      threadContext: base.threadContext,
      permalinks: true,
      userLevelAuthorization: userLevel,
      tokenKind,
      allowedChannelTypes: base.publicChannels ? ["public_channel"] : [],
    };
  }

  return {
    ...base,
    permalinks: true,
    userLevelAuthorization: userLevel,
    tokenKind,
    allowedChannelTypes: allowed,
  };
}

/**
 * Filter channel types to those the credential is allowed to search.
 * Authorization happens here — before any evidence reaches a model.
 */
export function filterAllowedChannelTypes(
  requested: SlackChannelKind[] | undefined,
  capabilities: SlackAccessCapabilities,
): SlackChannelKind[] {
  const allowed = new Set(capabilities.allowedChannelTypes);
  const base = requested?.length ? requested : capabilities.allowedChannelTypes;
  return base.filter((t) => allowed.has(t));
}

/**
 * Drop evidence that is outside the requester's allowed channel kinds.
 * Defense in depth after live retrieval.
 */
export function filterEvidenceByAccess<
  T extends { channelKind: SlackChannelKind | null; channelId: string },
>(items: T[], capabilities: SlackAccessCapabilities): T[] {
  const allowed = new Set(capabilities.allowedChannelTypes);
  return items.filter((item) => {
    if (!item.channelKind) {
      // Unknown kind: only keep if it looks like a public channel id and public is allowed.
      if (item.channelId.startsWith("C") && allowed.has("public_channel")) return true;
      return false;
    }
    return allowed.has(item.channelKind);
  });
}

export function assertNoForeignDmLeak(params: {
  evidenceChannelIds: string[];
  evidenceKinds: Array<SlackChannelKind | null>;
  requesterSlackUserId: string | null | undefined;
  tokenSlackUserId: string | null | undefined;
  capabilities: SlackAccessCapabilities;
}): { ok: true } | { ok: false; code: typeof SLACK_SEARCH_ERROR_CODES.PERMISSION_DENIED } {
  const hasDm = params.evidenceKinds.some((k) => k === "im" || k === "mpim");
  if (!hasDm) return { ok: true };
  if (!params.capabilities.dms && !params.capabilities.groupDms) {
    return { ok: false, code: SLACK_SEARCH_ERROR_CODES.PERMISSION_DENIED };
  }
  // User-token search is scoped by Slack to that token's visibility.
  // Require token identity to match requester when DMs are included.
  if (
    params.requesterSlackUserId &&
    params.tokenSlackUserId &&
    params.requesterSlackUserId !== params.tokenSlackUserId
  ) {
    return { ok: false, code: SLACK_SEARCH_ERROR_CODES.PERMISSION_DENIED };
  }
  return { ok: true };
}

/**
 * Resolve which Slack credential to use for search.
 * Prefer the requesting employee's user token. Never use another user's
 * private/DM scopes. Bot + action_token is public-only.
 */
export async function resolveSearchCredential(
  requester: SlackRequester,
  deps?: SlackSearchDeps,
): Promise<
  | { ok: true; credential: SlackCredentialResolution }
  | {
      ok: false;
      code: (typeof SLACK_SEARCH_ERROR_CODES)[keyof typeof SLACK_SEARCH_ERROR_CODES];
      message: string;
    }
> {
  if (deps?.resolveSearchCredential) {
    const injected = await deps.resolveSearchCredential(requester);
    if (injected) return { ok: true, credential: injected };
    return {
      ok: false,
      code: SLACK_SEARCH_ERROR_CODES.AUTH_REQUIRED,
      message: employeeAuthMessage(),
    };
  }

  const config = getSlackSearchRuntimeConfig();
  if (!config.searchEnabled) {
    return {
      ok: false,
      code: SLACK_SEARCH_ERROR_CODES.DISABLED,
      message: "Slack search is disabled (ENABLE_SLACK_SEARCH).",
    };
  }

  // 1) Linked per-user connection (loaded lazily to avoid circular imports in tests)
  const { loadUserSearchCredential } = await import("./connections");
  const linked = await loadUserSearchCredential(requester);
  if (linked) {
    return { ok: true, credential: linked };
  }

  // 2) Slack-originated public search via bot + action_token
  if (requester.actionToken && config.botTokenPresent) {
    let botToken = "";
    try {
      const { getEnv } = await import("@/lib/env");
      botToken = getEnv().SLACK_BOT_TOKEN?.trim() ?? "";
    } catch {
      botToken = (process.env.SLACK_BOT_TOKEN ?? "").trim();
    }
    if (botToken) {
      const scopes = ["search:read.public", "search:read.users", "channels:history"];
      return {
        ok: true,
        credential: {
          token: botToken,
          tokenKind: "bot_with_action_token",
          slackUserId: requester.slackUserId ?? null,
          slackTeamId: requester.slackTeamId ?? null,
          scopes,
          actionToken: requester.actionToken,
          capabilities: capabilitiesFromScopes(scopes, "bot_with_action_token", "partial"),
        },
      };
    }
  }

  // 3) Admin public-only env user token — ONLY when explicitly allowed and
  //    restricted to public channels in capabilities.
  if (requester.allowPublicOnlyFallback) {
    const envToken = getSlackSearchUserTokenFromEnv();
    if (envToken) {
      const scopes = ["search:read.public", "search:read.users", "channels:history"];
      return {
        ok: true,
        credential: {
          token: envToken,
          tokenKind: "user",
          slackUserId: null,
          slackTeamId: requester.slackTeamId ?? null,
          scopes,
          capabilities: {
            ...capabilitiesFromScopes(scopes, "user", "partial"),
            privateChannels: false,
            dms: false,
            groupDms: false,
            allowedChannelTypes: ["public_channel"],
            userLevelAuthorization: "partial",
          },
        },
      };
    }
  }

  if (requester.baxterUserId && !requester.slackUserId) {
    return {
      ok: false,
      code: SLACK_SEARCH_ERROR_CODES.USER_NOT_LINKED,
      message: employeeAuthMessage(),
    };
  }

  return {
    ok: false,
    code: SLACK_SEARCH_ERROR_CODES.AUTH_REQUIRED,
    message: employeeAuthMessage(),
  };
}

function employeeAuthMessage() {
  return "Slack search is unavailable until your Slack account is linked.";
}

export function defaultEmptyAccess(): SlackAccessCapabilities {
  return emptyCapabilities();
}

export function expectedUserScopes(): string[] {
  return [...SLACK_SEARCH_USER_SCOPES];
}
