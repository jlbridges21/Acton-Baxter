/**
 * Schedule Master Project Log → expense_jobs sync on the shared process-jobs cron.
 * Interval: 15 minutes (cron ticks every 2m; this gates actual enqueue).
 */

import "server-only";

import { enqueueJob, listMemoryJobsForTests, usesMemoryJobStore } from "@/lib/jobs/queue";
import { createServiceClient } from "@/lib/supabase/admin";

export const EXPENSE_JOBS_SYNC_INTERVAL_MS = 15 * 60_000;

export async function maybeEnqueueScheduledExpenseJobsSync(): Promise<{
  enqueued: boolean;
  reason: string;
}> {
  try {
    const lastCompletedAt = await getLastExpenseJobsSyncCompletedAt();
    if (
      lastCompletedAt &&
      Date.now() - new Date(lastCompletedAt).getTime() < EXPENSE_JOBS_SYNC_INTERVAL_MS
    ) {
      return { enqueued: false, reason: "Sync interval not elapsed" };
    }

    let useMemory = true;
    try {
      useMemory = usesMemoryJobStore();
    } catch {
      useMemory = true;
    }

    if (useMemory) {
      const pending = listMemoryJobsForTests().some(
        (job) =>
          job.jobType === "expense_jobs_sync" &&
          (job.status === "queued" || job.status === "running"),
      );
      if (pending) return { enqueued: false, reason: "Sync job already pending" };
    } else {
      try {
        const supabase = createServiceClient();
        const { data } = await supabase
          .from("report_jobs")
          .select("id")
          .eq("job_type", "expense_jobs_sync")
          .in("status", ["queued", "running"])
          .limit(1);
        if (data && data.length > 0) {
          return { enqueued: false, reason: "Sync job already pending" };
        }
      } catch {
        // proceed best-effort
      }
    }

    await enqueueJob({
      reportId: null,
      jobType: "expense_jobs_sync",
      metadata: { source: "scheduled" },
    });
    return { enqueued: true, reason: "enqueued" };
  } catch (error) {
    console.error("Failed to enqueue expense_jobs_sync:", error);
    return { enqueued: false, reason: "error" };
  }
}

async function getLastExpenseJobsSyncCompletedAt(): Promise<string | null> {
  let useMemory = true;
  try {
    useMemory = usesMemoryJobStore();
  } catch {
    useMemory = true;
  }
  if (useMemory) {
    const completed = listMemoryJobsForTests()
      .filter((j) => j.jobType === "expense_jobs_sync" && j.status === "complete" && j.completedAt)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return completed[0]?.completedAt ?? null;
  }
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("report_jobs")
      .select("completed_at")
      .eq("job_type", "expense_jobs_sync")
      .eq("status", "complete")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.completed_at as string | null) ?? null;
  } catch {
    return null;
  }
}
