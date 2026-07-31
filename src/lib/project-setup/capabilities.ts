import "server-only";

import { getActiveGoogleConnection } from "@/lib/connectors/google/connections";
import { getGoogleAuthMode } from "@/lib/connectors/google/oauth-config";
import { hasGoogleWriteScopes } from "@/lib/connectors/google/credentials/types";

/**
 * True when the active Google connection can mutate Drive/Sheets for project setup.
 * Workspace OAuth: requires full `drive` + `spreadsheets` in granted_scopes.
 * Service account / DWD: scopes are requested in the JWT (always write-capable after Prompt 2).
 */
export async function googleWritesEnabled(): Promise<boolean> {
  const mode = getGoogleAuthMode();
  if (mode === "disconnected") return false;

  if (mode === "service_account" || mode === "domain_wide_delegation") {
    return true;
  }

  const connection = await getActiveGoogleConnection().catch(() => null);
  if (!connection || connection.status === "disconnected") return false;
  return hasGoogleWriteScopes(connection.granted_scopes ?? []);
}

/** Sync helper for tests — prefer the async check in production code. */
export function googleWritesEnabledFromScopes(granted: string[]): boolean {
  return hasGoogleWriteScopes(granted);
}

/** Prompt 3 will flip this when Slack channel provisioning scopes are live. */
export function slackProvisioningEnabled(): boolean {
  return false;
}
