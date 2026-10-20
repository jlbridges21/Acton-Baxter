/**
 * Master Project Log sync state, read off the project rows in expense_jobs.
 * Client-safe: no server imports.
 */

import type { ExpenseJob, ExpenseJobProjectStatus } from "./types";

export type ProjectJobSyncSummary = {
  /**
   * Latest `updated_at` among project rows. Every refresh rewrites each project row,
   * so this is the last refresh unless an admin edited a project row since.
   */
  lastRefreshedAt: string | null;
  projectRows: number;
  counts: Record<ExpenseJobProjectStatus, number>;
};

export function summarizeProjectJobSync(
  jobs: readonly Pick<ExpenseJob, "source" | "projectStatus" | "updatedAt">[],
): ProjectJobSyncSummary {
  const counts: Record<ExpenseJobProjectStatus, number> = { open: 0, closed: 0, unknown: 0 };
  let lastRefreshedAt: string | null = null;
  let lastMs = -Infinity;
  let projectRows = 0;
  for (const job of jobs) {
    if (job.source !== "project") continue;
    projectRows += 1;
    counts[job.projectStatus] += 1;
    const ms = Date.parse(job.updatedAt);
    if (Number.isFinite(ms) && ms > lastMs) {
      lastMs = ms;
      lastRefreshedAt = job.updatedAt;
    }
  }
  return { lastRefreshedAt, projectRows, counts };
}

/** True when project rows exist but none has an Open/Closed status yet. */
export function projectStatusesUnread(summary: ProjectJobSyncSummary): boolean {
  return summary.projectRows > 0 && summary.counts.unknown === summary.projectRows;
}
