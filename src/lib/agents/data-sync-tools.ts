/**
 * Dexter's data-pipeline tools: read the Sync Manager (datasets, schedule, freshness, report
 * dependencies) and — with safeguards — request syncs or enable/disable datasets.
 *
 * Mutations are never decided by the model:
 *   - The requester's admin status is checked on the server for every call.
 *   - Admins get a preview plus a signed confirmation token that only works in a *later*
 *     turn (after the person confirmed), bound to the exact action.
 *   - Non-admins can't change anything; the request goes to the existing approval queue,
 *     and only an administrator's approval runs it.
 * Results carry the real run ids and job id from the Sync Manager — never invented ones.
 */

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SYNC_ENTITY_KEYS } from "@/lib/jobtread/entities";
import type { SyncAction } from "@/lib/reports/sync-http";
import { createApproval } from "./approvals";
import type { AgentTool, ToolContext, ToolResult } from "./tools";

async function reportsAccess(ctx: ToolContext) {
  const { requireReportsAccess } = await import("@/lib/reports/access");
  return requireReportsAccess(ctx.requester);
}

async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "That didn't work.";
    return {
      data: { ok: false, problem: message },
      logSummary: `Data sync tool refused: ${message.slice(0, 80)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Confirmation tokens (stateless, signed, usable only in a later turn)
// ---------------------------------------------------------------------------
function secret(): string {
  return (
    process.env.REPORTS_ACTION_SECRET ||
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "baxter-dev-only"
  );
}
const sign = (body: string) =>
  createHmac("sha256", `data-sync:${secret()}`).update(body).digest("base64url");

export function syncConfirmToken(
  userId: string,
  action: SyncAction,
  taskId: string,
  issuedAt = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({ u: userId, a: JSON.stringify(action), t: taskId, at: issuedAt }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function checkSyncConfirmToken(
  token: string,
  userId: string,
  action: SyncAction,
  currentTaskId: string,
): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return "Invalid confirmation token. Preview the change again.";
  const expected = sign(body);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig)))
    return "Invalid confirmation token. Preview the change again.";
  const p = JSON.parse(Buffer.from(body, "base64url").toString()) as {
    u: string;
    a: string;
    t: string;
    at: number;
  };
  if (p.u !== userId || p.a !== JSON.stringify(action))
    return "The confirmed change doesn't match this request. Preview it again.";
  if (Date.now() - p.at > 30 * 60_000) return "The preview expired. Preview the change again.";
  if (p.t === currentTaskId)
    return "Show the preview to the person and wait for them to confirm in their next message.";
  return null;
}

/** Shared mutation flow: approval for non-admins, preview → confirm → run for admins. */
async function mutate(
  ctx: ToolContext,
  action: SyncAction,
  confirmToken: string | undefined,
  preview: () => Promise<Record<string, unknown>>,
  title: string,
): Promise<ToolResult> {
  const access = await reportsAccess(ctx);
  if (!access.isAdmin) {
    const approval = await createApproval({
      taskId: ctx.task.id,
      agentId: ctx.agent.row.id,
      actionType: action.action === "enable" ? "data_sync.enable" : "data_sync.request",
      title,
      summary: `${ctx.requester.label} asked Dexter to: ${title}. Only an administrator's approval runs it.`,
      payload: { action, requestedBy: ctx.requester.userId, requestedByLabel: ctx.requester.label },
      requestedForUserId: ctx.requester.userId,
    });
    return {
      data: {
        status: "approval_requested",
        approvalId: approval.id,
        note: "Only administrators can change data syncs. I sent this to the approval queue; an administrator can approve it in AI Studio → Approvals. Nothing has run yet.",
      },
      approvalId: approval.id,
      logSummary: `Requested admin approval: ${title}.`,
    };
  }
  if (!confirmToken) {
    return {
      data: {
        status: "needs_confirmation",
        preview: await preview(),
        confirmToken: syncConfirmToken(ctx.requester.userId!, action, ctx.task.id),
        note: "Show this preview and ask the person to confirm. Call again with confirmToken only after they confirm in their next message.",
      },
      logSummary: `Previewed: ${title}.`,
    };
  }
  const problem = checkSyncConfirmToken(confirmToken, ctx.requester.userId!, action, ctx.task.id);
  if (problem) return { data: { ok: false, problem }, logSummary: "Sync confirmation refused." };
  const { applySyncAction } = await import("@/lib/reports/sync-http");
  const { ensureEntityStates } = await import("@/lib/jobtread/sync-manager");
  const outcome = await applySyncAction(
    action,
    { userId: ctx.requester.userId, label: `Dexter for ${ctx.requester.label}` },
    async () => (await ensureEntityStates()).filter((s) => s.enabled).map((s) => s.entity),
  );
  return {
    data: {
      status: "done",
      message: outcome.message,
      batchId: outcome.request?.batchId ?? null,
      jobId: outcome.request?.jobId ?? null,
      runs: outcome.request?.runs ?? [],
      skipped: outcome.request?.skipped ?? [],
      note: outcome.request?.jobId
        ? "Queued. The worker starts within a couple of minutes; progress is in Reports → Data settings."
        : undefined,
    },
    logSummary: outcome.message.slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------
const entityArg = z.enum(SYNC_ENTITY_KEYS);

const overviewTool: AgentTool = {
  key: "reports_sync_overview",
  label: "Data sync overview",
  description:
    "Every JobTread dataset Baxter can sync: enabled, status, last good sync, cached vs. JobTread counts, and freshness.",
  modelUsage:
    "reports_sync_overview {} — each dataset (key, label, enabled, status, lastSuccessAt, recordsCached, sourceCount, freshness). Use for 'what data is synced / how fresh is it'.",
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  source: "jobtread",
  args: z.object({}).passthrough(),
  async execute(ctx) {
    return guarded(async () => {
      await reportsAccess(ctx);
      const { getSyncManagerOverview } = await import("@/lib/jobtread/sync-manager");
      const { getDatasetFreshness } = await import("@/lib/reports/data-health");
      const { assessFreshness } = await import("@/lib/reports/dependencies");
      const [o, freshness] = await Promise.all([getSyncManagerOverview(), getDatasetFreshness()]);
      return {
        data: {
          jobtreadConnected: o.configured,
          dailySync: o.schedule,
          datasets: o.entities.map((e) => {
            const f = freshness.find((x) => x.key === e.key);
            const a = f ? assessFreshness(f) : null;
            return {
              key: e.key,
              label: e.label,
              enabled: e.enabled,
              schedule: e.schedule,
              status: e.status,
              lastSuccessAt: f?.lastSuccessAt ?? e.lastSuccessAt,
              recordsCached: e.recordsCached,
              sourceCount: e.sourceCount,
              freshness: a?.level ?? null,
              warning: a?.message ?? null,
              lastError: e.lastError,
            };
          }),
        },
        logSummary: `Read the status of ${o.entities.length} datasets.`,
      };
    });
  },
};

const entityTool: AgentTool = {
  key: "reports_sync_dataset",
  label: "Dataset sync details",
  description:
    "One dataset's sync detail: recent runs, errors, fields JobTread doesn't expose, privacy rules, and what uses it.",
  modelUsage: `reports_sync_dataset {"entity": ${SYNC_ENTITY_KEYS.map((k) => `"${k}"`).join("|")}} — status, last runs (ids, status, records, errors), dropped fields, privacy, dependencies.`,
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  source: "jobtread",
  args: z.object({ entity: entityArg }),
  async execute(ctx, raw) {
    return guarded(async () => {
      await reportsAccess(ctx);
      const { entity } = z.object({ entity: entityArg }).parse(raw);
      const { getEntityOverviews, listEntityRuns } = await import("@/lib/jobtread/sync-manager");
      const [all, runs] = await Promise.all([
        getEntityOverviews(),
        listEntityRuns({ entity, limit: 5 }),
      ]);
      const e = all.find((x) => x.key === entity)!;
      return {
        data: {
          ...e,
          recentRuns: runs.map((r) => ({
            runId: r.id,
            status: r.status,
            triggeredBy: r.triggered_by,
            records: r.records_seen,
            removed: r.records_removed,
            pages: r.pages,
            startedAt: r.started_at,
            finishedAt: r.finished_at,
            error: r.error,
          })),
        },
        logSummary: `Read sync details for ${entity}.`,
      };
    });
  },
};

const scheduleTool: AgentTool = {
  key: "reports_sync_schedule",
  label: "Data sync schedule",
  description: "When the daily sync runs, which datasets it includes, and which are manual-only.",
  modelUsage:
    "reports_sync_schedule {} — daily sync on/off, hour (UTC), next run, last queued, datasets on the daily schedule vs. manual.",
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  source: "jobtread",
  args: z.object({}).passthrough(),
  async execute(ctx) {
    return guarded(async () => {
      await reportsAccess(ctx);
      const { getSyncManagerOverview } = await import("@/lib/jobtread/sync-manager");
      const o = await getSyncManagerOverview();
      return {
        data: {
          ...o.schedule,
          daily: o.entities.filter((e) => e.enabled && e.schedule === "daily").map((e) => e.key),
          manualOnly: o.entities
            .filter((e) => e.enabled && e.schedule === "manual")
            .map((e) => e.key),
          disabled: o.entities.filter((e) => !e.enabled).map((e) => e.key),
        },
        logSummary: "Read the data sync schedule.",
      };
    });
  },
};

const dependenciesTool: AgentTool = {
  key: "reports_data_dependencies",
  label: "Report data dependencies",
  description: "Which synced datasets a report and each of its widgets depend on, with freshness.",
  modelUsage:
    'reports_data_dependencies {"reportId"} — datasets the report reads (with reasons and widget ids), live/rule/mapping widgets, and freshness warnings per widget.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  source: "jobtread",
  args: z.object({ reportId: z.string().uuid() }),
  async execute(ctx, raw) {
    return guarded(async () => {
      const access = await reportsAccess(ctx);
      const { reportId } = z.object({ reportId: z.string().uuid() }).parse(raw);
      const { loadReportFor } = await import("@/lib/reports/repo");
      const { report } = await loadReportFor(reportId, ctx.requester, access);
      const { reportDependencies } = await import("@/lib/reports/dependencies");
      const { reportDataHealth } = await import("@/lib/reports/data-health");
      const deps = reportDependencies(report.spec);
      const health = await reportDataHealth(report.spec);
      return {
        data: { reportId, title: report.title, ...deps, health },
        logSummary: `Read data dependencies for "${report.title}".`,
      };
    });
  },
};

const freshnessTool: AgentTool = {
  key: "reports_data_freshness",
  label: "Data freshness",
  description: "How fresh each synced dataset is, with the exact warning reports show.",
  modelUsage:
    'reports_data_freshness {"entities"?: [dataset keys]} — freshness level (fresh, stale, never, failed, disabled, running, not_configured), lastSuccessAt, and the warning text.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  source: "jobtread",
  args: z.object({ entities: z.array(entityArg).max(20).optional() }),
  async execute(ctx, raw) {
    return guarded(async () => {
      await reportsAccess(ctx);
      const { entities } = z.object({ entities: z.array(entityArg).optional() }).parse(raw ?? {});
      const { getDatasetFreshness } = await import("@/lib/reports/data-health");
      const { assessFreshness } = await import("@/lib/reports/dependencies");
      const all = await getDatasetFreshness();
      const rows = all
        .filter((f) => !entities?.length || entities.includes(f.key))
        .map((f) => ({
          entity: f.key,
          label: f.label,
          lastSuccessAt: f.lastSuccessAt,
          ...assessFreshness(f),
        }));
      return {
        data: { datasets: rows },
        logSummary: `Checked freshness of ${rows.length} datasets.`,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// Mutation tools
// ---------------------------------------------------------------------------
const requestArgs = z.object({
  entities: z.union([z.array(entityArg).min(1).max(20), z.literal("all")]),
  confirmToken: z.string().max(2000).optional(),
});

const requestSyncTool: AgentTool = {
  key: "reports_sync_request",
  label: "Request a data sync",
  description:
    "Queue a JobTread sync for datasets. Admins confirm first; anyone else's request goes to an administrator for approval.",
  modelUsage:
    'reports_sync_request {"entities": [dataset keys] | "all", "confirmToken"?} — first call returns a preview + confirmToken (admins) or an approval request (non-admins). Only after the person confirms in their next message, call again with the same entities and the confirmToken. Report the returned runIds/jobId exactly; never invent them.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  source: "jobtread",
  args: requestArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = requestArgs.parse(raw);
      const action: SyncAction =
        a.entities === "all"
          ? { action: "sync_all" }
          : { action: "sync", entities: [...a.entities].sort() };
      const title =
        a.entities === "all" ? "Sync all enabled datasets" : `Sync ${a.entities.join(", ")}`;
      return mutate(
        ctx,
        action,
        a.confirmToken,
        async () => {
          const { getEntityOverviews } = await import("@/lib/jobtread/sync-manager");
          const all = await getEntityOverviews();
          const wanted =
            a.entities === "all" ? all.filter((e) => e.enabled).map((e) => e.key) : a.entities;
          return {
            action: title,
            datasets: all
              .filter((e) => wanted.includes(e.key))
              .map((e) => ({
                key: e.key,
                label: e.label,
                enabled: e.enabled,
                status: e.status,
                willRun: e.enabled && !e.activeRun,
                note: !e.enabled
                  ? "Disabled — will be skipped."
                  : e.activeRun
                    ? "Already running — the existing run is reused."
                    : null,
              })),
            readOnly: "Reads JobTread only; updates Baxter's reporting cache.",
          };
        },
        title,
      );
    });
  },
};

const enableArgs = z.object({
  entity: entityArg,
  enabled: z.boolean(),
  confirmToken: z.string().max(2000).optional(),
});

const enableTool: AgentTool = {
  key: "reports_sync_enable",
  label: "Enable or disable a dataset",
  description:
    "Turn a JobTread dataset's sync on or off. Admins confirm first; anyone else's request goes to an administrator for approval.",
  modelUsage:
    'reports_sync_enable {"entity", "enabled": boolean, "confirmToken"?} — same two-step flow as reports_sync_request. Mention the dataset\'s sensitivity and privacy note from the preview before the person confirms.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  source: "jobtread",
  args: enableArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = enableArgs.parse(raw);
      const action: SyncAction = { action: "enable", entity: a.entity, enabled: a.enabled };
      const title = `${a.enabled ? "Enable" : "Disable"} the ${a.entity} dataset`;
      return mutate(
        ctx,
        action,
        a.confirmToken,
        async () => {
          const { getSyncEntity } = await import("@/lib/jobtread/entities");
          const def = getSyncEntity(a.entity)!;
          return {
            action: title,
            dataset: def.label,
            sensitivity: def.sensitivity,
            privacy: def.privacy,
            usedFor: def.usedFor,
            effect: a.enabled
              ? "It will be included in the next sync. Nothing is fetched until a sync runs."
              : "Future syncs skip it. Data already cached is kept, not deleted.",
          };
        },
        title,
      );
    });
  },
};

