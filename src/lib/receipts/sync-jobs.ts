/**
 * Sync project-sourced expense_jobs from the Master Project Log.
 *
 * Every sheet row is upserted with its column J status (open / closed / unknown);
 * Site Inspections offer open ones; Receipts and Inventory offer open and closed.
 * Unknown is never offered. Project rows no longer on the sheet become closed.
 *
 * Triggers only:
 * 1. Admin "Refresh" on /admin/expense-jobs or /admin/baxter/projects
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
import {
  listExpenseJobsRaw,
  markProjectExpenseJobsClosed,
  upsertProjectExpenseJob,
  type ExpenseJobRow,
} from "./store";

export type SyncExpenseJobsTimings = {
  loadMasterProjectLogMs: number;
  upsertLoopMs: number;
  upsertCount: number;
  finalListMs: number;
  totalMs: number;
  fromCache: boolean;
};

export type SyncExpenseJobsStatusCounts = {
  open: number;
  closed: number;
  unknown: number;
};

export type SyncExpenseJobsResult = {
  upserted: number;
  added: number;
  updated: number;
  /** Project rows missing from the sheet, now marked closed. */
  deactivatedMissing: number;
  /** Sheet rows by column J status (missing rows not included). */
  statusCounts: SyncExpenseJobsStatusCounts;
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
 * Upsert every Master Project Log project into expense_jobs with its status.
 * Preserves is_active and sort_order for existing project-sourced rows.
 * Does not touch custom jobs. Does not reactivate rows an admin hid.
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
      projectStatus: row.status,
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
  const statusCounts: SyncExpenseJobsStatusCounts = { open: 0, closed: 0, unknown: 0 };
  for (const row of projects) statusCounts[row.status] += 1;

  const existing = await listExpenseJobsRaw({ includeInactive: true });
  const projectNumbers = new Set(projects.map((p) => p.projectNumber.trim().toUpperCase()));
  const orphaned = existing.filter(
    (j) =>
      j.source === "project" &&
      j.project_number &&
      !projectNumbers.has(j.project_number.trim().toUpperCase()),
  );
  // An empty read (sheet unset or unreadable) must not close every project.
  if (projects.length > 0) {
    await markProjectExpenseJobsClosed(
      orphaned.filter((j) => j.project_status !== "closed").map((j) => j.id),
      deps?.updatedBy ?? null,
    );
  }

  const listStart = Date.now();
  const rows = await listExpenseJobsRaw({ includeInactive: true });
  const finalListMs = Date.now() - listStart;

  return {
    upserted,
    added,
    updated,
    deactivatedMissing: projects.length > 0 ? orphaned.length : 0,
    statusCounts,
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
        statusCounts: result.statusCounts,
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
