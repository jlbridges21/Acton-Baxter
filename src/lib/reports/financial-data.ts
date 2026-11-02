/**
 * Financial reporting data: invoice-level document rows, payment rows, and task rows built
 * from the synced JobTread cache, plus the admin settings they depend on (status mapping,
 * balance policy, PP# mapping). Cached for a minute per server instance.
 *
 * Everything degrades honestly when migration 084 isn't applied: settings fall back to
 * defaults ("unknown" statuses, unverified balances) and callers are told the migration is
 * required instead of seeing zeros.
 */

import "server-only";

import { agentDb, eq, StoreError } from "@/lib/agents/store";
import type { Row } from "./compute";
import {
  DEFAULT_FINANCIAL_SETTINGS,
  DOCUMENT_TYPE_LABELS,
  indexPayments,
  invoiceFacts,
  LIFECYCLE_LABELS,
  LIFECYCLE_STATUSES,
  PAYMENT_STATUS_LABELS,
  paymentKind,
  signedPaymentAmount,
  toNum,
  VERIFICATION_LABELS,
  type FinancialDocumentRow,
  type FinancialSettings,
  type InvoiceFacts,
  type PaymentRow,
  type PaymentsState,
  type StatusMapEntry,
} from "./financial-core";
import {
  classifyDocument,
  DEFAULT_PP_CONFIG,
  effectiveLinks,
  milestonePctOf,
  ppConfigSchema,
  type PpConfig,
  type PpLinkRow,
} from "./pp-core";

export type TaskCacheRow = {
  id: string;
  job_id: string | null;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  progress: number | string | null;
  completed: number | string | null;
  is_group: boolean | null;
  is_to_do: boolean | null;
  parent_id?: string | null;
  source_created_at: string | null;
  synced_at: string | null;
};

type JobRef = {
  id: string;
  name: string;
  number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  closed_on: string | null;
  task_end: string | null;
};

type EntityState = {
  entity: string;
  enabled: boolean;
  status: string;
  last_success_at: string | null;
  records_cached: number | null;
  dropped_fields: string[] | null;
};

/** Missing table or column (migration not applied) — PostgREST and Postgres codes. */
export function isMissingSchema(error: unknown): boolean {
  if (!(error instanceof StoreError)) return false;
  return (
    ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code) ||
    /does not exist|could not find the/i.test(error.message)
  );
}

export const MIGRATION_084 = "084_financial_reporting.sql";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

type SettingsRow = {
  id: "default";
  status_map: StatusMapEntry[];
  balance_source: FinancialSettings["balanceSource"];
  overdue_grace_days: number;
  updated_by: string | null;
  updated_at: string;
};

export async function getFinancialSettings(): Promise<
  FinancialSettings & { migrated: boolean; updatedAt: string | null; updatedBy: string | null }
> {
  try {
    const [row] = await agentDb().select<SettingsRow>("bi_financial_settings", {
      filters: [eq("id", "default")],
      limit: 1,
    });
    return {
      statusMap: (row?.status_map ?? []).filter((m) =>
        (LIFECYCLE_STATUSES as readonly string[]).includes(m.lifecycle),
      ),
      balanceSource: row?.balance_source ?? DEFAULT_FINANCIAL_SETTINGS.balanceSource,
      overdueGraceDays: row?.overdue_grace_days ?? 0,
      migrated: true,
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? null,
    };
  } catch (error) {
    if (!isMissingSchema(error)) throw error;
    return { ...DEFAULT_FINANCIAL_SETTINGS, migrated: false, updatedAt: null, updatedBy: null };
  }
}

