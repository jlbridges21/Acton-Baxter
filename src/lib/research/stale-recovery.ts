import "server-only";

import { listJobsForReport } from "@/lib/jobs/queue";
import { getReportStore } from "@/lib/research/report-store";

/** Generous threshold: research that sits in "researching" with no live job is abandoned. */
export const STALE_RESEARCHING_REPORT_MS = 30 * 60_000;

export const STALE_RESEARCHING_ERROR_MESSAGE =
  "Research did not finish (the background job was lost). You can retry this report.";

/**
 * If a report is stuck in "researching" longer than the threshold with no
 * queued/running property_research job, flip it to failed so the processing
 * page can offer retry instead of spinning forever.
 */
export async function recoverStaleResearchingReport(
  reportId: string,
  options?: { olderThanMs?: number; now?: Date },
): Promise<{ recovered: boolean }> {
  const store = getReportStore();
  const report = await store.getReport(reportId);
  if (!report || report.status !== "researching") {
    return { recovered: false };
  }

  const olderThanMs = options?.olderThanMs ?? STALE_RESEARCHING_REPORT_MS;
  const now = options?.now ?? new Date();
  const startedAt = report.started_at ?? report.updated_at ?? report.created_at;
  const ageMs = now.getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < olderThanMs) {
    return { recovered: false };
  }

  const activeJobs = await listJobsForReport(reportId, {
    jobTypes: ["property_research"],
    statuses: ["queued", "running"],
  });
  if (activeJobs.length > 0) {
    return { recovered: false };
  }

  await store.updateReportStatus(reportId, "failed", {
    errorMessage: STALE_RESEARCHING_ERROR_MESSAGE,
    completedAt: now.toISOString(),
  });
  return { recovered: true };
}

/** Cron/sweep: fail abandoned researching reports across the board. */
export async function recoverStaleResearchingReports(options?: {
  olderThanMs?: number;
  now?: Date;
}): Promise<{ recovered: number }> {
  const store = getReportStore();
  const researching = await store.listReports({ status: "researching" });
  let recovered = 0;
  for (const report of researching) {
    const result = await recoverStaleResearchingReport(report.id, options);
    if (result.recovered) recovered += 1;
  }
  return { recovered };
}
