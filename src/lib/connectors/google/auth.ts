import "server-only";

import { getEnv } from "@/lib/env";
import { GoogleConnectorError } from "./errors";
import { isPrivateKeyFormatValid, normalizePrivateKey } from "./auth-helpers";
import { classifyGoogleApiError, resolveGoogleCredentialProvider } from "./credentials/resolve";
import { getGoogleAuthMode, isGoogleOAuthConfigured } from "./oauth-config";
import { getActiveGoogleConnectionPublic } from "./connections";
import { isDomainWideDelegationConfigured } from "./credentials/domain-wide";
import { clearServiceAccountTokenCacheForTests } from "./credentials/service-account";
import { clearWorkspaceOauthTokenCacheForTests } from "./credentials/workspace-oauth";

export { normalizePrivateKey, isPrivateKeyFormatValid };

export function isGoogleWorkspaceConfigured(): boolean {
  const mode = getGoogleAuthMode();
  if (mode === "workspace_oauth") {
    if (isGoogleOAuthConfigured()) return true;
  }
  if (mode === "domain_wide_delegation") {
    return isDomainWideDelegationConfigured();
  }
  try {
    const env = getEnv();
    return Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY);
  } catch {
    return false;
  }
}

export function getGoogleCredentialStatus(): {
  configured: boolean;
  authMode: string;
  oauthConfigured: boolean;
  projectIdPresent: boolean;
  clientEmail: string | null;
  privateKeyFormatValid: boolean;
  rootFolderConfigured: boolean;
  rootFolderRaw: string | null;
  impersonatedUser: string | null;
  domainWideDelegationAvailable: boolean;
  serviceAccountExternalWarning: string;
} {
  const authMode = getGoogleAuthMode();
  try {
    const env = getEnv();
    return {
      configured:
        authMode === "workspace_oauth"
          ? isGoogleOAuthConfigured()
          : authMode === "domain_wide_delegation"
            ? isDomainWideDelegationConfigured()
            : Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY),
      authMode,
      oauthConfigured: isGoogleOAuthConfigured(),
      projectIdPresent: Boolean(env.GOOGLE_PROJECT_ID?.trim()),
      clientEmail: env.GOOGLE_CLIENT_EMAIL?.trim() || null,
      privateKeyFormatValid: isPrivateKeyFormatValid(env.GOOGLE_PRIVATE_KEY),
      rootFolderConfigured: Boolean(env.GOOGLE_DRIVE_ROOT_FOLDER?.trim()),
      rootFolderRaw: env.GOOGLE_DRIVE_ROOT_FOLDER?.trim() || null,
      impersonatedUser: (process.env.GOOGLE_IMPERSONATED_USER ?? "").trim() || null,
      domainWideDelegationAvailable: isDomainWideDelegationConfigured(),
      serviceAccountExternalWarning:
        "This service account is external to the Acton ADU Workspace unless domain-wide delegation is configured. It may not be able to access Shared Drives restricted to internal members.",
    };
  } catch {
    return {
      configured: false,
      authMode,
      oauthConfigured: isGoogleOAuthConfigured(),
      projectIdPresent: false,
      clientEmail: null,
      privateKeyFormatValid: false,
      rootFolderConfigured: false,
      rootFolderRaw: null,
      impersonatedUser: null,
      domainWideDelegationAvailable: false,
      serviceAccountExternalWarning:
        "This service account is external to the Acton ADU Workspace unless domain-wide delegation is configured.",
    };
  }
}

export async function mintAccessToken(): Promise<string> {
  const provider = await resolveGoogleCredentialProvider();
  return provider.getAccessToken();
}

export async function googleFetch<T>(
  url: string,
  init?: RequestInit & { rawText?: boolean },
): Promise<T> {
  const token = await mintAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const code = classifyGoogleApiError(response.status, text);
    throw new GoogleConnectorError(
      `Google API request failed (${response.status}): ${text.slice(0, 200)}`,
      { statusCode: response.status, code, expose: true },
    );
  }

  if (init?.rawText) {
    return (await response.text()) as T;
  }
  return (await response.json()) as T;
}

export async function getGoogleConnectionSnapshot() {
  const status = getGoogleCredentialStatus();
  const connection = await getActiveGoogleConnectionPublic().catch(() => null);
  return {
    ...status,
    connection,
  };
}

export function clearGoogleTokenCacheForTests() {
  clearServiceAccountTokenCacheForTests();
  clearWorkspaceOauthTokenCacheForTests();
}
