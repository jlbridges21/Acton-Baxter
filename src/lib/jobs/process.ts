import "server-only";

import { getEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import { runPropertyResearch } from "@/lib/research/run-property-research";
import { getReportStore } from "@/lib/research/report-store";
import { postSlackMessage } from "@/lib/slack/client";
import { buildSlackCompletionMessage, buildSlackFailureMessage } from "@/lib/slack/messages";
import { claimNextJob, completeJob, failJob, reclaimStaleRunningJobs } from "./queue";
import type { ReportJob } from "./types";

class JobDeferredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobDeferredError";
  }
}

async function processPropertyResearch(job: ReportJob): Promise<void> {
  if (!job.reportId) {
    throw new Error("property_research job requires reportId");
  }
  await runPropertyResearch(job.reportId);
}

async function processSlackCompletionNotification(job: ReportJob): Promise<void> {
  if (!job.reportId) {
    throw new Error("slack_completion_notification job requires reportId");
  }

  const env = getEnv();
  if (!env.ENABLE_SLACK_INTEGRATION) {
    return;
  }

  const store = getReportStore();
  const report = await store.getFullReport(job.reportId);
  if (!report) {
    throw new Error("Report not found for Slack notification");
  }

  const channel =
    (typeof job.metadata.slackChannelId === "string" && job.metadata.slackChannelId) || null;
  if (!channel) {
    throw new Error("Slack channel missing from job metadata");
  }

  if (report.status === "researching" || report.status === "queued") {
    throw new JobDeferredError("Report not complete yet");
  }

  if (report.status === "failed") {
    const message = buildSlackFailureMessage({
      standardizedAddress: report.standardized_address ?? report.input_address,
      reportId: report.id,
      errorMessage: report.error_message,
    });
    await postSlackMessage({
      channel,
      text: message.text,
      blocks: message.blocks,
    });
    return;
  }

  const conflictCount = report.conflicts?.length ?? 0;
  const summarySnippet = report.summary
    ? report.summary
        .split(/(?<=\.)\s+/)
        .slice(0, 2)
        .join(" ")
    : null;

  const message = buildSlackCompletionMessage({
    standardizedAddress: report.standardized_address ?? report.input_address,
    apn: report.apn,
    jurisdiction: report.jurisdiction_name,
    summarySnippet,
    reportId: report.id,
    conflictCount,
  });

  await postSlackMessage({
    channel,
    text: message.text,
    blocks: message.blocks,
  });
}

async function processGoogleKnowledgeSync(job: ReportJob): Promise<void> {
  const { getGoogleConnector } = await import("@/lib/connectors/registry");
  const folderId = typeof job.metadata.folderId === "string" ? job.metadata.folderId : undefined;
  const trigger =
    job.metadata.source === "scheduled"
      ? "cron"
      : job.metadata.source === "admin_manual"
        ? "manual"
        : "admin";
  await getGoogleConnector().sync({
    folderId,
    triggerSource: trigger as "manual" | "cron" | "admin",
    jobId: job.id,
  });
}

async function processSlackBaxterReply(job: ReportJob): Promise<void> {
  const { processSlackBaxterReplyJob } = await import("@/lib/slack/baxter-events");
  await processSlackBaxterReplyJob(job.metadata, { jobId: job.id });
}

async function processBaxterMonitorSweep(_job: ReportJob): Promise<void> {
  const { runMonitoringSweep } = await import("@/lib/monitoring");
  await runMonitoringSweep({
    trigger: "job",
  });
}

async function processBaxterAlertDelivery(_job: ReportJob): Promise<void> {
  const { deliverPendingAlerts } = await import("@/lib/monitoring");
  await deliverPendingAlerts();
}

async function processSlackMonitoringReaction(job: ReportJob): Promise<void> {
  const { handleMonitoringReaction } = await import("@/lib/slack/baxter-events");
  await handleMonitoringReaction(job.metadata);
}

