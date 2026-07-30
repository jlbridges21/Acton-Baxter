import "server-only";

import { getEnv } from "@/lib/env";
import { getPublicAppBaseUrl } from "@/lib/slack/config";
import { isTokenEncryptionConfigured } from "@/lib/security/secret-box";

/** Canonical production Slack Search OAuth callback (must match Slack app Redirect URLs). */
export const SLACK_SEARCH_OAUTH_CALLBACK_PATH = "/api/slack/search/oauth/callback";

export const SLACK_SEARCH_USER_SCOPES = [
  // Real-time Search — visibility limited to the authorizing employee
  "search:read.public",
  "search:read.private",
  "search:read.im",
  "search:read.mpim",
  "search:read.users",
  "search:read.files",
  // Identity + directory for requester-scoped resolution
  "users:read",
  "users:read.email",
  // Exact thread / nearby history after search hits
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  // Channel metadata for private/public resolution under the user token
  "channels:read",
  "groups:read",
] as const;

export const SLACK_SEARCH_BOT_SCOPES = [
  "search:read.public",
  "search:read.users",
  "search:read.files",
  "channels:history",
  // Private channels where Baxter is a member (conversations.history / directory)
  "groups:history",
  "groups:read",
] as const;

export type SlackSearchRuntimeConfig = {
  searchEnabled: boolean;
  integrationEnabled: boolean;
  botTokenPresent: boolean;
  clientIdPresent: boolean;
  clientSecretPresent: boolean;
  encryptionConfigured: boolean;
  userTokenEnvPresent: boolean;
  oauthRedirectUri: string;
  oauthRedirectUriConfigured: boolean;
  oauthAuthorizeUrl: string | null;
  missingForUserOauth: string[];
  readyForUserOauth: boolean;
  readyForPublicBotSearch: boolean;
};

function parseBool(raw: string | boolean | undefined, defaultValue: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === undefined || raw === "") return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  return defaultValue;
}

export function isSlackSearchEnabled(): boolean {
  try {
    const env = getEnv();
    // Explicit ENABLE_SLACK_SEARCH wins; otherwise inherit Slack integration on.
    if (process.env.ENABLE_SLACK_SEARCH !== undefined && process.env.ENABLE_SLACK_SEARCH !== "") {
      return Boolean(env.ENABLE_SLACK_SEARCH);
    }
    return Boolean(env.ENABLE_SLACK_INTEGRATION);
  } catch {
    if (process.env.ENABLE_SLACK_SEARCH !== undefined && process.env.ENABLE_SLACK_SEARCH !== "") {
      return parseBool(process.env.ENABLE_SLACK_SEARCH, false);
    }
    return parseBool(process.env.ENABLE_SLACK_INTEGRATION, false);
  }
}

export function getSlackSearchUserTokenFromEnv(): string | null {
  try {
    const token = getEnv().SLACK_SEARCH_USER_TOKEN?.trim() ?? "";
    if (token) return token;
  } catch {
    // fall through
  }
  const token = (process.env.SLACK_SEARCH_USER_TOKEN ?? "").trim();
  return token || null;
}

