import "server-only";

import { getEnv } from "@/lib/env";
import { getGoogleCredentialStatus, isGoogleWorkspaceConfigured } from "./auth";
import { listGoogleSyncFolders } from "./folders";
import { listAllEnabledSelections } from "./selections";
import { getSyncedFileStats } from "./synced-files";
import { getActiveGoogleConnectionPublic } from "./connections";
import { getGoogleAuthMode, isGoogleOAuthConfigured } from "./oauth-config";

export type GoogleManagerHealthState =
  | "disconnected"
  | "oauth_not_configured"
  | "connection_pending"
  | "connected"
  | "access_limited"
  | "needs_root"
  | "needs_selection"
  | "ready"
  | "syncing"
  | "warning"
  | "reauthorization_required"
  | "offline"
  | "disabled"
  | "not_configured"
  | "authentication_failed"
  | "root_inaccessible"
  | "stale";

export async function computeGoogleManagerHealth(input?: {
  authenticated?: boolean;
  syncing?: boolean;
}): Promise<{
  state: GoogleManagerHealthState;
  label: string;
  details: string;
}> {
  let syncEnabled = true;
  let intervalMinutes = 180;
  try {
    const env = getEnv();
    syncEnabled = env.GOOGLE_SYNC_ENABLED;
    intervalMinutes = env.GOOGLE_SYNC_INTERVAL_MINUTES;
  } catch {
    // defaults
  }

  const mode = getGoogleAuthMode();
  const creds = getGoogleCredentialStatus();
  const connection = await getActiveGoogleConnectionPublic().catch(() => null);

  if (mode === "disconnected" || connection?.status === "disconnected") {
    if (!connection && mode === "workspace_oauth" && !isGoogleOAuthConfigured()) {
      return {
        state: "oauth_not_configured",
        label: "OAuth not configured",
        details:
          "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, and GOOGLE_TOKEN_ENCRYPTION_KEY.",
      };
    }
    if (!connection && mode === "workspace_oauth") {
      return {
        state: "disconnected",
        label: "Disconnected",
        details: "Click Connect Google Workspace and sign in as baxter@actonadu.com.",
      };
    }
  }

  if (connection?.status === "reauthorization_required") {
    return {
      state: "reauthorization_required",
      label: "Reauthorization required",
      details: connection.last_error_message_safe ?? "Reconnect Google Workspace.",
    };
  }

  if (mode === "workspace_oauth") {
    if (!isGoogleOAuthConfigured() && !connection) {
      return {
        state: "oauth_not_configured",
        label: "OAuth not configured",
        details: "Google OAuth environment variables are missing.",
      };
    }
    if (!connection) {
      return {
        state: "disconnected",
        label: "Disconnected",
        details: "Connect Google Workspace to browse Shared Drives.",
      };
    }
  } else if (!creds.configured) {
    return {
      state: "not_configured",
      label: "Not configured",
      details: "Add service-account credentials or switch to workspace_oauth.",
    };
  }

  if (mode === "service_account" && !creds.privateKeyFormatValid) {
    return {
      state: "authentication_failed",
      label: "Authentication failed",
      details: "GOOGLE_PRIVATE_KEY format looks invalid.",
    };
  }

  if (input?.authenticated === false) {
    return {
      state: "authentication_failed",
      label: "Authentication failed",
      details: "Could not obtain a Google access token.",
    };
  }

  if (input?.syncing) {
    return {
      state: "syncing",
      label: "Syncing",
      details: "A Google sync job is running.",
    };
  }

  const folders = await listGoogleSyncFolders();
  const active = folders.filter((f) => f.status === "active");
  if (active.length === 0 && !creds.rootFolderConfigured) {
    return {
      state: "needs_root",
      label: "Needs root",
      details: "Browse Shared Drives or My Drive and connect a Knowledge root.",
    };
  }

  if (folders.some((f) => f.status === "error")) {
    return {
      state: "warning",
      label: "Warning",
      details: "One or more roots reported sync errors.",
    };
  }

  const selections = await listAllEnabledSelections();
  const includes = selections.filter((s) => s.enabled && !s.explicitly_excluded);
  if (includes.length === 0) {
    return {
      state: "needs_selection",
      label: "Needs selection",
      details: "Browse Drive and add files or folders to Baxter before syncing.",
    };
  }

  const stats = await getSyncedFileStats();
  if (stats.failed > 0 && stats.synced > 0) {
    return {
      state: "warning",
      label: "Warning",
      details: `${stats.failed} file(s) failed; others are synced.`,
    };
  }

  const lastSuccess =
    folders
      .map((f) => f.last_success_at || f.last_sync_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

  if (lastSuccess) {
    const overdueMs = intervalMinutes * 60_000 * 2;
    if (Date.now() - new Date(lastSuccess).getTime() > overdueMs) {
      return {
        state: "stale",
        label: "Stale",
        details: `No successful sync within ~${intervalMinutes * 2} minutes.`,
      };
    }
  }

  if (!syncEnabled) {
    return {
      state: "disabled",
      label: "Scheduled sync disabled",
      details: "GOOGLE_SYNC_ENABLED=false. Manual sync still works.",
    };
  }

  if (!isGoogleWorkspaceConfigured() && !connection) {
    return {
      state: "offline",
      label: "Offline",
      details: "Google connector cannot authenticate.",
    };
  }

  return {
    state: "ready",
    label: "Ready",
    details: `${includes.length} selection(s), ${stats.synced} synced file(s).`,
  };
}
