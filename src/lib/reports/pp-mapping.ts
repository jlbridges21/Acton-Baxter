/**
 * PP# milestone mapping: preview a configuration, record suggested links, and let an
 * administrator approve, reject, or set links by hand. Links join by stable JobTread ids only
 * (document id → task id, both on the same job id). Approved and rejected decisions are never
 * overwritten by a later rule run.
 */

import "server-only";

import { agentDb, eq, StoreError } from "@/lib/agents/store";
import { ValidationError } from "@/lib/errors";
import {
  getPpConfig,
  invalidateFinancialContext,
  isMissingSchema,
  listPpLinks,
  loadFinancialContext,
  MIGRATION_084,
} from "./financial-data";
import {
  drillLevels,
  effectiveLinks,
  previewPpMatches,
  type PpConfig,
  type PpLinkRow,
} from "./pp-core";

export async function ppPreview(config?: PpConfig) {
  const [ctx, saved] = await Promise.all([loadFinancialContext(), getPpConfig()]);
  const cfg = config ?? saved.config;
  return {
    config: cfg,
    version: saved.version,
    migrated: saved.migrated,
    preview: previewPpMatches(ctx.documents, ctx.tasks, ctx.ppLinks, cfg),
    tasksSynced: Boolean(ctx.entities.get("tasks")?.last_success_at),
  };
}

/**
 * Store a "suggested" link for every unique rule match that has no decision yet. Ambiguous
 * and unmatched invoices are left for an administrator. Returns what changed.
 */
export async function recordSuggestions() {
  const { config, version, migrated, preview } = await ppPreview();
  if (!migrated)
    throw new StoreError(`PP# links need migration ${MIGRATION_084}.`, "MIGRATION_REQUIRED");
  if (!preview.configured)
    throw new ValidationError("Configure the PP# classification rule first.");
  const existing = new Map((await listPpLinks()).map((l) => [l.document_id, l]));
  let created = 0;
  let refreshed = 0;
  let kept = 0;
  for (const item of preview.matchedItems) {
    if (item.match.status !== "matched") continue;
    const prior = existing.get(item.documentId);
    if (prior && (prior.status !== "suggested" || prior.match_method === "manual")) {
      kept++;
      continue;
    }
    const row = {
      document_id: item.documentId,
      job_id: item.jobId,
      task_id: item.match.taskId,
      pp_number: item.pp,
      milestone_pct: item.milestonePct,
      match_method: "rule",
      status: "suggested",
      config_version: version,
      note: `Matched by ${item.match.via}`,
      updated_at: new Date().toISOString(),
    };
    await agentDb().upsert("bi_pp_links", row, ["document_id"]);
    if (prior) refreshed++;
    else created++;
  }
  invalidateFinancialContext();
  return {
    created,
    refreshed,
    keptDecisions: kept,
    ambiguous: preview.ambiguous.length,
    unmatched: preview.unmatched.length,
    autoAccept: config.autoAcceptUnique,
  };
}

/** Approve or reject a link, or set one by hand (task must be on the invoice's job). */
export async function decidePpLink(input: {
  documentId: string;
  decision: "approve" | "reject" | "manual";
  taskId?: string | null;
  ppNumber?: string | null;
  milestonePct?: number | null;
  note?: string | null;
  actor: string;
}): Promise<PpLinkRow> {
  const ctx = await loadFinancialContext();
  const doc = ctx.documents.find((d) => d.id === input.documentId);
  if (!doc) throw new ValidationError("That document isn't in the synced JobTread data.");
  if (doc.type !== "customerInvoice")
    throw new ValidationError("Only customer invoices can be PP# invoices.");
  const now = new Date().toISOString();
  const prior = ctx.ppLinks.find((l) => l.document_id === doc.id) ?? null;
  let patch: Record<string, unknown>;
  if (input.decision === "manual") {
    if (!input.taskId) throw new ValidationError("Choose the task this invoice belongs to.");
    const task = ctx.tasks.find((t) => t.id === input.taskId);
    if (!task) throw new ValidationError("That task isn't in the synced JobTread tasks.");
    if (task.job_id !== doc.job_id)
      throw new ValidationError("That task is on a different job than the invoice.");
    patch = {
      document_id: doc.id,
      job_id: doc.job_id,
      task_id: task.id,
      pp_number: input.ppNumber ?? prior?.pp_number ?? null,
      milestone_pct: input.milestonePct ?? prior?.milestone_pct ?? null,
      match_method: "manual",
      status: "approved",
    };
  } else {
    if (!prior) throw new ValidationError("There's no suggested link for this invoice yet.");
    patch = { ...prior, status: input.decision === "approve" ? "approved" : "rejected" };
  }
  const row = {
    ...patch,
    note: input.note ?? (patch.note as string | null) ?? null,
    decided_by: input.actor,
    decided_at: now,
    updated_at: now,
  };
  try {
    const [saved] = await agentDb().upsert<PpLinkRow>("bi_pp_links", row, ["document_id"]);
    invalidateFinancialContext();
    return saved!;
  } catch (error) {
    if (isMissingSchema(error))
      throw new StoreError(`PP# links need migration ${MIGRATION_084}.`, "MIGRATION_REQUIRED");
    throw error;
  }
}

