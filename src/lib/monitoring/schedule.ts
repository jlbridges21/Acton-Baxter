import "server-only";

import { enqueueJob, listMemoryJobsForTests, usesMemoryJobStore } from "@/lib/jobs/queue";
import { createServiceClient } from "@/lib/supabase/admin";
import { getMonitoringSettings } from "@/lib/monitoring/settings";

/**
 * Enqueue a baxter_monitor_sweep job when due, without overlapping duplicates.
 * Mirrors maybeEnqueueScheduledGoogleSync: interval gating + already-queued/running check.
 */
export async function maybeEnqueueScheduledMonitoringSweep(): Promise<{
  enqueued: boolean;
  reason: string;
}> {
  try {
    const settings = await getMonitoringSettings();
    if (!settings.enabled) {
      return { enqueued: false, reason: "monitoring_disabled" };
    }

    const intervalMinutes = Math.max(1, settings.sweep_interval_minutes || 15);
    const intervalMs = intervalMinutes * 60_000;

    const lastCompletedAt = await getLastSuccessfulSweepCompletedAt();
    if (lastCompletedAt && Date.now() - new Date(lastCompletedAt).getTime() < intervalMs) {
      return { enqueued: false, reason: "Sweep interval not elapsed" };
    }

    if (usesMemoryJobStore()) {
      const pending = listMemoryJobsForTests().some(
        (job) =>
          job.jobType === "baxter_monitor_sweep" &&
          (job.status === "queued" || job.status === "running"),
      );
      if (pending) return { enqueued: false, reason: "Sweep job already pending" };
    } else {
      try {
        const supabase = createServiceClient();
        const { data } = await supabase
          .from("report_jobs")
          .select("id")
          .eq("job_type", "baxter_monitor_sweep")
          .in("status", ["queued", "running"])
          .limit(1);
        if (data && data.length > 0) {
          return { enqueued: false, reason: "Sweep job already pending" };
        }
      } catch {
        // proceed best-effort
      }
    }

    await enqueueJob({
      reportId: null,
      jobType: "baxter_monitor_sweep",
      metadata: { source: "scheduled" },
    });
    return { enqueued: true, reason: "enqueued" };
  } catch (error) {
    console.error("Failed to enqueue monitoring sweep:", error);
    return { enqueued: false, reason: "error" };
  }
}

async function getLastSuccessfulSweepCompletedAt(): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("monitoring_runs")
      .select("completed_at")
      .in("status", ["success", "partial"])
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.completed_at as string | null) ?? null;
  } catch {
    return null;
  }
}
