/**
 * Sync project-sourced expense_jobs from the Master Project Log.
 *
 * Strategy: on-read refresh (when listing jobs for employees or admins).
 * Why: Master Project Log already has a short TTL cache; the job list is
 * modest; hide/order are preserved via upsert on project_number; avoids a
 * new scheduled job. Admins can also trigger an explicit refresh.
 */

import "server-only";

import {
  loadMasterProjectLog,
  type LoadProjectRegistryDeps,
  type ProjectLogRow,
} from "@/lib/baxter-data/project-registry";
import { formatProjectExpenseJobLabel } from "./job-label";
import { listExpenseJobsRaw, upsertProjectExpenseJob, type ExpenseJobRow } from "./store";

export type SyncExpenseJobsResult = {
  upserted: number;
  deactivatedMissing: number;
  rows: ExpenseJobRow[];
};

/**
 * Upsert active Master Project Log projects into expense_jobs.
 * Preserves is_active and sort_order for existing project-sourced rows.
 * Does not delete custom jobs. Does not reactivate rows an admin hid.
 */
export async function syncExpenseJobsFromMasterProjectLog(
  deps?: LoadProjectRegistryDeps & {
    updatedBy?: string | null;
  },
): Promise<SyncExpenseJobsResult> {
  const loaded = await loadMasterProjectLog(deps);
  const projects = loaded.rows.filter((row) => row.projectNumber.trim());

  let upserted = 0;
  for (const row of projects) {
    const label = formatProjectExpenseJobLabel(row);
    await upsertProjectExpenseJob({
      projectNumber: row.projectNumber.trim(),
      label,
      updatedBy: deps?.updatedBy ?? null,
    });
    upserted += 1;
  }

  // Soft-deactivate project jobs whose number disappeared from the log
  // only if we want — for now leave them (admin can hide). Count for diagnostics.
  const existing = await listExpenseJobsRaw({ includeInactive: true });
  const projectNumbers = new Set(projects.map((p) => p.projectNumber.trim().toUpperCase()));
  const orphaned = existing.filter(
    (j) =>
      j.source === "project" &&
      j.project_number &&
      !projectNumbers.has(j.project_number.trim().toUpperCase()),
  );

  return {
    upserted,
    deactivatedMissing: orphaned.length,
    rows: await listExpenseJobsRaw({ includeInactive: true }),
  };
}

export function projectRowsToLabels(
  rows: ProjectLogRow[],
): Array<{ projectNumber: string; label: string }> {
  return rows
    .filter((r) => r.projectNumber.trim())
    .map((r) => ({
      projectNumber: r.projectNumber.trim(),
      label: formatProjectExpenseJobLabel(r),
    }));
}
