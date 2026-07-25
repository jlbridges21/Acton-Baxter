import "server-only";

import { getEnv } from "@/lib/env";
import { getActiveGoogleConnection } from "../connections";
import { getGoogleAuthMode, isGoogleOAuthConfigured } from "../oauth-config";
import { GoogleConfigError } from "../errors";
import { isPrivateKeyFormatValid } from "../auth-helpers";
import type { GoogleCredentialProvider } from "./types";
import { ServiceAccountCredentialProvider } from "./service-account";
import { WorkspaceOAuthCredentialProvider } from "./workspace-oauth";
import {
  DomainWideDelegationCredentialProvider,
  isDomainWideDelegationConfigured,
} from "./domain-wide";

export async function resolveGoogleCredentialProvider(): Promise<GoogleCredentialProvider> {
  const mode = getGoogleAuthMode();

  if (mode === "disconnected") {
    throw new GoogleConfigError(
      "Google connector is disconnected.",
      "BAXTER_GOOGLE_NOT_CONFIGURED",
    );
  }

  if (mode === "workspace_oauth") {
    const connection = await getActiveGoogleConnection().catch(() => null);
    if (connection?.auth_mode === "workspace_oauth" && connection.status !== "disconnected") {
      return new WorkspaceOAuthCredentialProvider(connection);
    }
    if (!isGoogleOAuthConfigured()) {
      // Fall back to service account if OAuth env is missing but SA exists (dev convenience).
      try {
        const env = getEnv();
        if (env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY) {
          return new ServiceAccountCredentialProvider();
        }
      } catch {
        // ignore
      }
      throw new GoogleConfigError(
        "Google Workspace OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, and GOOGLE_TOKEN_ENCRYPTION_KEY, then click Connect Google Workspace.",
        "BAXTER_GOOGLE_OAUTH_NOT_CONFIGURED",
      );
    }
    throw new GoogleConfigError(
      "No Google Workspace account is connected. Click Connect Google Workspace and sign in as baxter@actonadu.com.",
      "BAXTER_GOOGLE_OAUTH_NOT_CONFIGURED",
    );
  }

  if (mode === "domain_wide_delegation") {
    if (!isDomainWideDelegationConfigured()) {
      throw new GoogleConfigError(
        "Domain-wide delegation is not fully configured (needs GOOGLE_IMPERSONATED_USER + service account with Workspace admin authorization).",
        "BAXTER_GOOGLE_NOT_CONFIGURED",
      );
    }
    return new DomainWideDelegationCredentialProvider();
  }

  // service_account
  try {
    const env = getEnv();
    if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
      throw new GoogleConfigError(
        "Service-account mode requires GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY.",
        "BAXTER_GOOGLE_NOT_CONFIGURED",
      );
    }
    if (!isPrivateKeyFormatValid(env.GOOGLE_PRIVATE_KEY)) {
      throw new GoogleConfigError(
        "GOOGLE_PRIVATE_KEY format is invalid.",
        "BAXTER_GOOGLE_PRIVATE_KEY_INVALID",
      );
    }
  } catch (error) {
    if (error instanceof GoogleConfigError) throw error;
    throw new GoogleConfigError(
      "Service-account mode is not configured.",
      "BAXTER_GOOGLE_NOT_CONFIGURED",
    );
  }
  return new ServiceAccountCredentialProvider();
}

export function classifyGoogleApiError(status: number, bodyText: string): string {
  const lower = bodyText.toLowerCase();

  if (
    lower.includes("access_not_configured") ||
    lower.includes("api has not been used") ||
    lower.includes("is disabled") ||
    lower.includes("has not been enabled")
  ) {
    if (lower.includes("docs.googleapis.com") || lower.includes("google docs")) {
      return "BAXTER_GOOGLE_DOCS_API_DISABLED";
    }
    if (lower.includes("sheets.googleapis.com") || lower.includes("google sheets")) {
      return "BAXTER_GOOGLE_SHEETS_API_DISABLED";
    }
    if (
      lower.includes("drive.googleapis.com") ||
      lower.includes("google drive") ||
      lower.includes("drive api")
    ) {
      return "BAXTER_GOOGLE_DRIVE_API_DISABLED";
    }
    return "BAXTER_GOOGLE_DRIVE_API_DISABLED";
  }

  if (status === 404) return "BAXTER_GOOGLE_FOLDER_NOT_FOUND";
  if (status === 401) return "BAXTER_GOOGLE_AUTH_FAILED";
  if (status === 403) {
    if (
      lower.includes("shared drive") &&
      (lower.includes("outside") || lower.includes("only people inside"))
    ) {
      return "BAXTER_GOOGLE_SHARED_DRIVE_NOT_VISIBLE";
    }
    if (lower.includes("shared drive")) return "BAXTER_GOOGLE_SHARED_DRIVE_ACCESS_DENIED";
    return "BAXTER_GOOGLE_PERMISSION_DENIED";
  }
  return "BAXTER_GOOGLE_SYNC_FAILED";
}
