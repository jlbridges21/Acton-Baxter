import "server-only";

import { getGhlRuntimeConfig, isGhlOAuthConfigured } from "./config";
import { GHL_OAUTH_AUTHORIZE_URL } from "./types";
import { getExpectedScopesFromEnv } from "./scopes";
import { isTokenEncryptionConfigured } from "@/lib/security/secret-box";

export type GhlOAuthEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGhlOAuthEnv(): GhlOAuthEnv | null {
  const config = getGhlRuntimeConfig();
  if (!config.oauthClientId || !config.oauthClientSecret || !config.oauthRedirectUri) {
    return null;
  }
  return {
    clientId: config.oauthClientId,
    clientSecret: config.oauthClientSecret,
    redirectUri: config.oauthRedirectUri,
  };
}

export function ghlOAuthAuthorizationUrl(state: string): string {
  const oauth = getGhlOAuthEnv();
  if (!oauth) {
    throw new Error("GHL OAuth is not configured");
  }

  const scopes = getExpectedScopesFromEnv();

  const params = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
  });

  return `${GHL_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export function isGhlOAuthFullyConfigured(): boolean {
  return isGhlOAuthConfigured() && isTokenEncryptionConfigured();
}

export { isGhlOAuthConfigured };