/** Normalize OAuth redirect URIs (no trailing slash, no query/hash). */
export function normalizeSlackOAuthRedirectUri(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

/**
 * Single source of truth for Slack Search user OAuth redirect_uri.
 * Prefer SLACK_SEARCH_OAUTH_REDIRECT_URI; otherwise APP_BASE_URL + callback path.
 */
export function getSlackSearchOAuthRedirectUri(): string {
  let explicit = "";
  try {
    explicit = getEnv().SLACK_SEARCH_OAUTH_REDIRECT_URI?.trim() ?? "";
  } catch {
    explicit = (process.env.SLACK_SEARCH_OAUTH_REDIRECT_URI ?? "").trim();
  }
  if (explicit) {
    return normalizeSlackOAuthRedirectUri(explicit);
  }
  return normalizeSlackOAuthRedirectUri(
    `${getPublicAppBaseUrl()}${SLACK_SEARCH_OAUTH_CALLBACK_PATH}`,
  );
}

export function getSlackSearchRuntimeConfig(): SlackSearchRuntimeConfig {
  let integrationEnabled = false;
  let botTokenPresent = false;
  let clientId = "";
  let clientSecret = "";
  try {
    const env = getEnv();
    integrationEnabled = Boolean(env.ENABLE_SLACK_INTEGRATION);
    botTokenPresent = Boolean(env.SLACK_BOT_TOKEN?.trim());
    clientId = env.SLACK_CLIENT_ID?.trim() ?? "";
    clientSecret = env.SLACK_CLIENT_SECRET?.trim() ?? "";
  } catch {
    integrationEnabled = parseBool(process.env.ENABLE_SLACK_INTEGRATION, false);
    botTokenPresent = Boolean(process.env.SLACK_BOT_TOKEN?.trim());
    clientId = (process.env.SLACK_CLIENT_ID ?? "").trim();
    clientSecret = (process.env.SLACK_CLIENT_SECRET ?? "").trim();
  }

  const searchEnabled = isSlackSearchEnabled();
  const encryptionConfigured = isTokenEncryptionConfigured();
  const userTokenEnvPresent = Boolean(getSlackSearchUserTokenFromEnv());
  const oauthRedirectUri = getSlackSearchOAuthRedirectUri();
  const oauthRedirectUriConfigured = Boolean(
    oauthRedirectUri && oauthRedirectUri.includes(SLACK_SEARCH_OAUTH_CALLBACK_PATH),
  );
  const missingForUserOauth: string[] = [];
  if (!clientId) missingForUserOauth.push("SLACK_CLIENT_ID");
  if (!clientSecret) missingForUserOauth.push("SLACK_CLIENT_SECRET");
  if (!encryptionConfigured) {
    missingForUserOauth.push(
      "GHL_TOKEN_ENCRYPTION_KEY or GOOGLE_TOKEN_ENCRYPTION_KEY or SLACK_TOKEN_ENCRYPTION_KEY",
    );
  }

  const readyForUserOauth = searchEnabled && missingForUserOauth.length === 0;
  const oauthAuthorizeUrl =
    readyForUserOauth && clientId
      ? `https://slack.com/oauth/v2/authorize?${new URLSearchParams({
          client_id: clientId,
          scope: "",
          user_scope: SLACK_SEARCH_USER_SCOPES.join(","),
          redirect_uri: oauthRedirectUri,
        }).toString()}`
      : null;

  return {
    searchEnabled,
    integrationEnabled,
    botTokenPresent,
    clientIdPresent: Boolean(clientId),
    clientSecretPresent: Boolean(clientSecret),
    encryptionConfigured,
    userTokenEnvPresent,
    oauthRedirectUri,
    oauthRedirectUriConfigured,
    oauthAuthorizeUrl,
    missingForUserOauth,
    readyForUserOauth,
    readyForPublicBotSearch: searchEnabled && botTokenPresent,
  };
}

export function scopesToCapabilities(scopes: string[]): {
  publicChannels: boolean;
  privateChannels: boolean;
  dms: boolean;
  groupDms: boolean;
  threadContext: boolean;
  permalinks: boolean;
} {
  const set = new Set(scopes.map((s) => s.trim()).filter(Boolean));
  const has = (...names: string[]) => names.some((n) => set.has(n));
  // Legacy search:read (deprecated search API) — capability display only if an older token still has it.
  const legacySearch = has("search:read");
  return {
    publicChannels: legacySearch || has("search:read.public"),
    privateChannels: legacySearch || has("search:read.private"),
    dms: legacySearch || has("search:read.im"),
    groupDms: legacySearch || has("search:read.mpim"),
    threadContext:
      has("channels:history") ||
      has("groups:history") ||
      has("im:history") ||
      has("mpim:history") ||
      legacySearch,
    permalinks: true,
  };
}
