/**
 * Report execution: authorized data → validated spec → computed widget results.
 *
 * Security properties:
 *   - Every field reference is resolved against the field catalog; unknown fields fail.
 *   - A widget (or filter/control) touching a field outside the viewer's categories returns
 *     status "restricted" with no values — restricted data never reaches the browser,
 *     exports, or tooltips. A dataset filtered on a restricted field is restricted too,
 *     so results can't be used to infer hidden values.
 *   - Only cached reporting rows and the live single-job detail are read.
 */

import "server-only";

import { agentDb } from "@/lib/agents/store";
import { getJobDetail, type JobDetail } from "@/lib/jobtread/detail";
import { isJobTreadConfigured, jobTreadJobUrl } from "@/lib/jobtread/client";
import { isJobTreadFixtureEnabled } from "@/lib/jobtread/fixture";
import { lastSuccessfulSync, runFullSync } from "@/lib/jobtread/sync";
import { reportDataHealth } from "./data-health";
import { applyValueMappings, listValueMappings } from "./mappings";
import { canSeeField, CATEGORY_LABELS, type ReportsAccess } from "./access";
import { computeCommissions, DEFAULT_COMMISSION_CONFIG, type CommissionJob } from "./commissions";
import { groupDocumentsByJob, jobFinancials, type DocumentRow } from "./financials";
import { getRuleSet, listAssignments, listRates } from "./rules";
import {
  aggregate,
  asList,
  asNumber,
  computeHistogram,
  computeSeries,
  filterRows,
  isBlank,
  matchesCondition,
  parseModelName,
  rowsForGroup,
  sortRows,
  type CellValue,
  type Row,
} from "./compute";
import {
  getFieldCatalog,
  invalidateFieldCatalog,
  resolveField,
  type FieldCatalog,
  type FieldDef,
} from "./fields";
import type {
  ControlOptions,
  ControlState,
  ExecutionResult,
  FieldMeta,
  Provenance,
  WidgetResult,
} from "./result-types";
import type { Condition, ControlSpec, DatasetSpec, Metric, ReportSpec, WidgetSpec } from "./spec";

const MAX_TABLE_ROWS = 1000;

type JobCacheRow = {
  id: string;
  number: string | null;
  name: string;
  source_created_at: string | null;
  location_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  customer_name: string | null;
  projected_price: number | string | null;
  projected_cost: number | string | null;
  actual_cost?: number | string | null;
  task_start: string | null;
  task_end: string | null;
  task_progress: number | string | null;
  job_fields: Record<string, string[]>;
  location_fields: Record<string, string[]>;
  customer_fields: Record<string, string[]>;
  synced_at: string;
};

type RegionRule = Parameters<typeof applyValueMappings>[1][number];

type ModelCacheRow = {
  id: string;
  name: string;
  description: string | null;
  item_count: number;
  total_cost: number | string | null;
  total_price: number | string | null;
  synced_at: string;
};

function convert(values: string[] | undefined, def: FieldDef): CellValue {
  if (!values || values.length === 0) return null;
  switch (def.type) {
    case "number":
    case "sqft":
    case "currency":
    case "percent":
      return asNumber(values[0]!);
    case "boolean":
      return /^(true|yes|1)$/i.test(values[0]!);
    case "list":
      return values;
    default:
      return values.length > 1 ? values.join("\n") : values[0]!;
  }
}

const num = (v: number | string | null) =>
  v === null || v === undefined ? null : asNumber(typeof v === "number" ? v : String(v));

/** Percent values are 0–100 (one decimal), matching how JobTread percent fields are entered. */
const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

export function jobRowFromCache(
  r: JobCacheRow,
  catalog: FieldCatalog,
  docs: DocumentRow[] = [],
): Row {
  const fin = jobFinancials(docs);
  const price = num(r.projected_price);
  const cost = num(r.projected_cost);
  const row: Row = {
    id: r.id,
    "job.name": r.name,
    "job.number": r.number,
    "job.createdAt": r.source_created_at?.slice(0, 10) ?? null,
    "job.customer": r.customer_name,
    "job.address": r.address,
    "job.city": r.city,
    "job.state": r.state,
    "job.scheduleStart": r.task_start,
    "job.scheduleEnd": r.task_end,
    "job.progress": num(r.task_progress),
    "job.projectedPrice": price,
    "job.projectedCost": cost,
    "job.projectedMargin":
      price !== null && cost !== null && (price !== 0 || cost !== 0)
        ? Math.round((price - cost) * 100) / 100
        : null,
    "job.projectedMarginPct": price && cost !== null ? pct(price - cost, price) : null,
    "job.actualCost": num(r.actual_cost ?? null),
    "job.orderPrice": fin.orderPrice,
    "job.orderCost": fin.orderCost,
    "job.orderGrossProfit": fin.orderGrossProfit,
    "job.orderMarginPct": fin.orderMarginPct,
    "job.orderStatus": fin.orderStatus,
    "job.orderDate": fin.orderDate,
    "job.invoicedTotal": fin.invoicedTotal,
    "job.amountPaid": fin.amountPaid,
    "job.balanceDue": fin.balanceDue,
    "job.lastInvoiceDate": fin.lastInvoiceDate,
  };
  for (const def of catalog.bySource.jobs) {
    if (!def.customFieldId) continue;
    const bag =
      def.target === "location"
        ? r.location_fields
        : def.target === "customer"
          ? r.customer_fields
          : r.job_fields;
    row[def.key] = convert(bag?.[def.customFieldId], def);
  }
  return row;
}

