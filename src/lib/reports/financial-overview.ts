/**
 * Financial reporting overview: reconciliation totals, outstanding by Project Manager, the
 * Project Manager audit, and readiness for Reports → Data settings and Dexter. Reads the
 * synced cache only; never calls JobTread.
 */

import "server-only";

import { agentDb } from "@/lib/agents/store";
import { analyzeAliases } from "@/lib/jobtread/alias-audit";
import { listCustomFields, listSemanticFields } from "@/lib/jobtread/metadata";
import { asList } from "./compute";
import {
  documentsWithFacts,
  isMissingSchema,
  loadFinancialContext,
  type FinancialContext,
} from "./financial-data";
import {
  reconcileInvoices,
  statusInventory,
  toNum,
  type ReconciliationTotals,
} from "./financial-core";
import { auditProjectManager, type PmAudit } from "./pm-audit-core";
import { effectiveLinks, previewPpMatches } from "./pp-core";
import { computeReadiness, historicalDiagnostics } from "./readiness-core";

export type JobAttributes = Map<string, { pm: string | null; phase: string | null; name: string }>;

/** Project Manager and Phase per job id, through the business-field mapping (never guessed). */
export async function jobAttributes(): Promise<JobAttributes> {
  const { loadSourceRows } = await import("./engine");
  const { resolveField } = await import("./fields");
  const { catalog, rows } = await loadSourceRows("jobs");
  const pm = resolveField(catalog, "sem:project_manager");
  const phase = resolveField(catalog, "sem:phase");
  const out: JobAttributes = new Map();
  for (const r of rows) {
    const pmVals = pm.ok ? asList(r[pm.key]) : [];
    const phaseVals = phase.ok ? asList(r[phase.key]) : [];
    out.set(r.id, {
      pm: pmVals.length ? pmVals.join(", ") : null,
      phase: phaseVals.length ? phaseVals.join(", ") : null,
      name: String(r["job.name"] ?? r.id),
    });
  }
  return out;
}

export type FinancialSnapshotInputs = {
  ctx: FinancialContext;
  totals: ReconciliationTotals;
  invoices: ReturnType<typeof documentsWithFacts>;
  outstandingByPm: Array<{
    pm: string | null;
    balance: number | null;
    verified: boolean;
    jobId: string | null;
  }>;
};

export async function financialState(filter?: {
  jobIds?: Set<string>;
  pm?: string;
}): Promise<FinancialSnapshotInputs> {
  const ctx = await loadFinancialContext();
  const attrs = await jobAttributes().catch(() => new Map() as JobAttributes);
  let invoices = documentsWithFacts(ctx).filter((i) => i.doc.type === "customerInvoice");
  if (filter?.jobIds)
    invoices = invoices.filter((i) => i.doc.job_id && filter.jobIds!.has(i.doc.job_id));
  if (filter?.pm) {
    const want = filter.pm.trim().toLowerCase();
    invoices = invoices.filter((i) =>
      (attrs.get(i.doc.job_id ?? "")?.pm ?? "").toLowerCase().split(", ").includes(want),
    );
  }
  const totals = reconcileInvoices(invoices, ctx.paymentsState, ctx.settings);
  const outstandingByPm = invoices
    .filter((i) => ["issued", "partially_paid", "paid"].includes(i.facts.lifecycle))
    .map((i) => ({
      pm: attrs.get(i.doc.job_id ?? "")?.pm ?? null,
      balance: i.facts.balance,
      verified: i.facts.verification === "verified" || i.facts.verification === "accepted",
      jobId: i.doc.job_id,
    }));
  return { ctx, totals, invoices, outstandingByPm };
}

export async function projectManagerAudit(): Promise<PmAudit> {
  const [semantic, fields, jobs, attrs] = await Promise.all([
    listSemanticFields(),
    listCustomFields({ includeRemoved: true }),
    agentDb().select<{
      id: string;
      name: string;
      number: string | null;
      closed_on: string | null;
      job_fields: Record<string, string[]>;
    }>("jt_jobs", {
      filters: [{ col: "removed_at", op: "is_null" }],
      columns: "id, name, number, closed_on, job_fields",
      limit: 20_000,
    }),
    jobAttributes().catch(() => new Map() as JobAttributes),
  ]);
  const sem = semantic.find((s) => s.key === "project_manager");
  const cf = sem?.custom_field_id ? fields.find((f) => f.id === sem.custom_field_id) : undefined;
  const alias = sem ? analyzeAliases(semantic, fields).get(sem.key) : undefined;
  const field = sem
    ? {
        semanticKey: sem.key,
        label: sem.label,
        customFieldId: sem.custom_field_id,
        fieldName: cf?.name ?? null,
        category: cf?.category ?? null,
        targetType: cf?.target_type ?? null,
        options: cf?.options ?? [],
        removed: Boolean(sem.custom_field_id && (!cf || cf.removed_at)),
        aliasStatus: alias?.status ?? null,
      }
    : null;
  return auditProjectManager({
    field,
    jobs: jobs.map((j) => ({
      id: j.id,
      name: j.name,
      number: j.number,
      closed: Boolean(j.closed_on),
      phase: attrs.get(j.id)?.phase ?? null,
      values: cf ? (j.job_fields?.[cf.id] ?? null) : null,
    })),
  });
}

async function countRows(
  table: string,
  filters: Array<{ col: string; op: "eq"; value: unknown }> = [],
) {
  try {
    return {
      n: (await agentDb().select(table, { filters, columns: "id", limit: 100_000 })).length,
      migrated: true,
    };
  } catch (error) {
    return { n: 0, migrated: !isMissingSchema(error) };
  }
}

