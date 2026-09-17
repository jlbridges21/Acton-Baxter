/**
 * Sync project-sourced expense_jobs from the Master Project Log.
 *
 * Strategy: scheduled job queue (every ~15m via process-jobs cron) + admin
 * "Refresh from Master Project Log" button. Never on the `/receipts` render path.
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

  const upsertStart = Date.now();
  await mapPool(projects, UPSERT_CONCURRENCY, async (row) => {
    const label = formatProjectExpenseJobLabel(row);
    await upsertProjectExpenseJob({
      projectNumber: row.projectNumber.trim(),
      label,
      updatedBy: deps?.updatedBy ?? null,
      /** New rows land in the project band; existing sort_order is preserved. */
      defaultSortOrder: PROJECT_JOB_SORT_BAND,
    });
  });
  const upsertLoopMs = Date.now() - upsertStart;
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
