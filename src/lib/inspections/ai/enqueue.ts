/**
 * Enqueue site-inspection AI (transcribe + summarize) after Complete.
 * after() inline + cron backup via report_jobs.
 */

import "server-only";

import { after } from "next/server";
import { processJob } from "@/lib/jobs/process";
import {
  claimJobById,
  enqueueJob,
  listMemoryJobsForTests,
  usesMemoryJobStore,
} from "@/lib/jobs/queue";
import type { ReportJob } from "@/lib/jobs/types";
import { createServiceClient } from "@/lib/supabase/admin";
import { patchInspectionAiProgress } from "./store";

export async function enqueueSiteInspectionAi(
  inspectionId: string,
  options?: { force?: boolean },
): Promise<{ jobId: string; reused: boolean } | null> {
  const active = await findActiveSiteInspectionAiJob(inspectionId);
  if (active && !options?.force) {
    await scheduleInlineProcess(active.id, inspectionId);
    return { jobId: active.id, reused: true };
  }

  await patchInspectionAiProgress(inspectionId, {
    ai_processing_status: "queued",
    ai_processing_message: "Queued for transcription…",
    ai_processing_phase: "transcribing",
    ai_processing_summaries_total: 0,
    ai_processing_summaries_done: 0,
    ai_processing_started_at: new Date().toISOString(),
    ai_processing_finished_at: null,
  });

  const job = await enqueueJob({
    reportId: null,
    jobType: "site_inspection_ai",
    metadata: {
      inspectionId,
      source: "inspection_complete",
    },
  });

  await scheduleInlineProcess(job.id, inspectionId);
  return { jobId: job.id, reused: false };
}

async function findActiveSiteInspectionAiJob(inspectionId: string): Promise<ReportJob | null> {
  if (usesMemoryJobStore()) {
    const jobs = listMemoryJobsForTests().filter(
      (j) =>
        j.jobType === "site_inspection_ai" &&
        j.metadata.inspectionId === inspectionId &&
        (j.status === "queued" || j.status === "running"),
    );
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("report_jobs")
    .select("*")
    .eq("job_type", "site_inspection_ai")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(40);
  if (error || !data?.length) return null;

  for (const row of data) {
    const meta = (row.metadata_json ?? {}) as Record<string, unknown>;
    if (meta.inspectionId === inspectionId) {
      return {
        id: row.id as string,
        reportId: (row.report_id as string | null) ?? null,
        jobType: row.job_type,
        status: row.status,
        attempts: row.attempts as number,
        availableAt: row.available_at as string,
        lockedAt: (row.locked_at as string | null) ?? null,
        completedAt: (row.completed_at as string | null) ?? null,
        lastError: (row.last_error as string | null) ?? null,
        metadata: meta,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      };
    }
  }
  return null;
}

async function scheduleInlineProcess(jobId: string, inspectionId: string): Promise<void> {
  const run = async () => {
    const claimed = await claimJobById(jobId);
    if (!claimed) {
      console.info("[site-inspection-ai] after() skipped; job already claimed or finished", {
        jobId,
        inspectionId,
      });
      return;
    }
    await processJob(claimed);
  };

  if (usesMemoryJobStore()) {
    await run();
    return;
  }
  after(run);
}