export async function saveFinancialSettings(patch: Partial<FinancialSettings>, actor: string) {
  const current = await getFinancialSettings();
  if (!current.migrated)
    throw new StoreError(
      `Financial settings need migration ${MIGRATION_084}.`,
      "MIGRATION_REQUIRED",
    );
  const next = {
    id: "default",
    status_map: patch.statusMap ?? current.statusMap,
    balance_source: patch.balanceSource ?? current.balanceSource,
    overdue_grace_days: patch.overdueGraceDays ?? current.overdueGraceDays,
    updated_by: actor,
    updated_at: new Date().toISOString(),
  };
  await agentDb().upsert("bi_financial_settings", next, ["id"]);
  invalidateFinancialContext();
  return getFinancialSettings();
}

export async function getPpConfig(): Promise<{
  config: PpConfig;
  version: number;
  migrated: boolean;
  updatedAt: string | null;
}> {
  try {
    const [row] = await agentDb().select<{ config: unknown; version: number; updated_at: string }>(
      "bi_pp_config",
      { filters: [eq("id", "default")], limit: 1 },
    );
    const parsed = ppConfigSchema.safeParse(row?.config ?? {});
    return {
      config: parsed.success ? parsed.data : DEFAULT_PP_CONFIG,
      version: row?.version ?? 0,
      migrated: true,
      updatedAt: row?.updated_at ?? null,
    };
  } catch (error) {
    if (!isMissingSchema(error)) throw error;
    return { config: DEFAULT_PP_CONFIG, version: 0, migrated: false, updatedAt: null };
  }
}

export async function savePpConfig(config: PpConfig, actor: string) {
  const current = await getPpConfig();
  if (!current.migrated)
    throw new StoreError(`PP# mapping needs migration ${MIGRATION_084}.`, "MIGRATION_REQUIRED");
  await agentDb().upsert(
    "bi_pp_config",
    {
      id: "default",
      config,
      version: current.version + 1,
      updated_by: actor,
      updated_at: new Date().toISOString(),
    },
    ["id"],
  );
  invalidateFinancialContext();
  return getPpConfig();
}

