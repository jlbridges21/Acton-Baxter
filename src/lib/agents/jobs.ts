/**
 * Durable background execution for agent tasks, built on the existing report_jobs queue
 * and the Vercel cron that already drains it (/api/internal/process-jobs).
 *
 * Most assignments finish inline within the chat request. This path covers:
 *   - temporary provider failures (retry with backoff)
 *   - tasks orphaned by a crashed/timed-out function (expired lease → re-queued)
 */

import "server-only";

import { enqueueJob } from "@/lib/jobs/queue";
import type { ReportJob } from "@/lib/jobs/types";
import { executeSpecialistTask } from "./executor";
import {
  appendTaskEvent,
  getTask,
  listQueuedTasks,
  listStaleRunningTasks,
  patchTask,
  transitionTask,
} from "./tasks";

export type SlackFollowUpTarget = { channelId: string; threadTs: string | null };

export async function enqueueAgentTaskJob(
  taskId: string,
  options: { delaySeconds?: number; slackTarget: SlackFollowUpTarget | null },
): Promise<ReportJob> {
  return enqueueJob({
    jobType: "ai_agent_task",
    availableAt: new Date(Date.now() + (options.delaySeconds ?? 0) * 1000).toISOString(),
    metadata: { taskId, slackTarget: options.slackTarget },
  });
}

export async function processAgentTaskJob(job: ReportJob): Promise<void> {
  const taskId = typeof job.metadata.taskId === "string" ? job.metadata.taskId : null;
  if (!taskId) throw new Error("ai_agent_task job requires metadata.taskId");
  const task = await getTask(taskId);
  if (!task || task.status !== "queued") return;

  // Requester access is re-loaded from the database inside executeSpecialistTask.
  const outcome = await executeSpecialistTask(taskId);
  if (!outcome.ok && outcome.code === "RETRY_SCHEDULED") {
    await enqueueAgentTaskJob(taskId, {
      delaySeconds: 60,
      slackTarget: (job.metadata.slackTarget as SlackFollowUpTarget | null) ?? null,
    });
    return;
  }

  const target = job.metadata.slackTarget as SlackFollowUpTarget | null;
  if (target?.channelId && outcome.task) {
    const { postSlackMessage } = await import("@/lib/slack/client");
    const text = outcome.ok
      ? `Update on your earlier request: ${outcome.result.summary.slice(0, 2500)}`
      : `Update on your earlier request: the assignment could not be completed (${outcome.code}).`;
    await postSlackMessage({
      channel: target.channelId,
      ...(target.threadTs ? { threadTs: target.threadTs } : {}),
      text,
    }).catch(() => undefined);
  }
}

/**
 * Called from the job sweep: re-queue tasks whose worker died mid-run, or fail them when
 * out of attempts. Never re-runs a task that already has a result.
 */
export async function recoverStaleAgentTasks(): Promise<{ requeued: number; failed: number }> {
  let requeued = 0;
  let failed = 0;
  for (const task of await listStaleRunningTasks()) {
    try {
      if (task.attempts < task.max_attempts && !task.cancel_requested) {
        await transitionTask(
          task.id,
          "queued",
          { error_code: "INTERRUPTED" },
          { from: ["running"] },
        );
        await appendTaskEvent(
          task.id,
          "recovered",
          "Work was interrupted; re-queued automatically.",
        );
        await enqueueAgentTaskJob(task.id, { slackTarget: null });
        requeued++;
      } else {
        await transitionTask(
          task.id,
          task.cancel_requested ? "cancelled" : "failed",
          {
            error_code: "INTERRUPTED",
            error_message: "Work was interrupted and could not be resumed.",
          },
          { from: ["running"] },
        );
        await appendTaskEvent(task.id, "failed", "Work was interrupted and is out of retries.");
        failed++;
      }
    } catch {
      // Another worker moved it first.
    }
  }
  // Queued tasks with no progress for 5 minutes (creator died before running it).
  // A duplicate job is harmless: claimTask lets only one worker run an attempt.
  const cutoff = Date.now() - 5 * 60_000;
  for (const task of await listQueuedTasks(20)) {
    if (new Date(task.updated_at).getTime() < cutoff) {
      await enqueueAgentTaskJob(task.id, { slackTarget: null });
      // Touch updated_at so the next sweep doesn't enqueue it again.
      await patchTask(task.id, { attempts: task.attempts });
      requeued++;
    }
  }
  return { requeued, failed };
}
