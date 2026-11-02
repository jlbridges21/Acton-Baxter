/**
 * Request handling for Reports → Data settings → Financial data (admins) and the alerts inbox.
 * Route files stay thin; every action is validated here and audited where it changes state.
 */

import "server-only";

import { z } from "zod";
import { StoreError } from "@/lib/agents/store";
import { ValidationError } from "@/lib/errors";
import { alertRuleInputSchema } from "./alert-core";
import { LIFECYCLE_STATUSES } from "./financial-core";
import { getPpConfig, saveFinancialSettings, savePpConfig } from "./financial-data";
import { financialReadiness, projectManagerAudit } from "./financial-overview";
import { ppConfigSchema } from "./pp-core";
import type { ReportsContext } from "./http";

/** Pending migrations surface as a clear 400, not a generic server error. */
export async function withMigrationMessage<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StoreError && error.code === "MIGRATION_REQUIRED")
      throw new ValidationError(error.message);
    throw error;
  }
}

export const financialActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save_settings"),
    statusMap: z
      .array(
        z.object({
          type: z.string().min(1).max(40),
          status: z.string().max(60),
          lifecycle: z.enum(LIFECYCLE_STATUSES),
        }),
      )
      .max(200)
      .optional(),
    balanceSource: z.enum(["payments_reconciled", "jobtread_balance"]).optional(),
    overdueGraceDays: z.number().int().min(0).max(120).optional(),
  }),
  z.object({ action: z.literal("save_pp_config"), config: ppConfigSchema }),
  z.object({ action: z.literal("preview_pp"), config: ppConfigSchema.optional() }),
  z.object({ action: z.literal("record_pp_suggestions") }),
  z.object({
    action: z.literal("decide_pp_link"),
    documentId: z.string().min(1).max(80),
    decision: z.enum(["approve", "reject", "manual"]),
    taskId: z.string().max(80).nullable().optional(),
    ppNumber: z.string().max(40).nullable().optional(),
    milestonePct: z.number().min(0).max(100).nullable().optional(),
    note: z.string().max(300).nullable().optional(),
  }),
  z.object({
    action: z.literal("save_snapshot_settings"),
    enabled: z.boolean().optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    hourLocal: z.number().int().min(0).max(23).optional(),
    timezone: z.string().min(1).max(60).optional(),
  }),
  z.object({ action: z.literal("capture_snapshot") }),
  z.object({ action: z.literal("save_alert_rule"), rule: alertRuleInputSchema }),
  z.object({ action: z.literal("evaluate_alerts") }),
  z.object({ action: z.literal("pm_audit") }),
  /** Without confirm: a dry-run plan. With confirm: turn payments on and queue one sync. */
  z.object({ action: z.literal("payments_backfill"), confirm: z.boolean().default(false) }),
]);

export async function financialOverview() {
  const [readiness, pp, snapshots, alerts] = await Promise.all([
    financialReadiness(),
    getPpConfig(),
    import("./snapshots").then(async (m) => ({
      settings: await m.getSnapshotSettings(),
      runs: await m.listSnapshotRuns(12),
    })),
    import("./alerts").then(async (m) => ({
      ...(await m.listAlertRules()),
      slackAuthorized: m.slackAuthorized(),
    })),
  ]);
  return { ...readiness, pp, snapshots, alerts };
}

export async function runFinancialAction(ctx: ReportsContext, raw: unknown) {
  const body = financialActionSchema.parse(raw);
  const actor = ctx.requester.userId ?? ctx.requester.label;
  return withMigrationMessage(async () => {
    switch (body.action) {
      case "save_settings":
        return { settings: await saveFinancialSettings(body, actor) };
      case "save_pp_config":
        return { pp: await savePpConfig(body.config, actor) };
      case "preview_pp":
        return (await import("./pp-mapping")).ppPreview(body.config);
      case "record_pp_suggestions":
        return (await import("./pp-mapping")).recordSuggestions();
      case "decide_pp_link":
        return { link: await (await import("./pp-mapping")).decidePpLink({ ...body, actor }) };
      case "save_snapshot_settings": {
        const { action: _a, ...patch } = body;
        void _a;
        return { settings: await (await import("./snapshots")).saveSnapshotSettings(patch, actor) };
      }
      case "capture_snapshot":
        return (await import("./snapshots")).captureSnapshot({ triggeredBy: `admin:${actor}` });
      case "save_alert_rule":
        return { rule: await (await import("./alerts")).saveAlertRule(body.rule, actor) };
      case "evaluate_alerts":
        return (await import("./alerts")).evaluateAlerts({ triggeredBy: `admin:${actor}` });
      case "pm_audit":
        return { pm: await projectManagerAudit() };
      case "payments_backfill":
        return paymentsBackfill(body.confirm, actor);
    }
  });
}

/**
 * Payments backfill. Payments ship disabled (financial data); this never runs on its own.
 * The dry run reports what JobTread said it has; confirming enables the dataset and queues a
 * single chunked, resumable sync (the Sync Manager's checkpoints keep it safe to interrupt).
 */
export async function paymentsBackfill(confirm: boolean, actor: string) {
  const m = await import("@/lib/jobtread/sync-manager");
  const { agentDb, eq } = await import("@/lib/agents/store");
  const [catalog] = await agentDb()
    .select<{ record_count: number | null; accessible: boolean; last_verified_at: string }>(
      "jt_entity_catalog",
      {
        filters: [eq("entity", "payments")],
        limit: 1,
      },
    )
    .catch(() => []);
  const state = await m.getEntityState("payments");
  const plan = {
    enabled: state.enabled,
    jobtreadRecords: catalog?.record_count ?? null,
    verifiedAt: catalog?.last_verified_at ?? null,
    estimatedPages: catalog?.record_count ? Math.ceil(catalog.record_count / 100) : null,
    note:
      catalog?.record_count === 0
        ? "JobTread reported no payment records at the last catalog check. Enabling payments is safe but will cache nothing until payments are recorded in JobTread."
        : catalog
          ? "Runs in 100-record pages with checkpoints; it can be stopped and resumed from Reports → Data settings → Sync."
          : "The Data Catalog hasn't verified payments for this grant yet; refresh it first to see how many records exist.",
  };
  if (!confirm) return { dryRun: true, plan };
  if (catalog && !catalog.accessible)
    throw new ValidationError(
      "JobTread doesn't give Baxter's grant access to payments, so there's nothing to backfill.",
    );
  await m.setEntityEnabled("payments", true, actor);
  const request = await m.requestEntitySync({
    entities: ["payments"],
    triggeredBy: `backfill:${actor}`,
  });
  return { dryRun: false, plan, request };
}
