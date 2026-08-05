import "server-only";

import { after } from "next/server";
import { processJob } from "@/lib/jobs/process";
import { claimJobById, enqueueJob, listJobsForReport, usesMemoryJobStore } from "@/lib/jobs/queue";

export type EnqueuePropertyResearchOptions = {
  /** Origin of the trigger — Slack keeps its own enqueue path; web/refresh/retry use this helper. */
  source?: "web" | "web_refresh" | "web_retry";
  metadata?: Record<string, unknown>;
};

/**
 * Enqueue a durable `property_research` job and kick an inline after() runner.
 *
 * Critical: the after() path must claimJobById + processJob (which completeJob/failJob),
 * otherwise the row stays `queued` and cron's claimNextJob will run the same research
 * concurrently — the Project Setup duplicate-run failure mode.
 */
export async function enqueuePropertyResearch(
  reportId: string,
  options?: EnqueuePropertyResearchOptions,
): Promise<{ jobId: string; reused: boolean }> {
  const active = await findActivePropertyResearchJob(reportId);
  if (active) {
    await scheduleInlineProcess(active.id, reportId);
    return { jobId: active.id, reused: true };
  }

  const job = await enqueueJob({
    reportId,
    jobType: "property_research",
    metadata: {
      source: options?.source ?? "web",
      ...(options?.metadata ?? {}),
    },
  });

  await scheduleInlineProcess(job.id, reportId);
  return { jobId: job.id, reused: false };
}

async function findActivePropertyResearchJob(reportId: string) {
  const jobs = await listJobsForReport(reportId, {
    jobTypes: ["property_research"],
    statuses: ["queued", "running"],
  });
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

async function scheduleInlineProcess(jobId: string, reportId: string): Promise<void> {
  const run = async () => {
    const claimed = await claimJobById(jobId);
    if (!claimed) {
      // Cron (or another after() retry) already claimed — do not double-execute.
      console.info("[property-research] after() skipped; job already claimed or finished", {
        jobId,
        reportId,
      });
      return;
    }

    await processJob(claimed);
  };

  if (usesMemoryJobStore()) {
    // Tests/mock env: run inline so claim/complete bookkeeping finishes before return.
    // Production uses after() so the HTTP response stays immediate.
    await run();
    return;
  }
  after(run);
}