export function modelRowFromCache(r: ModelCacheRow, regionRules: RegionRule[] = []): Row {
  const { series, code } = parseModelName(r.name);
  const cost = r.item_count > 0 ? num(r.total_cost) : null;
  const price = r.item_count > 0 ? num(r.total_price) : null;
  return {
    id: r.id,
    "model.name": r.name,
    "model.series": series,
    "model.code": code,
    "model.region": applyValueMappings(r.name, regionRules),
    "model.description": r.description,
    "model.budgetStatus": r.item_count > 0 ? "Budget imported" : "Pending import",
    "model.itemCount": r.item_count,
    "model.baseCost": cost,
    "model.basePrice": price,
    "model.profit": cost !== null && price !== null ? Math.round((price - cost) * 100) / 100 : null,
    "model.marginPct": cost !== null && price ? pct(price - cost, price) : null,
  };
}

/** Catalog roots that are ADU models (excludes budget templates and selection libraries). */
export function isProductModel(r: Pick<ModelCacheRow, "description" | "name">): boolean {
  return /product library/i.test(r.description ?? "");
}

type DataCache = {
  jobs?: Row[];
  jobRaw?: JobCacheRow[];
  docs?: Map<string, DocumentRow[]>;
  models?: Row[];
  commissions?: Map<string, Row[]>;
  syncedAt: string | null;
};

async function loadDocs(cache: DataCache): Promise<Map<string, DocumentRow[]>> {
  if (!cache.docs) {
    const docs = await agentDb().select<DocumentRow>("jt_documents", {
      filters: [{ col: "removed_at", op: "is_null" }],
      limit: 20_000,
    });
    cache.docs = groupDocumentsByJob(docs);
  }
  return cache.docs;
}

async function loadJobs(catalog: FieldCatalog, cache: DataCache): Promise<Row[]> {
  if (!cache.jobs) {
    cache.jobRaw = await agentDb().select<JobCacheRow>("jt_jobs", {
      filters: [{ col: "removed_at", op: "is_null" }],
      limit: 20_000,
    });
    const docs = await loadDocs(cache);
    cache.jobs = cache.jobRaw.map((r) => jobRowFromCache(r, catalog, docs.get(r.id) ?? []));
  }
  return cache.jobs;
}

/** Commission rows for a rule set: JobTread jobs + documents × Baxter rates/assignments. */
async function loadCommissions(
  ruleSetKey: string,
  catalog: FieldCatalog,
  cache: DataCache,
): Promise<Row[]> {
  cache.commissions ??= new Map();
  const hit = cache.commissions.get(ruleSetKey);
  if (hit) return hit;
  const ruleSet = await getRuleSet(ruleSetKey);
  if (!ruleSet)
    throw new RefError(
      `The business rules "${ruleSetKey}" don't exist yet. Ask Dexter to set them up.`,
      false,
    );
  const jobRows = await loadJobs(catalog, cache);
  const docs = await loadDocs(cache);
  const rep = resolveField(catalog, "sem:sales_rep");
  const repKey = rep.ok ? rep.key : null;
  const [rates, assignments] = await Promise.all([
    listRates(ruleSet.id),
    listAssignments(ruleSet.id),
  ]);
  const jobs: CommissionJob[] = (cache.jobRaw ?? []).map((r, i) => ({
    id: r.id,
    name: r.name,
    number: r.number,
    salesReps: repKey ? asList(jobRows[i]?.[repKey]) : [],
    projectedPrice: num(r.projected_price),
    projectedCost: num(r.projected_cost),
    financials: jobFinancials(docs.get(r.id) ?? []),
  }));
  const rows = computeCommissions({
    config: { ...DEFAULT_COMMISSION_CONFIG, ...ruleSet.config },
    jobs,
    rates,
    assignments,
    today: new Date().toISOString().slice(0, 10),
  }).map((c): Row => ({
    id: c.id,
    "com.salesperson": c.salesperson,
    "com.jobName": c.jobName,
    "com.jobNumber": c.jobNumber,
    "com.assignmentSource": c.assignmentSource,
    "com.status": c.statusLabel,
    "com.date": c.commissionDate,
    "com.orderStatus": c.orderStatus,
    "com.grossProfit": c.grossProfit,
    "com.splitPct": c.splitPct,
    "com.ratePct": c.ratePct,
    "com.rateSource": c.rateSource,
    "com.commission": c.commission,
    "com.notes": c.notes.join(" "),
    "com.jobId": c.jobId,
  }));
  cache.commissions.set(ruleSetKey, rows);
  return rows;
}

async function loadSource(
  ds: Pick<DatasetSpec, "source" | "ruleSet">,
  catalog: FieldCatalog,
  cache: DataCache,
): Promise<Row[]> {
  if (ds.source === "jobs") return loadJobs(catalog, cache);
  if (ds.source === "commissions") return loadCommissions(ds.ruleSet ?? "", catalog, cache);
  if (!cache.models) {
    const rows = await agentDb().select<ModelCacheRow>("jt_catalog_models", {
      filters: [{ col: "removed_at", op: "is_null" }],
      limit: 5000,
    });
    // Region rules are optional admin data; without them model.region is simply blank.
    const regionRules = await listValueMappings("region")
      .then((rules) => rules.filter((x) => x.source_field === "model.name"))
      .catch(() => []);
    cache.models = rows.filter(isProductModel).map((r) => modelRowFromCache(r, regionRules));
  }
  return cache.models;
}

