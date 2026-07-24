import "server-only";

import { getEnv } from "@/lib/env";
import { enqueueJob, listMemoryJobsForTests, usesMemoryJobStore } from "@/lib/jobs/queue";
import { createServiceClient } from "@/lib/supabase/admin";
import { listGoogleSyncFolders } from "@/lib/connectors/google/folders";
import { isGoogleWorkspaceConfigured } from "@/lib/connectors/google/auth";

/**
 * Enqueue a google_knowledge_sync job when due, without overlapping duplicates.
 */
export async function maybeEnqueueScheduledGoogleSync(): Promise<{
  enqueued: boolean;
  reason: string;
}> {
  const env = getEnv();
  if (!env.GOOGLE_SYNC_ENABLED) {
    return { enqueued: false, reason: "GOOGLE_SYNC_ENABLED is false" };
  }
  if (!isGoogleWorkspaceConfigured()) {
    return { enqueued: false, reason: "Google credentials not configured" };
  }

  const folders = await listGoogleSyncFolders();
  const active = folders.filter((folder) => folder.status === "active");
  if (active.length === 0 && !env.GOOGLE_DRIVE_ROOT_FOLDER) {
    return { enqueued: false, reason: "No active sync folders" };
  }

  const intervalMs = env.GOOGLE_SYNC_INTERVAL_MINUTES * 60_000;
  const lastSync =
    folders
      .map((folder) => folder.last_sync_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  if (lastSync && Date.now() - new Date(lastSync).getTime() < intervalMs) {
    return { enqueued: false, reason: "Sync interval not elapsed" };
  }

  // Avoid overlapping queued/running google sync jobs
  if (usesMemoryJobStore()) {
    const pending = listMemoryJobsForTests().some(
      (job) =>
        job.jobType === "google_knowledge_sync" &&
        (job.status === "queued" || job.status === "running"),
    );
    if (pending) return { enqueued: false, reason: "Sync job already pending" };
  } else {
    try {
      const supabase = createServiceClient();
      const { data } = await supabase
        .from("report_jobs")
        .select("id")
        .eq("job_type", "google_knowledge_sync")
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
    jobType: "google_knowledge_sync",
    metadata: { source: "scheduled" },
  });
  return { enqueued: true, reason: "enqueued" };
}
