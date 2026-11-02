/**
 * PP# milestone mapping workflow: read-only preview of a configuration, suggested links from
 * the saved rule, review queues, and administrator decisions (approve, reject, manual
 * classification / task assignment). Links join by stable JobTread ids only — document id →
 * task id, both on the same job id. One row per invoice (unique document id), so a decision
 * is never duplicated, and approved / rejected / manual decisions survive syncs, rule runs,
 * and config changes (a later disagreement is flagged as a conflict, never reset).
 */

import "server-only";

import { agentDb, eq, StoreError } from "@/lib/agents/store";
import { ValidationError } from "@/lib/errors";
import {
  documentRows,
  getPpConfig,
  invalidateFinancialContext,
  isMissingSchema,
  listPpConfigHistory,
  loadFinancialContext,
  MIGRATION_084,
  paymentRows,
} from "./financial-data";
import {
  drillLevels,
  effectiveLinks,
  milestonePercent,
  PP_NUMBERS,
  previewPpMatches,
  type PpConfig,
  type PpLinkRow,
  type PreviewItem,
} from "./pp-core";

const MAX_TASKS_PER_PROJECT = 300;

/**
 * Preview a config (the saved one when none is given). Read-only: nothing is persisted.
 * Includes, for every project in a review queue, that project's tasks (for manual assignment).
 */
export async function ppPreview(config?: PpConfig) {
  const [ctx, saved, history] = await Promise.all([
    loadFinancialContext(),
    getPpConfig(),
    listPpConfigHistory(10),
  ]);
  const cfg = config ?? saved.config;
  const jobNames = new Map([...ctx.jobs.values()].map((j) => [j.id, j.name]));
  const preview = previewPpMatches(ctx.documents, ctx.tasks, ctx.ppLinks, cfg, jobNames);
  const reviewJobs = new Set(
    [
      ...preview.unclassified,
      ...preview.ambiguousClassification,
      ...preview.ambiguous,
      ...preview.unmatched,
    ]
      .map((i) => i.jobId)
      .filter((x): x is string => Boolean(x)),
  );
  const projectTasks: Record<
    string,
    Array<{ id: string; name: string | null; start: string | null; end: string | null }>
  > = {};
  for (const t of ctx.tasks) {
    if (!t.job_id || !reviewJobs.has(t.job_id)) continue;
    const list = (projectTasks[t.job_id] ??= []);
    if (list.length < MAX_TASKS_PER_PROJECT)
      list.push({ id: t.id, name: t.name, start: t.start_date, end: t.end_date });
  }
  const links = ctx.ppLinks.map((l) => ({
    ...l,
    jobName: l.job_id ? (jobNames.get(l.job_id) ?? null) : null,
    taskName: l.task_id ? (ctx.tasks.find((t) => t.id === l.task_id)?.name ?? null) : null,
    document: ctx.documents.find((d) => d.id === l.document_id)
      ? {
          number: ctx.documents.find((d) => d.id === l.document_id)!.number,
          name: ctx.documents.find((d) => d.id === l.document_id)!.name,
        }
      : null,
  }));
  return {
    config: cfg,
    saved: {
      version: saved.version,
      updatedAt: saved.updatedAt,
      updatedBy: saved.updatedBy,
      storedErrors: saved.storedErrors,
    },
    migrated: saved.migrated,
    history,
    preview,
    queues: {
      pending: links.filter((l) => l.status === "suggested"),
      approved: links.filter((l) => l.status === "approved"),
      rejected: links.filter((l) => l.status === "rejected"),
      conflicts: links.filter((l) => l.conflict),
    },
    projectTasks,
    tasksSynced: Boolean(ctx.entities.get("tasks")?.last_success_at),
  };
}

/**
 * Store a "suggested" link for every unique match under the *saved* config that has no
 * decision yet. Ambiguous and unmatched invoices are left for review. Approved, rejected, and
 * manual rows are never touched.
 */
export async function recordSuggestions() {
  const saved = await getPpConfig();
  if (!saved.migrated)
    throw new StoreError(`PP# links need migration ${MIGRATION_084}.`, "MIGRATION_REQUIRED");
  if (saved.config.classification.mode === "none")
    throw new ValidationError("Save a PP# classification rule first.");
  const { preview } = await ppPreview(saved.config);
  const ctx = await loadFinancialContext();
  const existing = new Map(ctx.ppLinks.map((l) => [l.document_id, l]));
  let created = 0;
  let refreshed = 0;
  let kept = 0;
  for (const item of preview.matched) {
    if (item.match?.status !== "matched") continue;
    const prior = existing.get(item.documentId);
    if (
      prior &&
      (prior.status !== "suggested" ||
        prior.match_method === "manual" ||
        prior.classification_method === "manual")
    ) {
      kept++;
      continue;
    }
    await agentDb().upsert(
      "bi_pp_links",
      {
        document_id: item.documentId,
        job_id: item.jobId,
        task_id: item.match.taskId,
        pp_number: String(item.pp),
        milestone_pct: null,
        classification_method: "rule",
        match_method: "rule",
        status: "suggested",
        config_version: saved.version,
        conflict: null,
        note: `Matched by ${item.match.via} (rule version ${saved.version})`,
        updated_at: new Date().toISOString(),
      },
      ["document_id"],
    );
    if (prior) refreshed++;
    else created++;
  }
  invalidateFinancialContext();
  return {
    created,
    refreshed,
    keptDecisions: kept,
    ambiguous: preview.ambiguous.length + preview.ambiguousClassification.length,
    unmatched: preview.unmatched.length,
    unclassified: preview.unclassified.length,
    autoAccept: saved.config.autoAcceptUnique,
    configVersion: saved.version,
  };
}

