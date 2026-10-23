import "server-only";

import { isJobTreadConfigured } from "@/lib/jobtread/client";
import {
  getConnectionRow,
  lastSuccessfulSync,
  listSyncRuns,
  type ConnectionRow,
  type SyncRunRow,
} from "@/lib/jobtread/sync";
import type { ConnectorHealth } from "../types";

const NAME = "JobTread";

/** Maps the JobTread grant check and sync history to the Connectors dashboard card. Never reads the grant key. */
export function jobTreadHealthFrom(input: {
  configured: boolean;
  row: ConnectionRow | null;
  lastSuccess: SyncRunRow | null;
  latest: SyncRunRow | null;
}): ConnectorHealth {
  const { configured, row, lastSuccess, latest } = input;
  const base = {
    key: "jobtread" as const,
    name: NAME,
    lastSyncAt: lastSuccess?.finished_at ?? null,
    itemsSynced: lastSuccess?.records_seen ?? null,
  };
  if (!configured) {
    return {
      ...base,
      status: "offline",
      label: "Not configured",
      lastError: null,
      details:
        "Read-only job and catalog data for Dexter's reports. Missing setting: JOBTREAD_GRANT_KEY.",
    };
  }
  // "Acton ADU: …" once the grant check has named the organization; plain text before that.
  const org = row?.organization_name ? `${row.organization_name}: ` : "";
  const every = row?.sync_interval_minutes
    ? ` Syncs every ${row.sync_interval_minutes} minutes.`
    : "";
  const lastRunFailed = latest?.status === "failed";
  if (row?.status === "error") {
    return {
      ...base,
      status: "offline",
      label: "Error",
      lastError: row.last_error,
      details: `${org}The grant check failed. Test the connection from Reports → Data settings.`,
    };
  }
  if (!lastSuccess) {
    return {
      ...base,
      status: "warning",
      label: row?.status === "connected" ? "Not synced yet" : "Not verified",
      lastError: lastRunFailed ? latest!.error : (row?.last_error ?? null),
      details: `${org}Run a sync from Reports → Data settings.${every}`,
    };
  }
  if (lastRunFailed) {
    return {
      ...base,
      status: "warning",
      label: "Last sync failed",
      lastError: latest!.error,
      details: `${org}Showing data from the last successful sync.${every}`,
    };
  }
  return {
    ...base,
    status: "healthy",
    label: "Connected",
    lastError: null,
    details: `${org}Read-only grant for Dexter's reports and the data catalog.${every}`,
  };
}

export async function JobTreadConnectorHealth(): Promise<ConnectorHealth> {
  const configured = isJobTreadConfigured();
  try {
    const [row, lastSuccess, [latest]] = configured
      ? await Promise.all([getConnectionRow(), lastSuccessfulSync(), listSyncRuns(1)])
      : [null, null, []];
    return jobTreadHealthFrom({ configured, row, lastSuccess, latest: latest ?? null });
  } catch (error) {
    return {
      key: "jobtread",
      name: NAME,
      status: "offline",
      label: "Unavailable",
      lastSyncAt: null,
      lastError: error instanceof Error ? error.message : "Couldn't read the sync history.",
      itemsSynced: null,
      details: "Couldn't read the JobTread connection (has the reports migration been applied?).",
    };
  }
}