/** Authorized-agnostic source rows (callers apply field access). Used by Dexter's tools. */
export async function loadSourceRows(source: DatasetSpec["source"], ruleSet?: string) {
  const catalog = await getFieldCatalog();
  const rows = await loadSource({ source, ruleSet }, catalog, { syncedAt: null });
  return { catalog, rows };
}

class RefError extends Error {
  constructor(
    message: string,
    readonly restricted: boolean,
  ) {
    super(message);
  }
}

type Ctx = {
  spec: ReportSpec;
  catalog: FieldCatalog;
  access: ReportsAccess;
  state: ControlState;
  data: DataCache;
  issues: string[];
  live: Map<string, JobDetail | null>;
  liveFetchedAt: string | null;
};

/** Resolve a field reference for this viewer: returns the canonical key + def or throws RefError. */
function requireField(ctx: Ctx, ref: string): { key: string; def: FieldDef } {
  const r = resolveField(ctx.catalog, ref);
  if (!r.ok) throw new RefError(r.reason, false);
  if (!canSeeField(ctx.access, r.def)) {
    throw new RefError(`Requires "${CATEGORY_LABELS[r.def.category]}" access.`, true);
  }
  return r;
}

function canonicalConditions(ctx: Ctx, conds: Condition[]): Condition[] {
  return conds.map((c) => ({ ...c, field: requireField(ctx, c.field).key }));
}

function describeCondition(ctx: Ctx, c: Condition): string {
  const label = resolveField(ctx.catalog, c.field);
  const name = label.ok ? label.def.label : c.field;
  const value = Array.isArray(c.value) ? c.value.join(", ") : c.value;
  const ops: Record<string, string> = {
    eq: "is",
    neq: "is not",
    in: "is any of",
    not_in: "is none of",
    contains: "contains",
    not_contains: "doesn't contain",
    starts_with: "starts with",
    blank: "is blank",
    not_blank: "is not blank",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
  };
  return `${name} ${ops[c.op] ?? c.op}${value === undefined ? "" : ` ${value}`}`;
}

/** Dataset rows after dataset filters and interactive controls (except job pickers). */
async function datasetRows(ctx: Ctx, datasetId: string, applied: string[]): Promise<Row[]> {
  const ds = ctx.spec.datasets.find((d) => d.id === datasetId);
  if (!ds) throw new RefError(`Unknown dataset "${datasetId}".`, false);
  let rows = await loadSource(ds, ctx.catalog, ctx.data);
  rows = filterRows(rows, canonicalConditions(ctx, ds.filters));
  ds.filters.forEach((f) => applied.push(describeCondition(ctx, f)));
  for (const control of ctx.spec.controls) {
    if (control.kind === "job_picker" || !control.datasets.includes(datasetId)) continue;
    const value = ctx.state[control.id];
    if (control.kind === "select") {
      const selected = (Array.isArray(value) ? value : value ? [value] : control.default).filter(
        (v): v is string => typeof v === "string",
      );
      if (selected.length === 0) continue;
      const { key } = requireField(ctx, control.field);
      rows = rows.filter((r) =>
        matchesCondition(r[key], { field: key, op: "in", value: selected }),
      );
      applied.push(`${control.label}: ${selected.join(", ")}`);
    } else if (control.kind === "search") {
      const q = typeof value === "string" ? value.trim() : "";
      if (!q) continue;
      const keys = control.fields.map((f) => requireField(ctx, f).key);
      rows = rows.filter((r) =>
        keys.some((k) => asList(r[k]).some((v) => v.toLowerCase().includes(q.toLowerCase()))),
      );
      applied.push(`${control.label} contains "${q}"`);
    } else if (control.kind === "number_range" || control.kind === "date_range") {
      const [lo, hi] = Array.isArray(value) ? value : [null, null];
      if (lo == null && hi == null) continue;
      const { key } = requireField(ctx, control.field);
      rows = rows.filter(
        (r) =>
          (lo == null ||
            matchesCondition(r[key], { field: key, op: "gte", value: lo as string | number })) &&
          (hi == null ||
            matchesCondition(r[key], { field: key, op: "lte", value: hi as string | number })),
      );
      applied.push(`${control.label}: ${lo ?? "…"} – ${hi ?? "…"}`);
    }
  }
  return rows;
}

function metricLabel(ctx: Ctx, m: Metric): string {
  if (m.label) return m.label;
  if (m.op === "count") return "Count";
  const f = m.field ? resolveField(ctx.catalog, m.field) : null;
  const name = f && f.ok ? f.def.label : (m.field ?? "");
  const ops: Record<string, string> = {
    sum: "Total",
    avg: "Average",
    median: "Median",
    min: "Lowest",
    max: "Highest",
    count_distinct: "Distinct",
  };
  return `${ops[m.op] ?? m.op} ${name}`.trim();
}

function metricType(ctx: Ctx, m: Metric): FieldDef["type"] | "count" {
  if (m.op === "count" || m.op === "count_distinct" || !m.field) return "count";
  const f = resolveField(ctx.catalog, m.field);
  return f.ok ? f.def.type : "number";
}

