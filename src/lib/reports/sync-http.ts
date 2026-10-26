/**
 * Sync Manager actions for /api/reports/admin/sync (admins only) and Dexter's approved
 * mutations. Every action is audited; nothing here writes to JobTread.
 */

import "server-only";

import { z } from "zod";
import { recordAudit, type AuditActor } from "@/lib/agents/audit";
import { SYNC_ENTITY_KEYS, type SyncEntityKey } from "@/lib/jobtread/entities";
import {
  requestEntitySync,
  retryEntitySync,
  setEntityEnabled,
  setEntitySchedule,
  updateSyncSettings,
  type SyncRequestResult,
} from "@/lib/jobtread/sync-manager";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { isAdminRole } from "@/lib/auth/roles";
import { invalidateDataHealthCache } from "./data-health";

const entity = z.enum(SYNC_ENTITY_KEYS);

export const syncActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync"), entities: z.array(entity).min(1).max(20) }),
  z.object({ action: z.literal("sync_all") }),
  z.object({ action: z.literal("retry"), entity }),
  z.object({ action: z.literal("enable"), entity, enabled: z.boolean() }),
  z.object({ action: z.literal("schedule"), entity, schedule: z.enum(["daily", "manual"]) }),
  z.object({
    action: z.literal("settings"),
    dailyEnabled: z.boolean().optional(),
    dailyHourUtc: z.number().int().min(0).max(23).optional(),
  }),
]);
export type SyncAction = z.infer<typeof syncActionSchema>;

export type SyncActionOutcome = { message: string; request?: SyncRequestResult };

function describeRequest(r: SyncRequestResult): string {
  const queued = r.runs.filter((x) => !x.reused).map((x) => x.entity);
  const reused = r.runs.filter((x) => x.reused).map((x) => x.entity);
  const parts = [];
  if (queued.length) parts.push(`queued ${queued.join(", ")}`);
  if (reused.length) parts.push(`already running: ${reused.join(", ")}`);
  if (r.skipped.length)
    parts.push(`skipped ${r.skipped.map((s) => `${s.entity} (${s.reason})`).join(", ")}`);
  return parts.join("; ") || "nothing to do";
}

/** Apply one Sync Manager action. Callers must have verified the actor is a Reports admin. */
export async function applySyncAction(
  action: SyncAction,
  actor: AuditActor,
  enabledKeys: () => Promise<SyncEntityKey[]>,
): Promise<SyncActionOutcome> {
  const by = actor.userId ? `user:${actor.userId}` : (actor.label ?? "system");
  let outcome: SyncActionOutcome;
  if (action.action === "sync" || action.action === "sync_all") {
    const entities = action.action === "sync" ? action.entities : await enabledKeys();
    const request = await requestEntitySync({ entities, triggeredBy: by });
    outcome = { message: `Sync requested: ${describeRequest(request)}.`, request };
  } else if (action.action === "retry") {
    const request = await retryEntitySync(action.entity, by);
    outcome = { message: `Retry requested: ${describeRequest(request)}.`, request };
  } else if (action.action === "enable") {
    await setEntityEnabled(action.entity, action.enabled, actor.userId);
    outcome = { message: `${action.entity} ${action.enabled ? "enabled" : "disabled"}.` };
  } else if (action.action === "schedule") {
    await setEntitySchedule(action.entity, action.schedule, actor.userId);
    outcome = { message: `${action.entity} schedule set to ${action.schedule}.` };
  } else {
    await updateSyncSettings(
      {
        ...(action.dailyEnabled !== undefined ? { daily_enabled: action.dailyEnabled } : {}),
        ...(action.dailyHourUtc !== undefined ? { daily_hour_utc: action.dailyHourUtc } : {}),
      },
      actor.userId,
    );
    outcome = { message: "Daily sync schedule updated." };
  }
  invalidateDataHealthCache();
  await recordAudit({
    actor,
    action: `jobtread.sync_manager.${action.action}`,
    targetType: "jobtread_sync",
    targetId: "entity" in action ? action.entity : null,
    summary: outcome.message,
    details: {
      action,
      batchId: outcome.request?.batchId ?? null,
      jobId: outcome.request?.jobId ?? null,
      runIds: outcome.request?.runs.map((r) => r.runId) ?? [],
    },
  });
  return outcome;
}

/**
 * Start the queued job right away (after the response is sent) instead of waiting for the
 * next cron sweep. The job hands off to a continuation job if it runs out of time.
 */
export async function kickSyncJob(jobId: string | null): Promise<void> {
  if (!jobId) return;
  const { claimJobById } = await import("@/lib/jobs/queue");
  const { processJob } = await import("@/lib/jobs/process");
  const job = await claimJobById(jobId);
  if (job) await processJob(job);
}

/** Approving a Dexter data-sync request requires a Reports administrator. */
export async function assertDataSyncDecider(userId: string): Promise<void> {
  const { getReportStore } = await import("@/lib/research/report-store");
  const profile = await getReportStore().getProfile(userId);
  if (!profile || !isAdminRole(profile.role))
    throw new AuthorizationError("Only an administrator can approve data sync changes.");
}

/** Run an approved data-sync request as the approving administrator. */
export async function runApprovedDataSync(
  payload: Record<string, unknown>,
  approverId: string,
): Promise<SyncActionOutcome> {
  const parsed = syncActionSchema.safeParse(payload.action);
  if (!parsed.success) throw new ValidationError("This request isn't a valid sync action.");
  const { ensureEntityStates } = await import("@/lib/jobtread/sync-manager");
  return applySyncAction(
    parsed.data,
    {
      userId: approverId,
      label: `Approved request from ${String(payload.requestedByLabel ?? "a teammate")}`,
    },
    async () => (await ensureEntityStates()).filter((s) => s.enabled).map((s) => s.entity),
  );
}
