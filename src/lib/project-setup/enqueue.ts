import "server-only";

import { after } from "next/server";
import {
  claimJobById,
  completeJob,
  enqueueJob,
  failJob,
  usesMemoryJobStore,
} from "@/lib/jobs/queue";
import { runProjectSetupJob } from "./runner";

/**
 * Enqueue a durable project_setup job and kick an inline after() runner.
 *
 * Critical: the after() path must claimJobById + completeJob/failJob, otherwise the
 * row stays `queued` and cron's claimNextJob will run the same setup concurrently.
 */
export async function enqueueProjectSetupRun(runId: string): Promise<{ jobId: string }> {
  const job = await enqueueJob({
    reportId: null,
    jobType: "project_setup",
    metadata: { projectSetupRunId: runId },
  });

  const run = async () => {
    const claimed = await claimJobById(job.id);
    if (!claimed) {
      // Cron (or another after() retry) already claimed — do not double-execute.
      console.info("[project-setup] after() skipped; job already claimed or finished", {
        jobId: job.id,
        runId,
      });
      return;
    }

    try {
      const result = await runProjectSetupJob(runId, { jobId: claimed.id });
      if (result.skippedBusy) {
        // Another executor holds the run lock. Requeue so we do not mark complete while
        // that executor is still working (same pattern as cron JobDeferredError).
        await failJob(claimed.id, "Project setup run is already executing", {
          retryAt: new Date(Date.now() + 15_000).toISOString(),
        });
        return;
      }
      if (result.status === "failed") {
        // Terminal for this attempt — do not auto-retry via failJob(retryAt); operator retries.
        await failJob(claimed.id, result.error ?? "Project setup run failed");
        return;
      }
      await completeJob(claimed.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project setup job failed";
      console.error("[project-setup] job failed", { runId, jobId: claimed.id, message });
      await failJob(claimed.id, message);
    }
  };

  if (usesMemoryJobStore()) {
    await run();
  } else {
    after(run);
  }

  return { jobId: job.id };
}