function provenance(
  ctx: Ctx,
  input: {
    fields: string[];
    filters: string[];
    calculation: string;
    rows: number;
    withValue?: number;
    notes?: string[];
  },
): Provenance {
  const fields = [...new Set(input.fields)].flatMap((ref) => {
    const r = resolveField(ctx.catalog, ref);
    return r.ok ? [{ key: r.key, label: r.def.label, origin: r.def.origin }] : [];
  });
  return {
    source: "JobTread (Baxter reporting cache)",
    fields,
    filters: input.filters,
    calculation: input.calculation,
    rows: input.rows,
    withValue: input.withValue,
    notes: input.notes ?? [],
  };
}

function selectedJobId(ctx: Ctx, controlId: string, options: Row[]): string | null {
  const control = ctx.spec.controls.find((c) => c.id === controlId);
  if (!control || control.kind !== "job_picker") return null;
  const state = ctx.state[controlId];
  if (typeof state === "string" && options.some((r) => r.id === state)) return state;
  if (
    control.default &&
    control.default !== "first" &&
    options.some((r) => r.id === control.default)
  )
    return control.default;
  return options[0]?.id ?? null;
}

async function pickerSelection(
  ctx: Ctx,
  controlId: string,
): Promise<{ jobId: string | null; row: Row | null; detail: JobDetail | null }> {
  const control = ctx.spec.controls.find((c) => c.id === controlId);
  if (!control || control.kind !== "job_picker")
    throw new RefError(`Unknown job picker "${controlId}".`, false);
  const rows = await datasetRows(ctx, control.dataset, []);
  const jobId = selectedJobId(ctx, controlId, rows);
  const row = rows.find((r) => r.id === jobId) ?? null;
  if (!jobId) return { jobId: null, row: null, detail: null };
  if (!ctx.live.has(jobId)) {
    try {
      const detail = await getJobDetail(jobId);
      ctx.live.set(jobId, detail);
      if (detail) ctx.liveFetchedAt = detail.fetchedAt;
    } catch {
      ctx.live.set(jobId, null);
      ctx.issues.push("Live JobTread details were unavailable; showing the last synced values.");
    }
  }
  return { jobId, row, detail: ctx.live.get(jobId) ?? null };
}