export async function getPpLink(documentId: string) {
  const [row] = await agentDb()
    .select<PpLinkRow>("bi_pp_links", { filters: [eq("document_id", documentId)], limit: 1 })
    .catch(() => []);
  return row ?? null;
}

/**
 * Project → PP# milestone → invoice → payments for one job. Each level is present only when
 * its relationship is verified (drillLevels); otherwise invoices hang directly off the project
 * and the reason is returned. Amounts are JobTread's; payments are listed, never summed into
 * the invoice totals.
 */
export async function projectFinancialDrill(jobId: string) {
  const { documentRows, paymentRows } = await import("./financial-data");
  const ctx = await loadFinancialContext();
  const job = ctx.jobs.get(jobId);
  if (!job) throw new ValidationError("That job isn't in the synced JobTread data.");
  const links = effectiveLinks(ctx.ppLinks, ctx.pp.config);
  const levels = drillLevels({
    tasksSynced: Boolean(ctx.entities.get("tasks")?.last_success_at),
    documentsSynced:
      Boolean(ctx.entities.get("documents")?.last_success_at) || ctx.documents.length > 0,
    paymentsSynced: Boolean(ctx.paymentsState.enabled && ctx.paymentsState.lastSucceededAt),
    approvedLinks: [...links.values()].filter((l) => l.job_id === jobId).length,
    ppConfigured: ctx.pp.config.classification.mode !== "none",
  });
  const on = (k: string) => levels.find((l) => l.key === k)!.enabled;
  const invoices = documentRows(ctx).filter(
    (r) => r["doc.jobId"] === jobId && r["doc.type"] === "Customer invoice",
  );
  const payments = on("payments") ? paymentRows(ctx).filter((p) => p["pay.jobId"] === jobId) : [];
  const withPayments = (inv: Record<string, unknown>) => ({
    ...inv,
    payments: on("payments") ? payments.filter((p) => p["pay.documentId"] === inv.id) : null,
  });
  if (!on("milestone"))
    return {
      job: { id: job.id, name: job.name, number: job.number },
      levels,
      milestones: null,
      invoices: invoices.map(withPayments),
    };
  const tasks = new Map(ctx.tasks.map((t) => [t.id, t]));
  const groups = new Map<
    string,
    { taskId: string; name: string | null; endDate: string | null; invoices: unknown[] }
  >();
  const unlinked: unknown[] = [];
  for (const inv of invoices) {
    const taskId = inv["doc.milestoneTaskId"] as string | null;
    if (!taskId) {
      unlinked.push(withPayments(inv));
      continue;
    }
    const t = tasks.get(taskId);
    const g = groups.get(taskId) ?? {
      taskId,
      name: t?.name ?? null,
      endDate: t?.end_date ?? null,
      invoices: [],
    };
    g.invoices.push(withPayments(inv));
    groups.set(taskId, g);
  }
  return {
    job: { id: job.id, name: job.name, number: job.number },
    levels,
    milestones: [...groups.values()],
    invoices: unlinked,
  };
}