async function processPemNeatGenerate(job: ReportJob): Promise<void> {
  const pemNeatId = typeof job.metadata.pemNeatId === "string" ? job.metadata.pemNeatId : null;
  if (!pemNeatId) {
    throw new Error("pem_neat_generate job requires metadata.pemNeatId");
  }
  const { getPemNeatStore } = await import("@/lib/pem-neat/store");
  const existing = await getPemNeatStore().get(pemNeatId);
  // Prefer Next.js after() runner; cron is a durable backup if still generating.
  if (!existing || existing.status !== "generating") {
    return;
  }
  const { runPemNeatGenerationJob } = await import("@/lib/pem-neat/run-generation");
  await runPemNeatGenerationJob(pemNeatId);
}

async function processProjectSetup(job: ReportJob): Promise<void> {
  const runId =
    typeof job.metadata.projectSetupRunId === "string" ? job.metadata.projectSetupRunId : null;
  if (!runId) {
    throw new Error("project_setup job requires metadata.projectSetupRunId");
  }
  const { runProjectSetupJob } = await import("@/lib/project-setup/runner");
  const result = await runProjectSetupJob(runId, { jobId: job.id });
  if (result.skippedBusy) {
    // Another executor holds the run lock — do not mark this job complete.
    throw new JobDeferredError("Project setup run is already executing");
  }
  if (result.status === "failed") {
    throw new Error(result.error ?? "Project setup run failed");
  }
}

export async function processJob(job: ReportJob): Promise<"complete" | "deferred" | "failed"> {
  try {
    if (job.jobType === "property_research") {
      await processPropertyResearch(job);
    } else if (job.jobType === "slack_completion_notification") {
      await processSlackCompletionNotification(job);
    } else if (job.jobType === "google_knowledge_sync") {
      await processGoogleKnowledgeSync(job);
    } else if (job.jobType === "slack_baxter_reply") {
      await processSlackBaxterReply(job);
    } else if (job.jobType === "baxter_monitor_sweep") {
      await processBaxterMonitorSweep(job);
    } else if (job.jobType === "baxter_alert_delivery") {
      await processBaxterAlertDelivery(job);
    } else if (job.jobType === "slack_monitoring_reaction") {
      await processSlackMonitoringReaction(job);
    } else if (job.jobType === "pem_neat_generate") {
      await processPemNeatGenerate(job);
    } else if (job.jobType === "project_setup") {
      await processProjectSetup(job);
    } else {
      throw new Error(`Unknown job type: ${(job as ReportJob).jobType}`);
    }
    await completeJob(job.id);
    return "complete";
  } catch (error) {
    if (error instanceof JobDeferredError) {
      await failJob(job.id, error.message, {
        retryAt: new Date(Date.now() + 10_000).toISOString(),
      });
      return "deferred";
    }
    const message = error instanceof Error ? error.message : "Job failed";
    logServerError(`processJob:${job.jobType}`, error);
    const terminal =
      error instanceof Error &&
      (error.name === "BaxterSlackTerminalError" ||
        (error as Error & { retryable?: boolean }).retryable === false);
    const shouldRetry = !terminal && job.attempts < 3;
    await failJob(job.id, message, {
      retryAt: shouldRetry ? new Date(Date.now() + 15_000).toISOString() : undefined,
    });
    if (!shouldRetry && job.jobType === "slack_baxter_reply") {
      const { cleanupProcessingReactionFromJobMetadata } =
        await import("@/lib/slack/baxter-events");
      await cleanupProcessingReactionFromJobMetadata(job.metadata);
    }
    return "failed";
  }
}

export async function processQueuedJobs(options?: { limit?: number }): Promise<{
  processed: number;
  completed: number;
  failed: number;
  deferred: number;
  reclaimed: number;
}> {
  const limit = options?.limit ?? 5;
  let processed = 0;
  let completed = 0;
  let failed = 0;
  let deferred = 0;

  // Reclaim jobs left "running" after process death / Vercel timeout.
  const { reclaimed } = await reclaimStaleRunningJobs({
    olderThanMs: 5 * 60_000,
  });

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextJob();
    if (!job) break;
    processed += 1;
    const result = await processJob(job);
    if (result === "complete") completed += 1;
    else if (result === "deferred") deferred += 1;
    else failed += 1;
  }

  return { processed, completed, failed, deferred, reclaimed };
}