/**
 * An administrator's decision on one invoice:
 *   approve / reject — a suggested link
 *   manual           — choose the PP number (1–10) and optionally a task in the same project
 * Records approver and time on the invoice's single row.
 */
export async function decidePpLink(input: {
  documentId: string;
  decision: "approve" | "reject" | "manual";
  taskId?: string | null;
  ppNumber?: number | string | null;
  milestonePct?: number | null;
  note?: string | null;
  actor: string;
}): Promise<PpLinkRow> {
  const ctx = await loadFinancialContext();
  const doc = ctx.documents.find((d) => d.id === input.documentId);
  if (!doc) throw new ValidationError("That invoice isn't in the synced JobTread data.");
  if (doc.type !== "customerInvoice")
    throw new ValidationError("Only customer invoices can be PP# invoices.");
  if (!doc.job_id || !ctx.jobs.has(doc.job_id))
    throw new ValidationError("That invoice isn't on a synced project, so it can't be linked.");
  const now = new Date().toISOString();
  const prior = ctx.ppLinks.find((l) => l.document_id === doc.id) ?? null;
  let patch: Record<string, unknown>;
  if (input.decision === "manual") {
    const pp = Number(input.ppNumber ?? prior?.pp_number);
    if (!PP_NUMBERS.includes(pp as (typeof PP_NUMBERS)[number]))
      throw new ValidationError("Choose a PP number from 1 to 10.");
    let taskId: string | null = null;
    if (input.taskId) {
      const task = ctx.tasks.find((t) => t.id === input.taskId);
      if (!task) throw new ValidationError("That task isn't in the synced JobTread tasks.");
      if (task.job_id !== doc.job_id)
        throw new ValidationError("That task is in a different project than the invoice.");
      taskId = task.id;
    }
    patch = {
      document_id: doc.id,
      job_id: doc.job_id,
      task_id: taskId,
      pp_number: String(pp),
      milestone_pct: input.milestonePct ?? null,
      classification_method: "manual",
      match_method: "manual",
      status: "approved",
      conflict: null,
      config_version: ctx.pp.version,
    };
  } else {
    if (!prior) throw new ValidationError("There's no suggested link for this invoice yet.");
    patch = {
      ...prior,
      status: input.decision === "approve" ? "approved" : "rejected",
    };
  }
  const row = {
    ...patch,
    note: input.note ?? (patch.note as string | null) ?? null,
    decided_by: input.actor,
    decided_at: now,
    updated_at: now,
  };
  delete (row as Record<string, unknown>).id;
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
 * Project → PP# → Invoice → Task (→ Payments) for one job, scoped to that job only. Each
 * level appears only when its relationship is verified (drillLevels). Unapproved links are
 * shown as pending, never as the invoice's milestone. Amounts are JobTread's.
 */
export async function projectFinancialDrill(jobId: string) {
  const ctx = await loadFinancialContext();
  const job = ctx.jobs.get(jobId);
  if (!job) throw new ValidationError("That project isn't in the synced JobTread data.");
  const links = effectiveLinks(ctx.ppLinks, ctx.pp.config);
  const levels = drillLevels({
    tasksSynced: Boolean(ctx.entities.get("tasks")?.last_success_at) || ctx.tasks.length > 0,
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
  const shape = (inv: Record<string, unknown>) => ({
    id: inv.id,
    number: inv["doc.number"],
    name: inv["doc.name"],
    total: inv["doc.total"],
    lifecycle: inv["doc.lifecycle"],
    paymentStatus: inv["doc.paymentStatus"],
    balanceVerification: inv["doc.balanceVerification"],
    ppApproval: inv["doc.ppApproval"],
    task:
      on("task") && inv["doc.milestoneTaskId"]
        ? {
            id: inv["doc.milestoneTaskId"],
            name: inv["doc.milestone"],
            scheduledStart: inv["doc.milestoneStart"],
            scheduledEnd: inv["doc.milestoneEnd"],
            complete: inv["doc.milestoneComplete"],
          }
        : null,
    payments: on("payments") ? payments.filter((p) => p["pay.documentId"] === inv.id) : null,
  });
  if (!on("pp"))
    return {
      job: { id: job.id, name: job.name, number: job.number },
      levels,
      pp: null,
      invoices: invoices.map(shape),
    };
  const schedule = PP_NUMBERS.map((n) => {
    const pct = milestonePercent(ctx.pp.config, n, jobId);
    return {
      pp: n,
      percent: pct.pct,
      percentSource: pct.source,
      invoices: invoices.filter((i) => i["doc.ppNumber"] === n).map(shape),
    };
  });
  return {
    job: { id: job.id, name: job.name, number: job.number },
    levels,
    pp: schedule,
    invoices: invoices.filter((i) => !i["doc.ppNumber"]).map(shape),
  };
}

export type { PreviewItem };