const sourcesArgs = z.object({ source: z.string().max(40).optional() });

const sourcesTool: AgentTool = {
  key: "reports_sources",
  label: "Discover report sources",
  description:
    "Every registered report source (jobs, Product Library models, cost items, commissions, …) with its grain, relationships, fields this person may use, supported filters and aggregations, record count, and data freshness.",
  modelUsage:
    'reports_sources {"source"?: id} — the source registry: what one row is, link fields to other sources, visible fields (key, label, type), restricted field count, filters/aggregations, records, freshness. Call it when a request may need a source other than jobs (pricing, cost items, options, models).',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  source: "jobtread",
  args: sourcesArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const access = await reportsAccess(ctx);
      const { source } = sourcesArgs.parse(raw ?? {});
      const { SOURCES } = await import("@/lib/reports/spec");
      const { SOURCE_REGISTRY, SUPPORTED_OPERATIONS } = await import("@/lib/reports/sources");
      const { getFieldCatalog } = await import("@/lib/reports/fields");
      const { canSeeField } = await import("@/lib/reports/access");
      const { loadSourceRows } = await import("@/lib/reports/engine");
      const { getDatasetFreshness } = await import("@/lib/reports/data-health");
      const { assessFreshness } = await import("@/lib/reports/dependencies");
      const [catalog, freshness] = await Promise.all([
        getFieldCatalog(),
        getDatasetFreshness().catch(() => []),
      ]);
      const ids = SOURCES.filter((id) => !source || id === source);
      if (!ids.length)
        throw new Error(`Unknown source "${source}". Sources: ${SOURCES.join(", ")}.`);
      const out = [];
      for (const id of ids) {
        const meta = SOURCE_REGISTRY[id];
        const fields = catalog.bySource[id];
        const visible = fields.filter((f) => canSeeField(access, f));
        const records =
          id === "commissions"
            ? null
            : await loadSourceRows(id)
                .then((r) => r.rows.length)
                .catch(() => null);
        out.push({
          id,
          label: meta.label,
          description: meta.description,
          grain: meta.grain,
          sourceSystem: meta.sourceSystem,
          relationships: meta.relationships,
          notes: meta.notes,
          records,
          fields: (source ? visible : visible.slice(0, 60)).map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            ...(f.via ? { via: f.via } : {}),
          })),
          relatedFields: [...catalog.related[id].values()]
            .filter((r) => {
              const def = catalog.byKey.get(r.key);
              return def && canSeeField(access, def);
            })
            .map((r) => ({ ref: r.ref, key: r.key, via: r.relationship })),
          restrictedFields: fields.length - visible.length,
          freshness: meta.syncEntities.map((e) => {
            const f = freshness.find((x) => x.key === e);
            return f
              ? { dataset: e, lastSuccessAt: f.lastSuccessAt, ...assessFreshness(f) }
              : { dataset: e, level: "unknown", message: null };
          }),
        });
      }
      return {
        data: { sources: out, operations: SUPPORTED_OPERATIONS },
        logSummary: `Read ${out.length} report source(s) from the registry.`,
      };
    });
  },
};

export const DATA_SYNC_TOOLS: AgentTool[] = [
  sourcesTool,
  overviewTool,
  entityTool,
  scheduleTool,
  dependenciesTool,
  freshnessTool,
  requestSyncTool,
  enableTool,
];
export const DATA_SYNC_TOOL_KEYS = DATA_SYNC_TOOLS.map((t) => t.key);
