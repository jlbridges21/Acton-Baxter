/**
 * Sync project-sourced expense_jobs from the Master Project Log.
 *
 * Triggers only:
 * 1. Admin "Refresh from Master Project Log" on /admin/expense-jobs
 * 2. After a successful live (non-dry-run) Project Setup run completes
 *
 * Never on the `/receipts` render path. Never on a scheduled cron.
 */

import "server-only";

import {
  loadMasterProjectLog,
  type LoadProjectRegistryDeps,
  type ProjectLogRow,
} from "@/lib/baxter-data/project-registry";
import { formatProjectExpenseJobLabel } from "./job-label";
import { PROJECT_JOB_SORT_BAND } from "./job-sort";
import { listExpenseJobsRaw, upsertProjectExpenseJob, type ExpenseJobRow } from "./store";

export type SyncExpenseJobsTimings = {
  loadMasterProjectLogMs: number;
  upsertLoopMs: number;
  upsertCount: number;
  finalListMs: number;
  totalMs: number;
  fromCache: boolean;
};

export type SyncExpenseJobsResult = {
  upserted: number;
  added: number;
  updated: number;
  deactivatedMissing: number;
  rows: ExpenseJobRow[];
  timings: SyncExpenseJobsTimings;
};

const UPSERT_CONCURRENCY = 8;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]!);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

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
  const totalStart = Date.now();

  const loadStart = Date.now();
  const loaded = await loadMasterProjectLog(deps);
  const loadMasterProjectLogMs = Date.now() - loadStart;

  const projects = loaded.rows.filter((row) => row.projectNumber.trim());

  const existingBefore = await listExpenseJobsRaw({ includeInactive: true });
  const existingProjectKeys = new Set(
    existingBefore
      .filter((j) => j.source === "project" && j.project_number)
      .map((j) => j.project_number!.trim().toUpperCase()),
  );

  const upsertStart = Date.now();
  const outcomes = await mapPool(projects, UPSERT_CONCURRENCY, async (row) => {
    const key = row.projectNumber.trim().toUpperCase();
    const existed = existingProjectKeys.has(key);
    const label = formatProjectExpenseJobLabel(row);
    await upsertProjectExpenseJob({
      projectNumber: row.projectNumber.trim(),
      label,
      updatedBy: deps?.updatedBy ?? null,
      /** New rows land in the project band; existing sort_order is preserved. */
      defaultSortOrder: PROJECT_JOB_SORT_BAND,
    });
    return existed ? ("updated" as const) : ("added" as const);
  });
  const upsertLoopMs = Date.now() - upsertStart;
  const added = outcomes.filter((o) => o === "added").length;
  const updated = outcomes.filter((o) => o === "updated").length;
  const upserted = projects.length;

  const existing = await listExpenseJobsRaw({ includeInactive: true });
  const projectNumbers = new Set(projects.map((p) => p.projectNumber.trim().toUpperCase()));
  const orphaned = existing.filter(
    (j) =>
      j.source === "project" &&
      j.project_number &&
      !projectNumbers.has(j.project_number.trim().toUpperCase()),
  );

  const listStart = Date.now();
  const rows = await listExpenseJobsRaw({ includeInactive: true });
  const finalListMs = Date.now() - listStart;

  return {
    upserted,
    added,
    updated,
    deactivatedMissing: orphaned.length,
    rows,
    timings: {
      loadMasterProjectLogMs,
      upsertLoopMs,
      upsertCount: upserted,
      finalListMs,
      totalMs: Date.now() - totalStart,
      fromCache: loaded.fromCache,
    },
  };
}

/**
 * Best-effort sync after Project Setup — never throws; logs outcomes for diagnosis.
 */
export async function syncExpenseJobsAfterProjectSetup(runId: string): Promise<void> {
  try {
    const result = await syncExpenseJobsFromMasterProjectLog({
      updatedBy: null,
    });
    console.info(
      JSON.stringify({
        event: "expense_jobs_sync_after_project_setup",
        runId,
        ok: true,
        added: result.added,
        updated: result.updated,
        upserted: result.upserted,
        deactivatedMissing: result.deactivatedMissing,
        totalMs: result.timings.totalMs,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "expense_jobs_sync_after_project_setup",
        runId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
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
