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
import {
  costItemRow,
  optionGroupsByRoot,
  type CostGroupCacheRow,
  type CostItemCacheRow,
} from "./cost-items";
import { applyValueMappings, listValueMappings } from "./mappings";
import {
  aggregateCalcNumber,
  applyCalculations,
  isCalcCatalog,
  type CalcCatalog,
} from "./calculations";
import { buildGroupTree, type GroupColumn } from "./grouping";
import { catalogFor } from "./metrics";
import { attachRelated, relationshipsFrom } from "./relationships";
import { ID_FIELDS, isRelCatalog } from "./report-relationships";
import { firstRuleStyle } from "./style";
import { SOURCE_REGISTRY } from "./sources";
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
  type RunMetric,
} from "./compute";
import {
  fieldOnSource,
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
import { collectDatasetFieldRefs } from "./spec";
import type {
  Condition,
  ControlSpec,
  DatasetSpec,
  Metric,
  ReportSource,
  ReportSpec,
  WidgetSpec,
} from "./spec";

const MAX_TABLE_ROWS = 1000;
/** Grouped tables send their records with the groups (lazy UI); capped for the browser. */
const MAX_GROUPED_ROWS = 5000;

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

export function modelRowFromCache(
  r: ModelCacheRow,
  regionRules: RegionRule[] = [],
  options?: { groups: Set<string>; options: number },
): Row {
  const { series, code } = parseModelName(r.name);
  const cost = r.item_count > 0 ? num(r.total_cost) : null;
  const price = r.item_count > 0 ? num(r.total_price) : null;
  return {
    id: r.id,
    "model.name": r.name,
    "model.series": series,
    "model.code": code,
    "model.region": applyValueMappings(r.name, regionRules),
    "model.optionGroups": options ? [...options.groups].sort() : [],
    "model.optionCount": options?.options ?? 0,
    "model.description": r.description,
    "model.budgetStatus": r.item_count > 0 ? "Budget imported" : "Pending import",
    "model.itemCount": r.item_count,
    "model.baseCost": cost,
    "model.basePrice": price,
    "model.profit": cost !== null && price !== null ? Math.round((price - cost) * 100) / 100 : null,
    "model.marginPct": cost !== null && price ? pct(price - cost, price) : null,
  };
}

/**
 * Catalog roots that are ADU models (excludes budget templates and selection libraries).
 *
 * With admin model-scope rules (bi_value_mappings kind "model_scope"): every top-level catalog
 * group is a model unless an "exclude" rule matches; if any "include" rule exists, only
 * matching groups count. Without rules, the original rule applies (description mentions
 * "Product Library") — it misses models whose description JobTread users replaced.
 */
export function isProductModel(
  r: Pick<ModelCacheRow, "description" | "name">,
  scopeRules?: RegionRule[],
): boolean {
  if (!scopeRules?.length) return /product library/i.test(r.description ?? "");
  const verdict = applyValueMappings(r.name, scopeRules);
  if (verdict === "exclude") return false;
  if (verdict === "include") return true;
  return !scopeRules.some((x) => x.value === "include");
}

/** Model-scope rules (empty when none are configured or the table isn't migrated). */
export async function loadModelScopeRules(): Promise<RegionRule[]> {
  return listValueMappings("model_scope")
    .then((rules) => rules.filter((x) => x.source_field === "model.name"))
    .catch(() => []);
}

type DataCache = {
  jobs?: Row[];
  jobRaw?: JobCacheRow[];
  docs?: Map<string, DocumentRow[]>;
  models?: Row[];
  items?: Row[];
  commissions?: Map<string, Row[]>;
  /** Rows with rollups and row calculations applied, per source (+ rule set). */
  enriched?: Map<string, Row[]>;
  /** Jobs and models with related fields attached. */
  jobsRelated?: Row[];
  modelsRelated?: Row[];
  /** Lookup join health per relationship id. */
  joinStats?: Map<
    string,
    { label: string; from: ReportSource; to: ReportSource; linked: number; matched: number }
  >;
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

/**
 * Attach approved related fields (e.g. a budget line's job Phase) by stable id. Rows are
 * never added or dropped, so totals over the source are unchanged.
 */
async function withRelatedFields(
  source: ReportSource,
  rows: Row[],
  catalog: FieldCatalog,
  cache: DataCache,
): Promise<Row[]> {
  let out = rows;
  const byRelationship = new Map<string, string[]>();
  for (const f of catalog.related[source].values())
    byRelationship.set(f.relationship, [...(byRelationship.get(f.relationship) ?? []), f.key]);
  for (const [id, keys] of byRelationship) {
    const rel = isRelCatalog(catalog)
      ? catalog.lookupDefs.get(id)
      : relationshipsFrom(source).find((r) => r.id === id);
    if (!rel || rel.from !== source) continue;
    const targets = await loadRawSource(rel.to, catalog, cache);
    const index = new Map(targets.map((t) => [t.id, t]));
    out = attachRelated(out, rel, index, keys);
    // Join health: how many linked rows found their related record (surfaced as an issue).
    let linked = 0;
    let matched = 0;
    for (const r of rows) {
      const v = r[rel.key];
      if (typeof v !== "string" || !v) continue;
      linked++;
      if (index.has(v)) matched++;
    }
    cache.joinStats ??= new Map();
    cache.joinStats.set(id, { label: rel.label, from: source, to: rel.to, linked, matched });
  }
  return out;
}

/** Rows of a source without related fields or calculations (lookup targets). */
async function loadRawSource(
  source: ReportSource,
  catalog: FieldCatalog,
  cache: DataCache,
): Promise<Row[]> {
  if (source === "jobs") return loadJobs(catalog, cache);
  const context = await loadCatalogContext();
  if (source === "catalog_models") return context.modelRows;
  if (source === "cost_items") return context.items();
  return [];
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

/**
 * Source rows with approved related fields, rollups, and row calculations applied.
 * Cached per execution; never adds or drops records.
 */
async function loadSource(
  ds: Pick<DatasetSpec, "source" | "ruleSet">,
  catalog: FieldCatalog,
  cache: DataCache,
): Promise<Row[]> {
  const base = await loadBaseSource(ds, catalog, cache);
  if (!isCalcCatalog(catalog) || !catalog.calcOrder[ds.source].length) return base;
  cache.enriched ??= new Map();
  const key = `${ds.source}|${ds.ruleSet ?? ""}`;
  const hit = cache.enriched.get(key);
  if (hit) return hit;
  const rows = await applyCalculations(catalog, ds.source, base, (source, ruleSet) =>
    loadSource({ source, ruleSet }, catalog, cache),
  );
  cache.enriched.set(key, rows);
  return rows;
}

async function loadBaseSource(
  ds: Pick<DatasetSpec, "source" | "ruleSet">,
  catalog: FieldCatalog,
  cache: DataCache,
): Promise<Row[]> {
  if (ds.source === "jobs") {
    cache.jobsRelated ??= await withRelatedFields(
      "jobs",
      await loadJobs(catalog, cache),
      catalog,
      cache,
    );
    return cache.jobsRelated;
  }
  if (ds.source === "commissions") {
    const key = `related|${ds.ruleSet ?? ""}`;
    cache.commissions ??= new Map();
    const hit = cache.commissions.get(key);
    if (hit) return hit;
    const rows = await withRelatedFields(
      "commissions",
      await loadCommissions(ds.ruleSet ?? "", catalog, cache),
      catalog,
      cache,
    );
    cache.commissions.set(key, rows);
    return rows;
  }
  if (ds.source === "cost_items") {
    if (!cache.items) {
      const items = (await loadCatalogContext()).items();
      cache.items = await withRelatedFields("cost_items", items, catalog, cache);
    }
    return cache.items;
  }
  if (!cache.models) {
    const c = await loadCatalogContext();
    cache.models = c.modelRows;
  }
  cache.modelsRelated ??= await withRelatedFields("catalog_models", cache.models, catalog, cache);
  return cache.modelsRelated;
}

/**
 * Product Library models + cost items, resolved through the cost-group hierarchy. Cached for
 * a minute per server instance: ~18k items and ~4k groups are read once, not per widget.
 */
let catalogContextCache: {
  at: number;
  value: Promise<{ modelRows: Row[]; items: () => Row[] }>;
} | null = null;

export function invalidateCatalogContext() {
  catalogContextCache = null;
}

export function loadCatalogContext() {
  if (catalogContextCache && Date.now() - catalogContextCache.at < 60_000)
    return catalogContextCache.value;
  const value = (async () => {
    const db = agentDb();
    const [models, regionRules, scopeRules, optionRules, groups] = await Promise.all([
      db.select<ModelCacheRow>("jt_catalog_models", {
        filters: [{ col: "removed_at", op: "is_null" }],
        limit: 5000,
      }),
      // Region rules are optional admin data; without them model.region is simply blank.
      listValueMappings("region")
        .then((rules) => rules.filter((x) => x.source_field === "model.name"))
        .catch(() => []),
      loadModelScopeRules(),
      listValueMappings("option_group").catch(() => []),
      db
        .select<CostGroupCacheRow>("jt_cost_groups", {
          filters: [{ col: "removed_at", op: "is_null" }],
          columns: "id, name, parent_id, job_id",
          limit: 50_000,
        })
        .catch(() => [] as CostGroupCacheRow[]),
    ]);
    const groupIndex = new Map(groups.map((g) => [g.id, g]));
    const optionsByRoot = optionGroupsByRoot(groupIndex, optionRules);
    const productModels = models.filter((m) => isProductModel(m, scopeRules));
    const modelRows = productModels.map((r) =>
      modelRowFromCache(r, regionRules, optionsByRoot.get(r.id)),
    );
    const modelRefs = new Map(
      modelRows.map((m) => [
        m.id,
        {
          id: m.id,
          name: String(m["model.name"]),
          series: (m["model.series"] as string | null) ?? null,
          region: (m["model.region"] as string | null) ?? null,
        },
      ]),
    );
    let itemRows: Row[] | null = null;
    const loadItems = async () => {
      const [items, jobs] = await Promise.all([
        db
          .select<CostItemCacheRow>("jt_cost_items", {
            filters: [{ col: "removed_at", op: "is_null" }],
            limit: 100_000,
          })
          .catch(() => [] as CostItemCacheRow[]),
        db.select<{ id: string; name: string; number: string | null }>("jt_jobs", {
          filters: [{ col: "removed_at", op: "is_null" }],
          columns: "id, name, number",
          limit: 20_000,
        }),
      ]);
      const ctx = {
        groups: groupIndex,
        models: modelRefs,
        jobs: new Map(jobs.map((j) => [j.id, { name: j.name, number: j.number }])),
        optionRules,
      };
      itemRows = items.map((i) => costItemRow(i, ctx));
    };
    await loadItems();
    return { modelRows, items: () => itemRows ?? [] };
  })();
  catalogContextCache = { at: Date.now(), value };
  value.catch(() => {
    catalogContextCache = null;
  });
  return value;
}

/** Authorized-agnostic source rows (callers apply field access). Used by Dexter's tools. */
export async function loadSourceRows(
  source: DatasetSpec["source"],
  ruleSet?: string,
  spec?: Partial<Pick<ReportSpec, "calculations" | "relationships">>,
) {
  const catalog = await catalogFor(spec);
  const rows = await loadSource({ source, ruleSet }, catalog, { syncedAt: null });
  return { catalog, rows };
}

const SUMMARY_COUNT = "__lines";
const SUMMED_TYPES = new Set<FieldDef["type"]>(["number", "currency", "sqft"]);

/**
 * Group rows by their text-like columns and sum amount columns (deterministic, from the
 * underlying records). A sum is null when any record in the group lacks the value, so a
 * partial total is never presented as complete. Percentages can't be summed and stay blank.
 */
export function summarizeRows(
  rows: Row[],
  fields: Array<{ key: string; def: Pick<FieldDef, "type" | "label"> }>,
): { rows: Row[]; notes: string[] } {
  const dims = fields.filter((f) => !SUMMED_TYPES.has(f.def.type) && f.def.type !== "percent");
  const sums = fields.filter((f) => SUMMED_TYPES.has(f.def.type));
  const pct = fields.filter((f) => f.def.type === "percent");
  const groups = new Map<string, Row>();
  let incomplete = 0;
  for (const r of rows) {
    const key = JSON.stringify(dims.map((d) => r[d.key] ?? null));
    let g = groups.get(key);
    if (!g) {
      g = { id: `group:${groups.size + 1}`, [SUMMARY_COUNT]: 0 };
      for (const d of dims) g[d.key] = r[d.key] ?? null;
      for (const sf of sums) g[sf.key] = 0;
      for (const p of pct) g[p.key] = null;
      groups.set(key, g);
    }
    g[SUMMARY_COUNT] = Number(g[SUMMARY_COUNT]) + 1;
    for (const sf of sums) {
      const v = asNumber(r[sf.key]);
      if (g[sf.key] === null) continue;
      if (v === null) {
        g[sf.key] = null;
        incomplete++;
      } else g[sf.key] = Math.round((Number(g[sf.key]) + v) * 100) / 100;
    }
  }
  const notes: string[] = [];
  if (incomplete)
    notes.push(
      "Some totals are blank because at least one of their lines has no value in JobTread (they aren't partial sums).",
    );
  if (pct.length) notes.push("Percentage columns aren't summed in a summary table.");
  return { rows: [...groups.values()], notes };
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
  // Nonfatal caveats (e.g. a business name that reads a shared narrative text field).
  if (r.warning) ctx.issues.push(r.warning);
  return r;
}

function canonicalConditions(ctx: Ctx, conds: Condition[]): Condition[] {
  return conds.map((c) => ({ ...c, field: rowField(ctx, c.field, "filter by").key }));
}

/** A field that has a value on every record (not an aggregate calculation). */
function rowField(ctx: Ctx, ref: string, use: string): { key: string; def: FieldDef } {
  const f = requireField(ctx, ref);
  if (f.def.calc?.basis === "aggregate")
    throw new RefError(
      `Can't ${use} ${f.def.label}: it's an aggregate calculation (one value per group). Use a row calculation for per-record values.`,
      false,
    );
  return f;
}

/**
 * A metric ready to aggregate. Aggregate calculations are evaluated as formulas over the
 * records (whatever op was given), so weighted ratios are never summed or averaged.
 */
function runMetric(ctx: Ctx, m: Metric): RunMetric {
  if (!m.field) {
    if (m.op === "formula") throw new RefError(`"formula" metrics need a calc:* field.`, false);
    return m;
  }
  const f = requireField(ctx, m.field);
  if (f.def.calc?.basis === "aggregate") {
    const catalog = ctx.catalog as CalcCatalog;
    return {
      ...m,
      op: "formula",
      field: f.key,
      evaluate: (rows) => aggregateCalcNumber(catalog, f.key, rows),
    };
  }
  if (m.op === "formula")
    throw new RefError(
      `${f.def.label} has a value per record; use sum, avg, min, max, or count with it ("formula" is for aggregate calculations).`,
      false,
    );
  return { ...m, field: f.key };
}

/** The metric a KPI or chart shows: the viewer's metric picker choice, else its own. */
function viewMetric(ctx: Ctx, widgetId: string, fallback: Metric): Metric {
  for (const c of ctx.spec.controls) {
    if (c.kind !== "metric_picker" || !c.widgets.includes(widgetId)) continue;
    const raw = ctx.state[c.id];
    const idx = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : c.default;
    const option = c.options[idx] ?? c.options[c.default];
    if (option) return option.metric;
  }
  return fallback;
}

/** The viewer's grouping for a widget (group_by control), or null to use the widget's own. */
function viewGroupLevels(ctx: Ctx, widgetId: string): string[] | null {
  for (const c of ctx.spec.controls) {
    if (c.kind !== "group_by" || !c.widgets.includes(widgetId)) continue;
    const raw = ctx.state[c.id];
    const chosen = (Array.isArray(raw) ? raw : raw ? [raw] : c.default)
      .filter((v): v is string => typeof v === "string" && c.options.includes(v))
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, c.maxLevels);
    if (Array.isArray(raw) && raw.length === 0) return [];
    return chosen.length ? chosen : null;
  }
  return null;
}

/** "Formula: …" text of a calculated field (provenance). */
function calcFormula(ctx: Ctx, key: string): string {
  const c = isCalcCatalog(ctx.catalog) ? ctx.catalog.calcs.get(key) : undefined;
  return c ? (c.spec.formula ?? c.def.origin) : key;
}

/** The viewer's sort for a widget (sort control), or null. */
function viewSort(ctx: Ctx, widgetId: string): { field: string; dir: "asc" | "desc" } | null {
  for (const c of ctx.spec.controls) {
    if (c.kind !== "sort" || !c.widgets.includes(widgetId)) continue;
    const raw = ctx.state[c.id];
    if (Array.isArray(raw) && typeof raw[0] === "string" && c.options.includes(raw[0]))
      return { field: raw[0], dir: raw[1] === "asc" ? "asc" : "desc" };
    return c.default ?? null;
  }
  return null;
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
    if (!("datasets" in control) || !control.datasets.includes(datasetId)) continue;
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
  if (m.op === "formula" || (f && f.ok && f.def.calc?.basis === "aggregate")) return name;
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
    case "data_status": {
      const health = await reportDataHealth(ctx.spec);
      return {
        id: w.id,
        kind: "data_status",
        status: health.entities.length ? "ok" : "empty",
        datasets: health.entities.map((e) => ({
          entity: e.entity,
          label: e.label,
          level: e.level,
          lastSuccessAt: e.lastSuccessAt,
          message: e.message,
        })),
        ...(health.entities.length ? {} : { message: "This report doesn't read synced data." }),
      };
    }
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
      const wm = viewMetric(ctx, w.id, w.metric);
      const metric = runMetric(ctx, wm);
      const rows = filterRows(
        await datasetRows(ctx, w.dataset, filtersApplied),
        canonicalConditions(ctx, w.filters),
      );
      w.filters.forEach((f) => filtersApplied.push(describeCondition(ctx, f)));
      const agg = aggregate(rows, metric);
      return {
        id: w.id,
        kind: "kpi",
        status: rows.length === 0 && wm.op !== "count" ? "empty" : "ok",
        value: agg.value,
        fieldType: metricType(ctx, wm),
        ...(wm !== w.metric ? { label: metricLabel(ctx, wm) } : {}),
        provenance: provenance(ctx, {
          fields: wm.field ? [wm.field] : [],
          filters: filtersApplied,
          calculation: `${metricLabel(ctx, wm)} across ${rows.length} record${rows.length === 1 ? "" : "s"}${metric.evaluate ? ` (${calcFormula(ctx, metric.field!)})` : ""}${agg.blank ? ` (${agg.blank} blank, excluded)` : ""}`,
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
          SOURCE_REGISTRY[ctx.spec.datasets.find((d) => d.id === w.dataset)?.source ?? "jobs"]
            .labelField;
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
      const levels = viewGroupLevels(ctx, w.id);
      const groupRef = levels?.[0] ?? w.groupBy!;
      const g = rowField(ctx, groupRef, "group by");
      const s = w.seriesBy ? rowField(ctx, w.seriesBy, "split by") : null;
      const wm = viewMetric(ctx, w.id, w.metric);
      const sortCtl = viewSort(ctx, w.id);
      const metric = runMetric(ctx, wm);
      const chronological = g.def.type === "date";
      const series = computeSeries({
        rows,
        groupBy: g.key,
        seriesBy: s?.key,
        metric,
        bucket: chronological ? (w.bucket ?? "month") : undefined,
        sort: sortCtl
          ? sortCtl.field === groupRef
            ? "label"
            : sortCtl.dir === "asc"
              ? "value_asc"
              : "value_desc"
          : w.sort,
        limit: w.limit,
        chronological,
      });
      const notes: string[] = [];
      if (series.multiValueNote)
        notes.push(`Some records have several ${g.def.label} values and are counted under each.`);
      // Sums/averages use records that have a value; say so when some don't.
      if (
        metric.field &&
        !metric.evaluate &&
        metric.op !== "count" &&
        metric.op !== "count_distinct"
      ) {
        const blank = rows.filter((r) => isBlank(r[metric.field!])).length;
        if (blank)
          notes.push(
            `${blank} of ${rows.length} records have no ${requireField(ctx, wm.field!).def.label} value and aren't included in the totals.`,
          );
      }
      if (metric.evaluate)
        notes.push(
          `Each point re-evaluates ${calcFormula(ctx, metric.field!)} over that group's records (weighted, not an average of per-record values).`,
        );
      return {
        id: w.id,
        kind: "chart",
        status: series.points.length ? "ok" : "empty",
        points: series.points,
        seriesKeys: series.seriesKeys,
        valueType: metricType(ctx, wm),
        groupLabel: g.def.label,
        metricLabel: metricLabel(ctx, wm),
        groupField: groupRef,
        ...(w.seriesBy ? { seriesField: w.seriesBy } : {}),
        provenance: provenance(ctx, {
          fields: [groupRef, ...(w.seriesBy ? [w.seriesBy] : []), ...(wm.field ? [wm.field] : [])],
          filters: filtersApplied,
          calculation: `${metricLabel(ctx, wm)} grouped by ${g.def.label}${s ? ` and ${s.def.label}` : ""}`,
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
      const sortCtl = viewSort(ctx, w.id);
      let groupSort: { key: string; dir: "asc" | "desc" } | undefined;
      let sort = w.sort.flatMap((s) => {
        const r = resolveField(ctx.catalog, s.field);
        return r.ok && visibleKeys.has(r.key) ? [{ field: r.key, dir: s.dir }] : [];
      });
      if (sortCtl) {
        const r = resolveField(ctx.catalog, sortCtl.field);
        if (r.ok && canSeeField(ctx.access, r.def)) {
          groupSort = { key: r.key, dir: sortCtl.dir };
          if (r.def.calc?.basis !== "aggregate") sort = [{ field: r.key, dir: sortCtl.dir }];
        }
      }
      const levelRefs = viewGroupLevels(ctx, w.id) ?? w.groupLevels;
      const levels = levelRefs.flatMap((ref) => {
        try {
          const f = rowField(ctx, ref, "group by");
          return canSeeField(ctx.access, f.def) ? [{ key: f.key, label: f.def.label }] : [];
        } catch (error) {
          if (!(error instanceof RefError)) throw error;
          missing.push(error.message);
          return [];
        }
      });
      const aggregateCols = new Map(
        columns
          .filter((x) => x.f.def.calc?.basis === "aggregate")
          .map((x) => [x.f.key, runMetric(ctx, { op: "formula", field: x.c.field })] as const),
      );
      const highlight = w.highlight.flatMap((h) => {
        const r = resolveField(ctx.catalog, h.field);
        return r.ok && canSeeField(ctx.access, r.def) ? [{ ...h, field: r.key }] : [];
      });
      let rows = filterRows(
        await datasetRows(ctx, w.dataset, filtersApplied),
        canonicalConditions(ctx, w.filters),
      );
      w.filters.forEach((f) => filtersApplied.push(describeCondition(ctx, f)));
      if (w.groupBy && !levels.length) {
        const gb = resolveField(ctx.catalog, w.groupBy);
        if (gb.ok && canSeeField(ctx.access, gb.def)) sort.unshift({ field: gb.key, dir: "asc" });
      }
      rows = sortRows(rows, sort);
      const groupColumns: GroupColumn[] = columns.map(({ c, f }) => {
        const agg = aggregateCols.get(f.key);
        if (agg) return { key: f.key, mode: "formula", evaluate: (rs) => agg.evaluate!(rs) };
        if (c.aggregate !== "auto") return { key: f.key, mode: c.aggregate };
        return {
          key: f.key,
          mode: ["currency", "number", "sqft"].includes(f.def.type) ? "sum" : "none",
        };
      });
      const tree =
        levels.length && !w.summarize
          ? buildGroupTree(rows, levels, groupColumns, { sort: groupSort })
          : null;
      if (tree) rows = tree.orderedRows;
      const totalRecords = tree ? rows.length : null;
      const isJobs =
        !w.summarize && ctx.spec.datasets.find((d) => d.id === w.dataset)?.source === "jobs";
      const summary = w.summarize
        ? summarizeRows(
            rows,
            columns.map((x) => x.f),
          )
        : null;
      if (summary) rows = summary.rows;
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
        ref: c.field,
      }));
      if (summary)
        meta.push({
          key: SUMMARY_COUNT,
          label: "Lines",
          type: "number",
          origin: "Count of records in the row's group",
        });
      const cellKeys = [...columns.map(({ f }) => f.key), ...(summary ? [SUMMARY_COUNT] : [])];
      // Appearance rules are evaluated here so a rule can't reveal a field the viewer can't see.
      const ruleFields = (w.appearance?.rules ?? []).flatMap((rule) => {
        if (!rule.field) return [];
        try {
          const f = rowField(ctx, rule.field, "style by");
          return [{ rule, key: f.key }];
        } catch {
          return [];
        }
      });
      const ruleStyleFor = (r: Row) =>
        ruleFields.length
          ? (firstRuleStyle(
              ruleFields.map((x) => x.rule),
              (rule) => r[ruleFields.find((x) => x.rule === rule)!.key],
            ) ?? undefined)
          : undefined;
      const cell = (r: Row, k: string): CellValue => {
        const agg = aggregateCols.get(k);
        return agg ? agg.evaluate!([r]) : (r[k] ?? null);
      };
      const notes: string[] = [];
      if (tree?.truncated)
        notes.push("Showing the first groups only; filter the report to see the rest.");
      if (tree && Object.keys(tree.totalsIncomplete).length)
        notes.push(
          "Some records have no value for a totaled column; they're left out of that total.",
        );
      if (tree && groupColumns.some((g) => g.mode === "formula"))
        notes.push(
          "Calculated ratios in group rows are recomputed from each group's records (weighted), not added up.",
        );
      if (
        levels.length &&
        rows.some((r) =>
          levels.some((l) => Array.isArray(r[l.key]) && (r[l.key] as string[]).length > 1),
        )
      )
        notes.push(
          "Records with several values in a grouping field appear under each value; the grand total counts them once.",
        );
      return {
        id: w.id,
        kind: "table",
        status: rows.length ? "ok" : "empty",
        columns: meta,
        ...(tree
          ? {
              groups: tree.groups,
              groupLevels: levels,
              totals: w.grandTotal ? tree.totals : undefined,
              totalsIncomplete: w.grandTotal ? tree.totalsIncomplete : undefined,
              expandDepth: w.expandDepth,
            }
          : {}),
        sortedBy: groupSort ?? null,
        rows: rows.slice(0, tree ? MAX_GROUPED_ROWS : MAX_TABLE_ROWS).map((r) => ({
          id: r.id,
          cells: Object.fromEntries(cellKeys.map((k) => [k, cell(r, k)])),
          tone: highlight.find((h) =>
            matchesCondition(r[h.field], { field: h.field, op: h.op, value: h.value }),
          )?.tone,
          ruleStyle: ruleStyleFor(r),
          jobtreadUrl: isJobs ? jobTreadJobUrl(r.id) : undefined,
        })),
        totalRows: totalRecords ?? rows.length,
        truncated: rows.length > (tree ? MAX_GROUPED_ROWS : MAX_TABLE_ROWS),
        message:
          [
            hidden.length ? `${hidden.length} column(s) hidden by your access level.` : null,
            ...(summary?.notes ?? []),
            ...notes,
            ...missing.map((m) => `Column skipped: ${m}`),
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        provenance: provenance(ctx, {
          fields: columns.map((x) => x.c.field),
          filters: filtersApplied,
          calculation: levels.length
            ? `Grouped by ${levels.map((l) => l.label).join(" → ")}; subtotals from each group's records`
            : "One row per record",
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
    case "data_status":
      return { ...base, kind: "data_status", datasets: [] };
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
  if (control.kind === "group_by" || control.kind === "sort") {
    // Only fields this viewer may see are offered.
    const options = control.options.flatMap((ref) => {
      const r = resolveField(ctx.catalog, ref);
      if (!r.ok || !canSeeField(ctx.access, r.def)) return [];
      if (control.kind === "group_by" && r.def.calc?.basis === "aggregate") return [];
      return [{ value: ref, label: r.def.label }];
    });
    const allowed = new Set(options.map((o) => o.value));
    if (control.kind === "group_by") {
      const widget = ctx.spec.widgets.find((w) => w.id === control.widgets[0]);
      const own =
        widget?.type === "table"
          ? widget.groupLevels
          : widget?.type === "chart" && widget.groupBy
            ? [widget.groupBy]
            : [];
      const selected = (viewGroupLevels(ctx, control.widgets[0]!) ?? own).filter((v) =>
        allowed.has(v),
      );
      return {
        kind: "group_by",
        id: control.id,
        options,
        selected,
        maxLevels: control.maxLevels,
      };
    }
    const sel = viewSort(ctx, control.widgets[0]!);
    return {
      kind: "sort",
      id: control.id,
      options,
      selected: sel && allowed.has(sel.field) ? sel : null,
    };
  }
  if (control.kind === "metric_picker") {
    const options = control.options.flatMap((o, i) => {
      if (o.metric.field) {
        const r = resolveField(ctx.catalog, o.metric.field);
        if (!r.ok || !canSeeField(ctx.access, r.def)) return [];
      }
      return [{ value: String(i), label: o.label }];
    });
    const raw = ctx.state[control.id];
    const selected =
      typeof raw === "string" && options.some((o) => o.value === raw)
        ? raw
        : (options.find((o) => o.value === String(control.default))?.value ??
          options[0]?.value ??
          "");
    return { kind: "metric_picker", id: control.id, options, selected };
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
  const catalog = await catalogFor(input.spec);
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
  for (const s of ctx.data.joinStats?.values() ?? [])
    if (s.linked && s.matched / s.linked < 0.9)
      ctx.issues.push(
        `${s.label}: only ${s.matched} of ${s.linked} ${s.from} records with a key found their ${s.to} record; related values are blank for the rest. Check the join with Dexter (reports_relationship_check) or sync the related data.`,
      );
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
  const catalog = await catalogFor(input.spec);
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
  const wanted = [...SOURCE_REGISTRY[source].drilldownFields];
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
      field: SOURCE_REGISTRY[source].labelField,
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
/**
 * Data check for a report relationship whose key isn't a declared id field: most of its values
 * must be ids of the related source's records. Name-like keys fail here instead of silently
 * joining the wrong records.
 */
async function verifyJoinKey(
  r: ReportSpec["relationships"][number],
  catalog: FieldCatalog,
): Promise<string | null> {
  const [keySource, idSource, key] =
    r.kind === "lookup" ? [r.from, r.to, r.key] : [r.child, r.parent, r.childKey];
  const k = resolveField(catalog, key);
  if (!k.ok || ID_FIELDS[k.key] === idSource) return null;
  if (keySource === "commissions" || idSource === "commissions") return null; // needs a rule set
  const cache: DataCache = { syncedAt: null };
  const [rows, ids] = await Promise.all([
    loadRawSource(keySource, catalog, cache),
    loadRawSource(idSource, catalog, cache),
  ]);
  const idSet = new Set(ids.map((x) => x.id));
  const values = rows.map((x) => x[k.key]).filter((v): v is string => typeof v === "string" && !!v);
  if (!values.length) return `Relationship "${r.label}": ${k.def.label} has no values to join on.`;
  const rate = values.filter((v) => idSet.has(v)).length / values.length;
  return rate >= 0.9
    ? null
    : `Relationship "${r.label}": only ${Math.round(rate * 100)}% of ${k.def.label} values are ${idSource} ids, so it isn't a stable key (names or other text don't qualify). Use reports_relationship_discover to find the id field, or ask how the records should be linked.`;
}

export async function checkSpecFields(
  spec: ReportSpec,
  access: ReportsAccess,
  refs: string[],
): Promise<{ missing: string[]; restricted: string[] }> {
  const catalog = await catalogFor(spec);
  const missing: string[] = [];
  const restricted: string[] = [];
  // The report's own relationships and calculations must compile even when unused.
  for (const r of spec.relationships) {
    const error = catalog.relationshipErrors.get(r.id);
    if (error) missing.push(error);
    else {
      const problem = await verifyJoinKey(r, catalog);
      if (problem) missing.push(problem);
    }
  }
  for (const c of spec.calculations) {
    const error = catalog.calcErrors.get(`calc:${c.key}`);
    if (error) missing.push(error);
  }
  for (const ref of refs) {
    const r = resolveField(catalog, ref);
    if (!r.ok) missing.push(`${ref}: ${r.reason}`);
    else if (!canSeeField(access, r.def))
      restricted.push(`${r.def.label} (${CATEGORY_LABELS[r.def.category]})`);
  }
  // A field must be readable from the dataset it's used on: its own source or an approved
  // related field. Otherwise the widget would silently show blanks.
  const wanted = new Set(refs);
  const sources = new Map(spec.datasets.map((d) => [d.id, d.source]));
  const seen = new Set<string>();
  for (const { ref, dataset } of collectDatasetFieldRefs(spec)) {
    const source = dataset ? sources.get(dataset) : undefined;
    if (!source || !wanted.has(ref) || seen.has(`${source}:${ref}`)) continue;
    seen.add(`${source}:${ref}`);
    const r = resolveField(catalog, ref);
    if (!r.ok) continue;
    const on = fieldOnSource(catalog, source, { ...r.def, key: r.key });
    if (!on.ok) missing.push(`${ref} (dataset "${dataset}"): ${on.reason}`);
  }
  // Aggregate calculations have one value per group: never a filter, grouping, or row sort.
  const rowOnly = new Set<string>();
  for (const d of spec.datasets) d.filters.forEach((f) => rowOnly.add(f.field));
  for (const c of spec.controls)
    if (c.kind === "select" || c.kind === "number_range" || c.kind === "date_range")
      rowOnly.add(c.field);
    else if (c.kind === "search") c.fields.forEach((f) => rowOnly.add(f));
    else if (c.kind === "group_by") c.options.forEach((f) => rowOnly.add(f));
  for (const w of spec.widgets) {
    if ("filters" in w) w.filters.forEach((f) => rowOnly.add(f.field));
    if (w.type === "chart") [w.groupBy, w.seriesBy, w.x, w.y].forEach((f) => f && rowOnly.add(f));
    if (w.type === "table") {
      w.groupLevels.forEach((f) => rowOnly.add(f));
      if (w.groupBy) rowOnly.add(w.groupBy);
    }
  }
  for (const ref of rowOnly) {
    const r = resolveField(catalog, ref);
    if (r.ok && r.def.calc?.basis === "aggregate")
      missing.push(
        `${ref}: ${r.def.label} is an aggregate calculation (one value per group); it can be a KPI/chart metric or a table column, not a filter, grouping, or axis. Use a row calculation for per-record values.`,
      );
  }
  return { missing, restricted };
}
