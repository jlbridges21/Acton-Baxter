/** Data settings overview for administrators: connection, sync history, field governance. */

import "server-only";

import { agentDb } from "@/lib/agents/store";
import { isJobTreadConfigured } from "@/lib/jobtread/client";
import {
  EXTENDED_TARGETS,
  listCustomFields,
  listSemanticFields,
  SYNCED_TARGETS,
} from "@/lib/jobtread/metadata";
import { getConnectionRow, listSyncRuns } from "@/lib/jobtread/sync";

type CachedJob = {
  job_fields: Record<string, unknown>;
  location_fields: Record<string, unknown>;
  customer_fields: Record<string, unknown>;
};

function filled(v: unknown): boolean {
  return Array.isArray(v)
    ? v.some((x) => String(x ?? "").trim() !== "")
    : v != null && String(v).trim() !== "";
}

export async function getDataSettingsOverview() {
  const [connection, runs, fields, semantic, jobs, models] = await Promise.all([
    getConnectionRow(),
    listSyncRuns(15),
    listCustomFields(),
    listSemanticFields(),
    agentDb().select<CachedJob>("jt_jobs", {
      filters: [{ col: "removed_at", op: "is_null" }],
      limit: 20000,
    }),
    agentDb().select<{ id: string }>("jt_catalog_models", {
      filters: [{ col: "removed_at", op: "is_null" }],
      limit: 5000,
    }),
  ]);
  const fillCount = new Map<string, number>();
  for (const job of jobs) {
    for (const bag of [job.job_fields, job.location_fields, job.customer_fields]) {
      for (const [id, v] of Object.entries(bag ?? {}))
        if (filled(v)) fillCount.set(id, (fillCount.get(id) ?? 0) + 1);
    }
  }
  return {
    configured: isJobTreadConfigured(),
    connection: {
      status: connection.status,
      organizationId: connection.organization_id,
      organizationName: connection.organization_name,
      grantName: connection.grant_name,
      grantExpiresAt: connection.grant_expires_at,
      grantExpiresInDays: connection.grant_expires_at
        ? Math.floor((new Date(connection.grant_expires_at).getTime() - Date.now()) / 86_400_000)
        : null,
      grantIsUnrestricted: connection.grant_is_unrestricted,
      lastTestedAt: connection.last_tested_at,
      lastError: connection.last_error,
      syncIntervalMinutes: connection.sync_interval_minutes,
      scheduledSyncEnabled: (process.env.JOBTREAD_SYNC_ENABLED ?? "false").toLowerCase() === "true",
    },
    counts: { jobs: jobs.length, models: models.length },
    runs,
    fields: fields
      .filter((f) => SYNCED_TARGETS.has(f.target_type) || EXTENDED_TARGETS.has(f.target_type))
      .map((f) => ({
        id: f.id,
        name: f.name,
        displayName: f.display_name,
        description: f.description,
        type: f.type,
        target: f.target_type,
        category: f.category,
        options: f.options.slice(0, 30),
        filled: fillCount.get(f.id) ?? 0,
      }))
      .sort((a, b) => a.target.localeCompare(b.target) || a.name.localeCompare(b.name)),
    semantic: semantic.map((s) => ({
      key: s.key,
      label: s.label,
      description: s.description,
      customFieldId: s.custom_field_id,
      updatedAt: s.updated_at,
    })),
  };
}