async function runWidget(ctx: Ctx, w: WidgetSpec): Promise<WidgetResult> {
  const filtersApplied: string[] = [];
  switch (w.type) {
    case "text":
      return { id: w.id, kind: "text", status: "ok", body: w.body };
    case "rate_editor":
    case "assignment_editor": {
      // Rates and assignments are compensation data: financial access required to see them.
      if (!ctx.access.categories.has("financial"))
        throw new RefError(`Requires "${CATEGORY_LABELS.financial}" access.`, true);
      const ruleSet = await getRuleSet(w.ruleSet);
      return {
        id: w.id,
        kind: "rule_editor",
        status: ruleSet ? "ok" : "error",
        message: ruleSet ? undefined : `The business rules "${w.ruleSet}" don't exist yet.`,
        editor: w.type === "rate_editor" ? "rates" : "assignments",
        ruleSet: w.ruleSet,
        ruleSetName: ruleSet?.name ?? null,
        canEdit: ctx.access.canEditRules,
      };
    }
    case "kpi": {
      if (w.metric.field) requireField(ctx, w.metric.field);
      const rows = filterRows(
        await datasetRows(ctx, w.dataset, filtersApplied),
        canonicalConditions(ctx, w.filters),
      );
      w.filters.forEach((f) => filtersApplied.push(describeCondition(ctx, f)));
      const metric = {
        ...w.metric,
        field: w.metric.field ? requireField(ctx, w.metric.field).key : undefined,
      };
      const agg = aggregate(rows, metric);
      return {
        id: w.id,
        kind: "kpi",
        status: rows.length === 0 && w.metric.op !== "count" ? "empty" : "ok",
        value: agg.value,
        fieldType: metricType(ctx, w.metric),
        provenance: provenance(ctx, {
          fields: w.metric.field ? [w.metric.field] : [],
          filters: filtersApplied,
          calculation: `${metricLabel(ctx, w.metric)} across ${rows.length} record${rows.length === 1 ? "" : "s"}${agg.blank ? ` (${agg.blank} blank, excluded)` : ""}`,
          rows: rows.length,
          withValue: agg.counted,
        }),
      };
    }
    case "chart": {
      const rows = filterRows(
        await datasetRows(ctx, w.dataset, filtersApplied),
        canonicalConditions(ctx, w.filters),
      );
      w.filters.forEach((f) => filtersApplied.push(describeCondition(ctx, f)));
      if (w.chart === "scatter") {
        const x = requireField(ctx, w.x!);
        const y = requireField(ctx, w.y!);
        const labelKey =
          w.dataset &&
          ctx.spec.datasets.find((d) => d.id === w.dataset)?.source === "catalog_models"
            ? "model.name"
            : "job.name";
        const points = rows.flatMap((r) => {
          const xv = asNumber(r[x.key]);
          const yv = asNumber(r[y.key]);
          return xv !== null && yv !== null
            ? [{ id: r.id, label: String(r[labelKey] ?? r.id), x: xv, y: yv }]
            : [];
        });
        return {
          id: w.id,
          kind: "chart",
          status: points.length ? "ok" : "empty",
          points: [],
          seriesKeys: [],
          scatter: points,
          xLabel: x.def.label,
          yLabel: y.def.label,
          valueType: y.def.type,
          groupLabel: x.def.label,
          metricLabel: y.def.label,
          provenance: provenance(ctx, {
            fields: [w.x!, w.y!],
            filters: filtersApplied,
            calculation: `Each point is one record with both values present`,
            rows: rows.length,
            withValue: points.length,
          }),
        };
      }
      if (w.chart === "histogram") {
        const f = requireField(ctx, w.groupBy!);
        const points = computeHistogram(rows, f.key);
        return {
          id: w.id,
          kind: "chart",
          status: points.length ? "ok" : "empty",
          points,
          seriesKeys: [],
          valueType: "count",
          groupLabel: f.def.label,
          metricLabel: "Records",
          provenance: provenance(ctx, {
            fields: [w.groupBy!],
            filters: filtersApplied,
            calculation: `Distribution of ${f.def.label} in equal-width ranges`,
            rows: rows.length,
          }),
        };
      }
      const g = requireField(ctx, w.groupBy!);
      const s = w.seriesBy ? requireField(ctx, w.seriesBy) : null;
      const metric = {
        ...w.metric,
        field: w.metric.field ? requireField(ctx, w.metric.field).key : undefined,
      };
      const chronological = g.def.type === "date";
      const series = computeSeries({
        rows,
        groupBy: g.key,
        seriesBy: s?.key,
        metric,
        bucket: chronological ? (w.bucket ?? "month") : undefined,
        sort: w.sort,
        limit: w.limit,
        chronological,
      });
      const notes: string[] = [];
      if (series.multiValueNote)
        notes.push(`Some records have several ${g.def.label} values and are counted under each.`);
      return {
        id: w.id,
        kind: "chart",
        status: series.points.length ? "ok" : "empty",
        points: series.points,
        seriesKeys: series.seriesKeys,
        valueType: metricType(ctx, w.metric),
        groupLabel: g.def.label,
        metricLabel: metricLabel(ctx, w.metric),
        provenance: provenance(ctx, {
          fields: [
            w.groupBy!,
            ...(w.seriesBy ? [w.seriesBy] : []),
            ...(w.metric.field ? [w.metric.field] : []),
          ],
          filters: filtersApplied,
          calculation: `${metricLabel(ctx, w.metric)} grouped by ${g.def.label}${s ? ` and ${s.def.label}` : ""}`,
          rows: rows.length,
          notes,
        }),
      };
    }
    case "table": {
      // Columns outside the viewer's access are dropped (not blanked) so nothing hints at their values.
      const columns: Array<{ c: (typeof w.columns)[number]; f: { key: string; def: FieldDef } }> =
        [];
      const hidden: string[] = [];
      const missing: string[] = [];
      for (const c of w.columns) {
        try {
          columns.push({ c, f: requireField(ctx, c.field) });
        } catch (error) {
          if (!(error instanceof RefError)) throw error;
          // Drop the column, keep the table: restricted → hidden; unmapped/missing → explained.
          if (error.restricted) hidden.push(c.label || c.field);
          else missing.push(error.message);
        }
      }
      if (columns.length === 0) {
        if (hidden.length)
          throw new RefError("Every column in this table needs access you don't have.", true);
        throw new RefError(
          missing[0] ?? "None of this table's columns exist in the connected data.",
          false,
        );
      }
      const visibleKeys = new Set(columns.map((x) => x.f.key));
      const sort = w.sort.flatMap((s) => {
        const r = resolveField(ctx.catalog, s.field);
        return r.ok && visibleKeys.has(r.key) ? [{ field: r.key, dir: s.dir }] : [];
      });
      const highlight = w.highlight.flatMap((h) => {
        const r = resolveField(ctx.catalog, h.field);
        return r.ok && canSeeField(ctx.access, r.def) ? [{ ...h, field: r.key }] : [];
      });
      let rows = filterRows(
        await datasetRows(ctx, w.dataset, filtersApplied),
        canonicalConditions(ctx, w.filters),
      );
      w.filters.forEach((f) => filtersApplied.push(describeCondition(ctx, f)));
      if (w.groupBy) {
        const gb = resolveField(ctx.catalog, w.groupBy);
        if (gb.ok && canSeeField(ctx.access, gb.def)) sort.unshift({ field: gb.key, dir: "asc" });
      }
      rows = sortRows(rows, sort);
      const isJobs = ctx.spec.datasets.find((d) => d.id === w.dataset)?.source === "jobs";
      const meta: FieldMeta[] = columns.map(({ c, f }) => ({
        key: f.key,
        label: c.label || f.def.label,
        type:
          c.format !== "auto"
            ? c.format === "list"
              ? "list"
              : (c.format as FieldMeta["type"])
            : f.def.type,
        description: f.def.description,
        origin: f.def.origin,
        wrap: c.wrap || undefined,
      }));
      return {
        id: w.id,
        kind: "table",
        status: rows.length ? "ok" : "empty",
        columns: meta,
        rows: rows.slice(0, MAX_TABLE_ROWS).map((r) => ({
          id: r.id,
          cells: Object.fromEntries(columns.map(({ f }) => [f.key, r[f.key] ?? null])),
          tone: highlight.find((h) =>
            matchesCondition(r[h.field], { field: h.field, op: h.op, value: h.value }),
          )?.tone,
          jobtreadUrl: isJobs ? jobTreadJobUrl(r.id) : undefined,
        })),
        totalRows: rows.length,
        truncated: rows.length > MAX_TABLE_ROWS,
        message:
          [
            hidden.length ? `${hidden.length} column(s) hidden by your access level.` : null,
            ...missing.map((m) => `Column skipped: ${m}`),
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        provenance: provenance(ctx, {
          fields: columns.map((x) => x.c.field),
          filters: filtersApplied,
          calculation: "One row per record",
          rows: rows.length,
        }),
      };
    }
    case "project_header": {
      const { jobId, row, detail } = await pickerSelection(ctx, w.control);
      const live = detail
        ? jobRowFromCache(detail.job as unknown as JobCacheRow, ctx.catalog)
        : row;
      const badges: Array<{ label: string; value: string }> = [];
      for (const ref of w.fields) {
        try {
          const f = requireField(ctx, ref);
          const v = live?.[f.key];
          if (!isBlank(v))
            badges.push({ label: f.def.label, value: asList(v).join(", ") || String(v) });
        } catch {
          // Restricted or missing badge fields are skipped silently in the header.
        }
      }
      return {
        id: w.id,
        kind: "project_header",
        status: jobId ? "ok" : "empty",
        message: jobId ? undefined : "No jobs match this report's filters.",
        jobId,
        name: (live?.["job.name"] as string) ?? null,
        number: (live?.["job.number"] as string) ?? null,
        customer: (live?.["job.customer"] as string) ?? null,
        address:
          [live?.["job.address"], live?.["job.city"]].filter((v) => !isBlank(v)).join(", ") || null,
        badges,
        jobtreadUrl: jobId ? jobTreadJobUrl(jobId) : null,
        live: Boolean(detail),
      };
    }
    case "detail": {
      const { jobId, row, detail } = await pickerSelection(ctx, w.control);
      const live = detail
        ? jobRowFromCache(detail.job as unknown as JobCacheRow, ctx.catalog)
        : row;
      const items: Array<{
        key: string;
        label: string;
        type: FieldDef["type"];
        value: CellValue;
        restricted?: boolean;
        missing?: boolean;
      }> = [];
      let restrictedCount = 0;
      for (const item of w.fields) {
        const r = resolveField(ctx.catalog, item.field);
        if (!r.ok) {
          const sem = ctx.catalog.semantic.get(item.field);
          items.push({
            key: item.field,
            label: item.label || sem?.label || item.field,
            type: "text",
            value: null,
            missing: true,
          });
          continue;
        }
        if (!canSeeField(ctx.access, r.def)) {
          restrictedCount++;
          items.push({
            key: r.key,
            label: item.label || r.def.label,
            type: r.def.type,
            value: null,
            restricted: true,
          });
          continue;
        }
        items.push({
          key: r.key,
          label: item.label || r.def.label,
          type: item.format !== "auto" ? (item.format as FieldDef["type"]) : r.def.type,
          value: live?.[r.key] ?? null,
        });
      }
      return {
        id: w.id,
        kind: "detail",
        status: jobId ? "ok" : "empty",
        message: restrictedCount
          ? `${restrictedCount} field(s) hidden by your access level.`
          : undefined,
        jobId,
        items,
        live: Boolean(detail),
        provenance: provenance(ctx, {
          fields: w.fields.map((f) => f.field).filter((f) => resolveField(ctx.catalog, f).ok),
          filters: [],
          calculation: detail
            ? "Live values for the selected job"
            : "Last synced values for the selected job",
          rows: jobId ? 1 : 0,
        }),
      };
    }
    case "milestones": {
      const { jobId, detail } = await pickerSelection(ctx, w.control);
      const all = detail?.milestones ?? [];
      const milestones = all.filter(
        (m) =>
          w.show === "all" ||
          (w.show === "schedule" ? m.kind === "schedule" : m.kind === "checklist"),
      );
      return {
        id: w.id,
        kind: "milestones",
        status: !jobId ? "empty" : !detail ? "error" : milestones.length ? "ok" : "empty",
        message:
          jobId && !detail
            ? isJobTreadConfigured()
              ? "Couldn't load milestones from JobTread right now."
              : "JobTread isn't connected."
            : undefined,
        jobId,
        milestones,
      };
    }
    case "documents": {
      const { jobId, detail } = await pickerSelection(ctx, w.control);
      return {
        id: w.id,
        kind: "documents",
        status: !jobId ? "empty" : !detail ? "error" : detail.files.length ? "ok" : "empty",
        message: jobId && !detail ? "Couldn't load job files from JobTread right now." : undefined,
        jobId,
        files: detail?.files ?? [],
        jobtreadUrl: jobId ? jobTreadJobUrl(jobId) : null,
      };
    }
  }
}

function failed(w: WidgetSpec, error: unknown): WidgetResult {
  const restricted = error instanceof RefError && error.restricted;
  const message = error instanceof Error ? error.message : "This widget couldn't be calculated.";
  const base = {
    id: w.id,
    status: restricted ? ("restricted" as const) : ("error" as const),
    message,
  };
  switch (w.type) {
    case "kpi":
      return { ...base, kind: "kpi", value: null, fieldType: "count" };
    case "chart":
      return {
        ...base,
        kind: "chart",
        points: [],
        seriesKeys: [],
        valueType: "count",
        groupLabel: "",
        metricLabel: "",
      };
    case "table":
      return { ...base, kind: "table", columns: [], rows: [], totalRows: 0, truncated: false };
    case "detail":
      return { ...base, kind: "detail", jobId: null, items: [], live: false };
    case "project_header":
      return {
        ...base,
        kind: "project_header",
        jobId: null,
        name: null,
        number: null,
        customer: null,
        address: null,
        badges: [],
        jobtreadUrl: null,
        live: false,
      };
    case "milestones":
      return { ...base, kind: "milestones", jobId: null, milestones: [] };
    case "documents":
      return { ...base, kind: "documents", jobId: null, files: [], jobtreadUrl: null };
    case "text":
      return { ...base, kind: "text", body: "" };
    case "rate_editor":
    case "assignment_editor":
      return {
        ...base,
        kind: "rule_editor",
        editor: w.type === "rate_editor" ? "rates" : "assignments",
        ruleSet: w.ruleSet,
        ruleSetName: null,
        canEdit: false,
      };
  }
}

async function controlOptions(ctx: Ctx, control: ControlSpec): Promise<ControlOptions> {
  if (control.kind === "job_picker") {
    const rows = await datasetRows(ctx, control.dataset, []);
    const sorted = sortRows(rows, [{ field: "job.name", dir: "asc" }]);
    return {
      kind: "job_picker",
      id: control.id,
      options: sorted.map((r) => ({
        value: r.id,
        label: [r["job.number"], r["job.name"]].filter(Boolean).join(" · "),
      })),
      selected: selectedJobId(ctx, control.id, sorted),
    };
  }
  if (control.kind === "select") {
    try {
      const { key } = requireField(ctx, control.field);
      const counts = new Map<string, number>();
      for (const dsId of control.datasets.slice(0, 1)) {
        const ds = ctx.spec.datasets.find((d) => d.id === dsId)!;
        const base = filterRows(
          await loadSource(ds, ctx.catalog, ctx.data),
          canonicalConditions(ctx, ds.filters),
        );
        for (const r of base)
          for (const v of asList(r[key])) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const value = ctx.state[control.id];
      const selected = (Array.isArray(value) ? value : value ? [value] : control.default).filter(
        (v): v is string => typeof v === "string",
      );
      return {
        kind: "select",
        id: control.id,
        options: [...counts.entries()]
          .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
          .map(([v, c]) => ({ value: v, count: c })),
        selected,
      };
    } catch {
      return { kind: "select", id: control.id, options: [], selected: [], restricted: true };
    }
  }
  if (control.kind === "search") {
    const v = ctx.state[control.id];
    return { kind: "search", id: control.id, value: typeof v === "string" ? v : "" };
  }
  if (control.kind === "number_range") {
    const v = ctx.state[control.id];
    let min: number | null = null;
    let max: number | null = null;
    try {
      const { key } = requireField(ctx, control.field);
      const ds = ctx.spec.datasets.find((d) => d.id === control.datasets[0])!;
      for (const r of await loadSource(ds, ctx.catalog, ctx.data)) {
        const n = asNumber(r[key]);
        if (n === null) continue;
        min = min === null ? n : Math.min(min, n);
        max = max === null ? n : Math.max(max, n);
      }
    } catch {
      // restricted → no bounds
    }
    return {
      kind: "number_range",
      id: control.id,
      min,
      max,
      selected: Array.isArray(v) ? (v as [number | null, number | null]) : [null, null],
    };
  }
  const v = ctx.state[control.id];
  return {
    kind: "date_range",
    id: control.id,
    selected: Array.isArray(v) ? (v as [string | null, string | null]) : [null, null],
  };
}

/**
 * The last successful sync, running the first one if JobTread is connected but has never
 * been synced (so the first report or Dexter request sees real data, not an empty cache).
 */
export async function ensureJobTreadData() {
  const lastSync = await lastSuccessfulSync().catch(() => null);
  if (lastSync || !(isJobTreadConfigured() || isJobTreadFixtureEnabled())) return lastSync;
  const run = await runFullSync(isJobTreadFixtureEnabled() ? "e2e-fixture" : "first-use").catch(
    () => null,
  );
  if (run?.status !== "succeeded") return null;
  invalidateFieldCatalog();
  return lastSuccessfulSync();
}

export async function executeReport(input: {
  spec: ReportSpec;
  access: ReportsAccess;
  state?: ControlState;
  /** Run only these widgets (e.g. a single widget refresh). */
  widgetIds?: string[];
}): Promise<ExecutionResult> {
  const started = Date.now();
  const lastSync = await ensureJobTreadData();
  const catalog = await getFieldCatalog();
  const ctx: Ctx = {
    spec: input.spec,
    catalog,
    access: input.access,
    state: input.state ?? {},
    data: { syncedAt: lastSync?.finished_at ?? null },
    issues: [],
    live: new Map(),
    liveFetchedAt: null,
  };
  const controls: Record<string, ControlOptions> = {};
  for (const c of input.spec.controls) {
    try {
      controls[c.id] = await controlOptions(ctx, c);
    } catch (error) {
      ctx.issues.push(
        `Filter "${c.label}": ${error instanceof Error ? error.message : "unavailable"}`,
      );
    }
  }
  const widgets: Record<string, WidgetResult> = {};
  for (const w of input.spec.widgets) {
    if (w.hidden || (input.widgetIds && !input.widgetIds.includes(w.id))) continue;
    try {
      widgets[w.id] = await runWidget(ctx, w);
    } catch (error) {
      widgets[w.id] = failed(w, error);
    }
  }
  if (!lastSync)
    ctx.issues.push(
      "JobTread data hasn't been synced yet. An administrator can run a sync from Reports → Data settings.",
    );
  // Freshness of the datasets this report depends on. Never fails the execution.
  const dataHealth = await reportDataHealth(input.spec).catch(() => null);
  return {
    widgets,
    controls,
    freshness: {
      syncedAt: ctx.data.syncedAt,
      liveFetchedAt: ctx.liveFetchedAt,
      source: "JobTread",
      connected: isJobTreadConfigured(),
    },
    issues: [...new Set(ctx.issues)],
    restrictedWidgets: Object.values(widgets).filter((w) => w.status === "restricted").length,
    durationMs: Date.now() - started,
    dataHealth,
  };
}

/** Records behind a KPI, a chart segment, or a whole dataset (authorized columns only). */
export async function drilldown(input: {
  spec: ReportSpec;
  access: ReportsAccess;
  state?: ControlState;
  widgetId: string;
  groupKey?: string | null;
  seriesKey?: string | null;
}): Promise<{
  columns: FieldMeta[];
  rows: Array<{ id: string; cells: Record<string, CellValue>; jobtreadUrl?: string }>;
  total: number;
  title: string;
}> {
  const catalog = await getFieldCatalog();
  const ctx: Ctx = {
    spec: input.spec,
    catalog,
    access: input.access,
    state: input.state ?? {},
    data: { syncedAt: null },
    issues: [],
    live: new Map(),
    liveFetchedAt: null,
  };
  const w = input.spec.widgets.find((x) => x.id === input.widgetId);
  if (!w || !("dataset" in w)) throw new RefError("That widget can't be drilled into.", false);
  let rows = await datasetRows(ctx, w.dataset, []);
  if ("filters" in w) rows = filterRows(rows, canonicalConditions(ctx, w.filters));
  let title = w.title || "Records";
  if (w.type === "chart" && w.groupBy && input.groupKey && !input.groupKey.startsWith("Other (")) {
    const g = requireField(ctx, w.groupBy);
    rows = rowsForGroup(
      rows,
      g.key,
      input.groupKey,
      g.def.type === "date" ? (w.bucket ?? "month") : undefined,
    );
    if (w.seriesBy && input.seriesKey)
      rows = rowsForGroup(rows, requireField(ctx, w.seriesBy).key, input.seriesKey);
    title = `${g.def.label}: ${input.groupKey}${input.seriesKey ? ` · ${input.seriesKey}` : ""}`;
  }
  const source = input.spec.datasets.find((d) => d.id === w.dataset)!.source;
  const wanted =
    source === "jobs"
      ? [
          "job.name",
          "job.number",
          "sem:phase",
          "sem:project_manager",
          "sem:model",
          "sem:total_sqft",
        ]
      : source === "commissions"
        ? [
            "com.salesperson",
            "com.jobName",
            "com.status",
            "com.date",
            "com.grossProfit",
            "com.ratePct",
            "com.commission",
          ]
        : ["model.name", "model.series", "model.budgetStatus", "model.basePrice"];
  if (w.type === "kpi" && w.metric.field) wanted.push(w.metric.field);
  if (w.type === "chart" && w.metric.field) wanted.push(w.metric.field);
  const cols: FieldMeta[] = [];
  for (const ref of wanted) {
    const r = resolveField(catalog, ref);
    if (r.ok && canSeeField(input.access, r.def) && !cols.some((c) => c.key === r.key)) {
      cols.push({
        key: r.key,
        label: r.def.label,
        type: r.def.type,
        origin: r.def.origin,
        description: r.def.description,
      });
    }
  }
  rows = sortRows(rows, [
    {
      field:
        source === "jobs"
          ? "job.name"
          : source === "commissions"
            ? "com.salesperson"
            : "model.name",
      dir: "asc",
    },
  ]);
  return {
    title,
    columns: cols,
    total: rows.length,
    rows: rows.slice(0, 500).map((r) => ({
      id: r.id,
      cells: Object.fromEntries(cols.map((c) => [c.key, r[c.key] ?? null])),
      jobtreadUrl:
        source === "jobs"
          ? jobTreadJobUrl(r.id)
          : source === "commissions" && typeof r["com.jobId"] === "string"
            ? jobTreadJobUrl(r["com.jobId"])
            : undefined,
    })),
  };
}

/** Field existence + access problems for a spec, used when saving (Dexter and manual edits). */
export async function checkSpecFields(
  spec: ReportSpec,
  access: ReportsAccess,
  refs: string[],
): Promise<{ missing: string[]; restricted: string[] }> {
  const catalog = await getFieldCatalog();
  const missing: string[] = [];
  const restricted: string[] = [];
  for (const ref of refs) {
    const r = resolveField(catalog, ref);
    if (!r.ok) missing.push(`${ref}: ${r.reason}`);
    else if (!canSeeField(access, r.def))
      restricted.push(`${r.def.label} (${CATEGORY_LABELS[r.def.category]})`);
  }
  void spec;
  return { missing, restricted };
}
