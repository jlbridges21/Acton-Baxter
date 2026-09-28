/**
 * Background Street View covers for inspections created before covers shipped.
 * The cron enqueues one job; the job stores counts and continues only when a
 * batch made progress, so a Google outage does not loop inside one request.
 */

import "server-only";

import {
  enqueueJob,
  listMemoryJobsForTests,
  patchJobMetadata,
  usesMemoryJobStore,
} from "@/lib/jobs/queue";
import type { ReportJob } from "@/lib/jobs/types";
import { createServiceClient } from "@/lib/supabase/admin";
import { backfillPendingStreetViewCovers, type StreetViewBackfillCounts } from "./records-store";

const JOB_TYPE = "site_inspection_street_view_backfill" as const;
const BATCH_LIMIT = 20;

export async function maybeEnqueueStreetViewCoverBackfill(): Promise<{ enqueued: boolean }> {
  try {
    if (await hasActiveBackfillJob()) return { enqueued: false };
    const preview = await backfillPendingStreetViewCovers({ limit: 0 });
    if (preview.remaining <= 0) return { enqueued: false };
    await enqueueJob({
      reportId: null,
      jobType: JOB_TYPE,
      metadata: { source: "cron" },
    });
    return { enqueued: true };
  } catch (error) {
    console.warn("[site-inspection] could not enqueue Street View backfill", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { enqueued: false };
  }
}

export async function runStreetViewCoverBackfillJob(
  job: ReportJob,
): Promise<StreetViewBackfillCounts> {
  const counts = await backfillPendingStreetViewCovers({ limit: BATCH_LIMIT });
  await patchJobMetadata(job.id, {
    backfilled: counts.backfilled,
    noCoverage: counts.noCoverage,
    failed: counts.failed,
    remaining: counts.remaining,
  });
  console.info("[site-inspection] Street View backfill", counts);
  const progressed = counts.backfilled + counts.noCoverage > 0;
  if (progressed && counts.remaining > 0 && !(await hasQueuedBackfillJob())) {
    await enqueueJob({
      reportId: null,
      jobType: JOB_TYPE,
      metadata: { source: "backfill_continue" },
    });
  }
  return counts;
}

async function hasActiveBackfillJob(): Promise<boolean> {
  return hasBackfillJob(["queued", "running"]);
}

async function hasQueuedBackfillJob(): Promise<boolean> {
  return hasBackfillJob(["queued"]);
}

async function hasBackfillJob(statuses: Array<"queued" | "running">): Promise<boolean> {
  if (usesMemoryJobStore()) {
    return listMemoryJobsForTests().some(
      (job) => job.jobType === JOB_TYPE && statuses.includes(job.status as "queued" | "running"),
    );
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("report_jobs")
    .select("id")
    .eq("job_type", JOB_TYPE)
    .in("status", statuses)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