export async function financialReadiness() {
  const [state, pm, snapshotSettings, runs, rules, openEvents, catalog] = await Promise.all([
    financialState(),
    projectManagerAudit().catch(() => null),
    agentDb()
      .select<{ enabled: boolean }>("bi_snapshot_settings", { limit: 1 })
      .catch(() => null),
    agentDb()
      .select<{ period_start: string; status: string }>("bi_snapshot_runs", {
        order: { col: "period_start", ascending: false },
        limit: 200,
      })
      .catch(() => [] as Array<{ period_start: string; status: string }>),
    agentDb()
      .select<{
        kind: string;
        enabled: boolean;
        config: unknown;
        recipients: unknown;
        channel: string;
        slack_channel: string | null;
      }>("bi_alert_rules", { limit: 200 })
      .catch(() => []),
    countRows("bi_alert_events", [{ col: "status", op: "eq", value: "open" }]),
    agentDb()
      .select<{ entity: string; record_count: number | null }>("jt_entity_catalog", { limit: 50 })
      .catch(() => []),
  ]);
  const { ctx, invoices } = state;
  const inventory = statusInventory(ctx.documents, ctx.settings.statusMap);
  const unmapped = inventory.filter((r) => r.lifecycle === "unknown");
  const pp = previewPpMatches(ctx.documents, ctx.tasks, ctx.ppLinks, ctx.pp.config);
  const ent = (k: string) => {
    const s = ctx.entities.get(k);
    return s
      ? {
          enabled: s.enabled,
          lastSuccessAt: s.last_success_at,
          recordsCached: s.records_cached,
          dropped: s.dropped_fields ?? [],
        }
      : undefined;
  };
  const { ruleProblem } = await import("./alert-core");
  const invalid = rules.filter(
    (r) =>
      r.enabled &&
      ruleProblem({
        kind: r.kind as never,
        config: (r.config ?? {}) as Record<string, unknown>,
        recipients: Array.isArray(r.recipients) ? (r.recipients as never[]) : [],
        channel: r.channel as "in_app" | "slack",
        slack_channel: r.slack_channel,
      }) !== null,
  ).length;
  const jobIds = new Set(ctx.jobs.keys());
  const sourceCount = (e: string) => catalog.find((c) => c.entity === e)?.record_count ?? null;
  const pmMappingDefect = pm?.defects.find((d) => d.class !== "source_data")?.message ?? null;
  const areas = computeReadiness({
    migrated: ctx.settingsMigrated,
    entities: {
      documents: ent("documents"),
      payments: ent("payments"),
      tasks: ent("tasks"),
      jobs: ent("jobs"),
    },
    sourceCounts: {
      documents: sourceCount("documents"),
      payments: sourceCount("payments"),
      tasks: sourceCount("tasks"),
    },
    documents: {
      total: ctx.documents.length,
      invoices: invoices.length,
      unmappedStatuses: unmapped.length,
      unmappedInvoices: unmapped
        .filter((u) => u.type === "customerInvoice")
        .reduce((s, u) => s + u.count, 0),
    },
    payments: {
      synced: ctx.payments.length,
      mismatches: invoices.filter((i) => i.facts.verification === "mismatch").length,
      verifiedInvoices: invoices.filter((i) => i.facts.verification === "verified").length,
      balanceSource: ctx.settings.balanceSource,
    },
    tasks: {
      total: ctx.tasks.length,
      jobsWithTasks: new Set(ctx.tasks.map((t) => t.job_id).filter(Boolean)).size,
      orphaned: ctx.tasks.filter((t) => t.job_id && !jobIds.has(t.job_id)).length,
    },
    pm: {
      completenessPct: pm?.completenessPct ?? null,
      mappingDefect: pmMappingDefect,
      populated: pm?.populated ?? 0,
      total: pm?.totalJobs ?? 0,
    },
    pp: {
      configured: pp.configured,
      classified: pp.classified,
      approved: effectiveLinks(ctx.ppLinks, ctx.pp.config).size,
      ambiguous: pp.ambiguous.length,
      unmatched: pp.unmatched.length,
    },
    snapshots: {
      enabled: Boolean(snapshotSettings?.[0]?.enabled),
      lastPeriod: runs.find((r) => r.status === "succeeded")?.period_start ?? null,
      runs: runs.filter((r) => r.status === "succeeded").length,
    },
    alerts: {
      rules: rules.length,
      enabled: rules.filter((r) => r.enabled).length,
      invalid,
      open: openEvents.n,
    },
  });
  const diagnostics = historicalDiagnostics({
    invoices: invoices.map((i) => i.doc),
    payments: ctx.payments,
    documentIds: new Set(ctx.documents.map((d) => d.id)),
    jobIds,
  });
  return {
    areas,
    totals: state.totals,
    statusInventory: inventory,
    diagnostics,
    pm,
    counts: {
      jobs: ctx.jobs.size,
      documents: ctx.documents.length,
      invoices: invoices.length,
      invoicesWithBalance: invoices.filter((i) => (toNum(i.doc.balance) ?? 0) > 0).length,
      payments: ctx.payments.length,
      tasks: ctx.tasks.length,
      ppIdentified: pp.classified,
      invoiceMilestoneLinks: effectiveLinks(ctx.ppLinks, ctx.pp.config).size,
      snapshots: runs.filter((r) => r.status === "succeeded").length,
    },
    settings: { ...ctx.settings, migrated: ctx.settingsMigrated },
    paymentsState: ctx.paymentsState,
    generatedAt: new Date().toISOString(),
  };
}