export async function listPpLinks(): Promise<PpLinkRow[]> {
  return agentDb()
    .select<PpLinkRow>("bi_pp_links", { limit: 50_000 })
    .catch((error) => {
      if (isMissingSchema(error)) return [];
      throw error;
    });
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type FinancialContext = {
  documents: FinancialDocumentRow[];
  payments: PaymentRow[];
  tasks: TaskCacheRow[];
  jobs: Map<string, JobRef>;
  settings: FinancialSettings;
  settingsMigrated: boolean;
  pp: { config: PpConfig; version: number; migrated: boolean };
  ppLinks: PpLinkRow[];
  paymentsState: PaymentsState;
  entities: Map<string, EntityState>;
  today: string;
};

let contextCache: { at: number; value: Promise<FinancialContext> } | null = null;

export function invalidateFinancialContext() {
  contextCache = null;
}

const safeSelect = <T>(table: string, q: Parameters<ReturnType<typeof agentDb>["select"]>[1]) =>
  agentDb()
    .select<T>(table, q)
    .catch(() => [] as T[]);

export function loadFinancialContext(
  today = new Date().toISOString().slice(0, 10),
): Promise<FinancialContext> {
  if (contextCache && Date.now() - contextCache.at < 60_000) return contextCache.value;
  const value = (async (): Promise<FinancialContext> => {
    const live = { filters: [{ col: "removed_at", op: "is_null" as const }] };
    const [documents, payments, tasks, jobs, settings, pp, ppLinks, states, catalog] =
      await Promise.all([
        safeSelect<FinancialDocumentRow>("jt_documents", { ...live, limit: 50_000 }),
        safeSelect<PaymentRow>("jt_payments", { ...live, limit: 100_000 }),
        safeSelect<TaskCacheRow>("jt_tasks", { ...live, limit: 100_000 }),
        safeSelect<JobRef>("jt_jobs", {
          ...live,
          columns: "id, name, number, customer_id, customer_name, closed_on, task_end",
          limit: 20_000,
        }),
        getFinancialSettings(),
        getPpConfig(),
        listPpLinks(),
        safeSelect<EntityState>("jt_sync_entities", { limit: 100 }),
        safeSelect<{ entity: string; record_count: number | null }>("jt_entity_catalog", {
          filters: [eq("entity", "payments")],
          limit: 1,
        }),
      ]);
    const entities = new Map(
      states.map((s) => [
        s.entity,
        { ...s, dropped_fields: Array.isArray(s.dropped_fields) ? s.dropped_fields : [] },
      ]),
    );
    const paymentEntity = entities.get("payments");
    return {
      documents,
      payments,
      tasks,
      jobs: new Map(jobs.map((j) => [j.id, j])),
      settings,
      settingsMigrated: settings.migrated,
      pp,
      ppLinks,
      paymentsState: {
        enabled: paymentEntity?.enabled ?? false,
        lastSucceededAt: paymentEntity?.last_success_at ?? null,
        sourceCount: catalog[0]?.record_count ?? null,
      },
      entities,
      today,
    };
  })();
  contextCache = { at: Date.now(), value };
  value.catch(() => {
    contextCache = null;
  });
  return value;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

export type DocumentWithFacts = { doc: FinancialDocumentRow; facts: InvoiceFacts };

export function documentsWithFacts(ctx: FinancialContext): DocumentWithFacts[] {
  const { byDocument } = indexPayments(ctx.payments);
  return ctx.documents.map((doc) => ({
    doc,
    facts: invoiceFacts(
      doc,
      byDocument.get(doc.id) ?? [],
      ctx.settings,
      ctx.paymentsState,
      ctx.today,
    ),
  }));
}

export function documentRows(ctx: FinancialContext): Row[] {
  const links = ctx.pp.migrated ? effectiveLinks(ctx.ppLinks, ctx.pp.config) : new Map();
  const allLinks = new Map(ctx.ppLinks.map((l) => [l.document_id, l]));
  const tasks = new Map(ctx.tasks.map((t) => [t.id, t]));
  return documentsWithFacts(ctx).map(({ doc, facts }) => {
    const job = doc.job_id ? ctx.jobs.get(doc.job_id) : undefined;
    const link = links.get(doc.id);
    const pp = link?.pp_number ?? classifyDocument(doc, ctx.pp.config);
    const isInvoice = doc.type === "customerInvoice";
    return {
      id: doc.id,
      "doc.id": doc.id,
      "doc.number": doc.number,
      "doc.name": doc.name,
      "doc.type": DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type,
      "doc.rawStatus": doc.status,
      "doc.lifecycle": LIFECYCLE_LABELS[facts.lifecycle],
      "doc.paymentStatus": PAYMENT_STATUS_LABELS[facts.paymentStatus],
      "doc.balanceVerification": VERIFICATION_LABELS[facts.verification],
      "doc.jobId": doc.job_id,
      "doc.job": job?.name ?? null,
      "doc.jobNumber": job?.number ?? null,
      "doc.customer": doc.account_name ?? job?.customer_name ?? null,
      "doc.customerId": doc.account_id ?? job?.customer_id ?? null,
      "doc.issueDate": day(doc.issue_date),
      "doc.dueDate": day(doc.due_date),
      "doc.daysPastDue": facts.daysPastDue,
      "doc.overdue": facts.overdue,
      "doc.amount": toNum(doc.price),
      "doc.tax": toNum(doc.tax),
      "doc.total": facts.total,
      "doc.cost": toNum(doc.cost),
      "doc.amountPaid": facts.amountPaid,
      "doc.balance": facts.balance,
      "doc.paymentsTotal": isInvoice ? facts.paymentsTotal : null,
      "doc.paymentCount": ctx.paymentsState.lastSucceededAt ? facts.paymentCount : null,
      "doc.lastPaymentDate": facts.lastPaymentDate,
      "doc.ppNumber": isInvoice ? pp : null,
      "doc.milestonePct": isInvoice
        ? (toNum(link?.milestone_pct ?? null) ?? milestonePctOf(doc, ctx.pp.config))
        : null,
      "doc.milestoneTaskId": link?.task_id ?? null,
      "doc.milestone": link?.task_id ? (tasks.get(link.task_id)?.name ?? null) : null,
      "doc.ppLinkStatus": isInvoice ? (allLinks.get(doc.id)?.status ?? (pp ? "none" : null)) : null,
      "doc.statusConflict": facts.conflict,
      "doc.createdAt": day(doc.source_created_at),
      "doc.updatedAt": day(doc.source_updated_at),
      "doc.signedAt": day(doc.signed_at),
      "doc.syncedAt": day(doc.synced_at),
      "doc.sourceRef": `JobTread document ${doc.id}`,
    };
  });
}

export function paymentRows(ctx: FinancialContext): Row[] {
  const { byId, possibleDuplicates } = indexPayments(ctx.payments);
  const docs = new Map(ctx.documents.map((d) => [d.id, d]));
  return [...byId.values()].map((p) => {
    const doc = p.document_id ? docs.get(p.document_id) : undefined;
    const jobId = p.job_id ?? doc?.job_id ?? null;
    return {
      id: p.id,
      "pay.id": p.id,
      "pay.amount": toNum(p.amount),
      "pay.signedAmount": signedPaymentAmount(p),
      "pay.kind": paymentKind(p),
      "pay.type": p.payment_type ?? null,
      "pay.date": day(p.paid_on),
      "pay.documentId": p.document_id,
      "pay.documentNumber": doc?.number ?? null,
      "pay.jobId": jobId,
      "pay.job": jobId ? (ctx.jobs.get(jobId)?.name ?? null) : null,
      "pay.possibleDuplicate": possibleDuplicates.has(p.id),
      "pay.createdAt": day(p.source_created_at),
      "pay.syncedAt": day(p.synced_at),
    };
  });
}

export function taskScheduleStatus(
  t: Pick<TaskCacheRow, "end_date" | "start_date" | "completed" | "progress">,
  today: string,
) {
  const complete = (toNum(t.completed) ?? 0) >= 1;
  if (complete) return "Complete";
  if (!t.end_date && !t.start_date) return "No dates";
  if (t.end_date && t.end_date < today) return "Late";
  if ((toNum(t.progress) ?? 0) > 0 || (t.start_date && t.start_date <= today)) return "In progress";
  return "Not started";
}

export function taskRows(ctx: FinancialContext): Row[] {
  return ctx.tasks.map((t) => {
    const job = t.job_id ? ctx.jobs.get(t.job_id) : undefined;
    const progress = toNum(t.progress);
    return {
      id: t.id,
      "task.id": t.id,
      "task.name": t.name,
      "task.jobId": t.job_id,
      "task.job": job?.name ?? null,
      "task.jobNumber": job?.number ?? null,
      "task.startDate": day(t.start_date),
      "task.endDate": day(t.end_date),
      "task.progress": progress === null ? null : Math.round(progress * 1000) / 10,
      "task.complete":
        t.completed === null || t.completed === undefined ? null : (toNum(t.completed) ?? 0) >= 1,
      "task.scheduleStatus": taskScheduleStatus(t, ctx.today),
      "task.isMilestoneGroup": t.is_group,
      "task.isToDo": t.is_to_do,
      "task.parentId": t.parent_id ?? null,
      "task.createdAt": day(t.source_created_at),
      "task.syncedAt": day(t.synced_at),
    };
  });
}

/** Report field keys whose JobTread attribute this grant doesn't return (sync dropped it). */
export function droppedFieldKeys(
  ctx: Pick<FinancialContext, "entities">,
  mapping: Record<string, { entity: string; attribute: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, m] of Object.entries(mapping)) {
    const dropped = ctx.entities.get(m.entity)?.dropped_fields ?? [];
    if (dropped.includes(m.attribute))
      out.set(
        key,
        `JobTread doesn't return ${m.entity}.${m.attribute} to Baxter's grant (unsupported by the API for this connection).`,
      );
  }
  return out;
}
