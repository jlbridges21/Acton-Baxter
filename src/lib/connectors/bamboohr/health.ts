import "server-only";

import { configProblems, getConnection, type ConnectionRow } from "@/lib/bamboohr/connection";
import { missingScopes } from "@/lib/bamboohr/scopes";
import type { ConnectorHealth } from "../types";

const NAME = "BambooHR";

/** Maps the stored BambooHR OAuth connection to the Connectors dashboard card. Never reads tokens. */
export function bambooHealthFrom(row: ConnectionRow | null, problems: string[]): ConnectorHealth {
  const base = { key: "bamboohr" as const, name: NAME, itemsSynced: null };
  if (problems.length) {
    return {
      ...base,
      status: "offline",
      label: "Not configured",
      lastSyncAt: null,
      lastError: null,
      details: `Read-only employee directory for Sam. Missing settings: ${problems.join(", ")}.`,
    };
  }
  if (!row || row.status === "disconnected") {
    return {
      ...base,
      status: "warning",
      label: "Not connected",
      lastSyncAt: row?.last_success_at ?? null,
      lastError: null,
      details:
        "Configured but not connected. An administrator can connect it from Sam Operations → Setup.",
    };
  }
  const company = row.company_name ?? row.company_domain;
  const lastSyncAt = row.last_success_at;
  if (row.status === "reauthorization_required") {
    return {
      ...base,
      status: "warning",
      label: "Reconnect required",
      lastSyncAt,
      lastError: row.last_error,
      details: `${company}: the authorization expired or was revoked. Reconnect from Sam Operations → Setup.`,
    };
  }
  if (row.status === "error") {
    return {
      ...base,
      status: "offline",
      label: "Error",
      lastSyncAt,
      lastError: row.last_error,
      details: `${company}: the last request to BambooHR failed.`,
    };
  }
  const missing = missingScopes(row.requested_scopes, row.granted_scopes);
  if (missing.length) {
    return {
      ...base,
      status: "warning",
      label: "Limited access",
      lastSyncAt,
      lastError: row.last_error,
      details: `${company}: connected read-only, but some permissions weren't granted (${missing.join(", ")}).`,
    };
  }
  return {
    ...base,
    status: "healthy",
    label: "Connected",
    lastSyncAt,
    lastError: null,
    details: `${company}: connected read-only${row.connected_email ? ` by ${row.connected_email}` : ""}. Used by Sam for employee directory lookups; Baxter never writes to BambooHR.`,
  };
}

export async function BambooHRConnectorHealth(): Promise<ConnectorHealth> {
  const problems = configProblems();
  try {
    return bambooHealthFrom(problems.length ? null : await getConnection(), problems);
  } catch (error) {
    return {
      key: "bamboohr",
      name: NAME,
      status: "offline",
      label: "Unavailable",
      lastSyncAt: null,
      lastError: error instanceof Error ? error.message : "Couldn't read the connection.",
      itemsSynced: null,
      details: "Couldn't read the BambooHR connection (has migration 072 been applied?).",
    };
  }
}
