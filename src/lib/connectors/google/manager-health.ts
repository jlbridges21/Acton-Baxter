import "server-only";

import { getEnv } from "@/lib/env";
import { isGoogleWorkspaceConfigured, getGoogleCredentialStatus } from "./auth";
import { listGoogleSyncFolders } from "./folders";
import { listAllEnabledSelections } from "./selections";
import { getSyncedFileStats } from "./synced-files";

export type GoogleManagerHealthState =
  | "disabled"
  | "not_configured"
  | "authentication_failed"
  | "root_inaccessible"
  | "needs_selection"
  | "ready"
  | "syncing"
  | "warning"
  | "stale"
  | "offline";

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

  const creds = getGoogleCredentialStatus();
  if (!creds.configured) {
    return {
      state: "not_configured",
      label: "Not configured",
      details: "Add GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY.",
    };
  }

  if (!creds.privateKeyFormatValid) {
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
      details: "Service-account token mint failed.",
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
      state: "root_inaccessible",
      label: "Root inaccessible",
      details: "No Drive root folder is connected.",
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

  if (!isGoogleWorkspaceConfigured()) {
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
