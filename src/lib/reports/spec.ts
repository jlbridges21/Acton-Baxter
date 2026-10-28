/**
 * Report specification (schema v1).
 *
 * A report is configuration, never code: Dexter and the manual editor produce this
 * structure, the server validates it, and trusted components render it. Only the widget
 * types, operators, and aggregations listed here exist.
 *
 * Field references:
 *   job.*            built-in job attributes (job.name, job.projectedPrice, …)
 *   cf:<id>          a JobTread custom field by stable id (job, location, or customer field)
 *   sem:<key>        business vocabulary mapped by admins (sem:phase → cf:22Pg…)
 *   model.*          Product Library (catalog model) attributes
 *   item.* / com.*   cost-item and commission attributes
 *   calc:<key>       a calculated field: defined in the spec's `calculations` or in the
 *                    shared Metric Library (row formula, aggregate formula, or rollup)
 */

import { z } from "zod";
import {
  basicStyleSchema,
  chartStyleSchema,
  kpiStyleSchema,
  tableStyleSchema,
  themeSchema,
} from "./style";

export const REPORT_SCHEMA_VERSION = 1;

const id = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,39}$/, "Ids use lowercase letters, numbers, dashes, or underscores.");
export const fieldRef = z
  .string()
  .trim()
  .regex(
    /^(job\.[a-zA-Z]+|model\.[a-zA-Z]+|item\.[a-zA-Z]+|com\.[a-zA-Z]+|cf:[A-Za-z0-9]{6,40}|sem:[a-z0-9_]{2,60}|calc:[a-z][a-z0-9_]{1,40})$/,
    "Unknown field reference format.",
  );

export const SOURCES = ["jobs", "catalog_models", "cost_items", "commissions"] as const;
export type ReportSource = (typeof SOURCES)[number];

export const OPERATORS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "not_contains",
  "starts_with",
  "blank",
  "not_blank",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;

const scalar = z.union([z.string().max(200), z.number(), z.boolean()]);

export const conditionSchema = z.object({
  field: fieldRef,
  op: z.enum(OPERATORS),
  value: z.union([scalar, z.array(scalar).max(100)]).optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

const ruleSetKey = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_-]{1,59}$/,
    "Rule set keys use lowercase letters, numbers, dashes, or underscores.",
  );

export const datasetSchema = z.object({
  id,
  source: z.enum(SOURCES),
  label: z.string().max(80).optional(),
  filters: z.array(conditionSchema).max(20).default([]),
  /** commissions only: the Baxter business-rule set (rates + assignments) to calculate with. */
  ruleSet: ruleSetKey.optional(),
});
export type DatasetSpec = z.infer<typeof datasetSchema>;

export const FORMATS = [
  "auto",
  "text",
  "number",
  "currency",
  "percent",
  "date",
  "sqft",
  "boolean",
  "list",
] as const;
export type FieldFormat = (typeof FORMATS)[number];

export const METRIC_OPS = [
  "count",
  "count_distinct",
  "sum",
  "avg",
  "median",
  "min",
  "max",
  /** Evaluate an aggregate calculated field (calc:*) over the records. */
  "formula",
] as const;
/** Aggregations a rollup can apply to related records. */
export const ROLLUP_OPS = [
  "count",
  "count_distinct",
  "sum",
  "avg",
  "median",
  "min",
  "max",
] as const;
export const metricSchema = z.object({
  op: z.enum(METRIC_OPS),
  field: fieldRef.optional(),
  label: z.string().max(80).optional(),
});
export type Metric = z.infer<typeof metricSchema>;

export const CALC_TYPES = [
  "number",
  "currency",
  "percent",
  "sqft",
  "text",
  "date",
  "boolean",
] as const;
export const calcKey = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_]{1,40}$/,
    "Calculation keys use lowercase letters, numbers, or underscores.",
  );

/**
 * A calculated field (also the shape stored in the Metric Library). Referenced as calc:<key>.
 *   row        formula evaluated per record (filter, sort, group, column, or aggregate it)
 *   aggregate  formula with SUM/AVG/COUNT… evaluated over each group of records (KPIs,
 *              charts, table subtotals) — e.g. weighted margin = (SUM(p) − SUM(c)) ÷ SUM(p)
 *   rollup     one value per record from its related records through a registered
 *              relationship (e.g. a job's total budget cost from its cost items) —
 *              pre-aggregated by stable id, so sums over the parent never double count
 */
export const calculationSchema = z
  .object({
    key: calcKey,
    label: z.string().trim().min(1).max(80),
    description: z.string().max(400).optional(),
    source: z.enum(SOURCES),
    basis: z.enum(["row", "aggregate", "rollup"]),
    formula: z.string().max(1000).optional(),
    rollup: z
      .object({
        relationship: z.string().max(60),
        op: z.enum(ROLLUP_OPS),
        field: fieldRef.optional(),
        filters: z.array(conditionSchema).max(10).default([]),
        /** commissions children only. */
        ruleSet: ruleSetKey.optional(),
      })
      .optional(),
    type: z.enum(CALC_TYPES).default("number"),
    unit: z.string().max(20).optional(),
    decimals: z.number().int().min(0).max(6).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.basis === "rollup" && !c.rollup)
      ctx.addIssue({ code: "custom", message: "A rollup needs rollup settings." });
    if (c.basis !== "rollup" && !c.formula?.trim())
      ctx.addIssue({ code: "custom", message: "A row or aggregate calculation needs a formula." });
    if (c.rollup && c.rollup.op !== "count" && !c.rollup.field)
      ctx.addIssue({ code: "custom", message: `Rollup "${c.rollup.op}" needs a field.` });
  });
export type CalculationSpec = z.infer<typeof calculationSchema>;

export const relationshipKey = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_]{1,40}$/,
    "Relationship ids use lowercase letters, numbers, or underscores.",
  );

/**
 * A report-specific (or promoted company) relationship between sources, joined only on a key
 * field whose values are the related record's stable JobTread id.
 *   lookup  many-to-one: `fields` of the `to` record become readable on each `from` row
 *           (rows are never added or dropped)
 *   rollup  one-to-many: child records grouped by `childKey` (the parent's id); use it from a
 *           calculation {"basis":"rollup","rollup":{"relationship":<id>,…}} so totals are
 *           pre-aggregated per parent and never double count
 */
export const relationshipSchema = z.discriminatedUnion("kind", [
  z.object({
    id: relationshipKey,
    kind: z.literal("lookup"),
    label: z.string().trim().min(1).max(80),
    from: z.enum(SOURCES),
    to: z.enum(["jobs", "catalog_models", "cost_items"]),
    key: fieldRef,
    fields: z.array(fieldRef).min(1).max(30),
    description: z.string().max(400).optional(),
  }),
  z.object({
    id: relationshipKey,
    kind: z.literal("rollup"),
    label: z.string().trim().min(1).max(80),
    parent: z.enum(SOURCES),
    child: z.enum(SOURCES),
    childKey: fieldRef,
    description: z.string().max(400).optional(),
  }),
]);
export type RelationshipSpec = z.infer<typeof relationshipSchema>;

const controlBase = { id, label: z.string().trim().min(1).max(60) };

export const controlSchema = z.discriminatedUnion("kind", [
  z.object({
    ...controlBase,
    kind: z.literal("job_picker"),
    dataset: id,
    /** Default job id, or "first" to pick the first job in the dataset. */
    default: z.string().max(40).nullable().default("first"),
  }),
  z.object({
    ...controlBase,
    kind: z.literal("select"),
    field: fieldRef,
    datasets: z.array(id).min(1).max(10),
    multiple: z.boolean().default(true),
    default: z.array(z.string().max(200)).max(50).default([]),
  }),
  z.object({
    ...controlBase,
    kind: z.literal("search"),
    fields: z.array(fieldRef).min(1).max(8),
    datasets: z.array(id).min(1).max(10),
  }),
  z.object({
    ...controlBase,
    kind: z.literal("number_range"),
    field: fieldRef,
    datasets: z.array(id).min(1).max(10),
  }),
  z.object({
    ...controlBase,
    kind: z.literal("date_range"),
    field: fieldRef,
    datasets: z.array(id).min(1).max(10),
  }),
  /** Viewer picks the grouping (one or several levels) of tables and charts. */
  z.object({
    ...controlBase,
    kind: z.literal("group_by"),
    widgets: z.array(id).min(1).max(10),
    options: z.array(fieldRef).min(1).max(12),
    /** Default levels; empty = the widgets' own grouping. */
    default: z.array(fieldRef).max(4).default([]),
    maxLevels: z.number().int().min(1).max(4).default(3),
  }),
  /** Viewer picks the sort field and direction of tables (and value order of charts). */
  z.object({
    ...controlBase,
    kind: z.literal("sort"),
    widgets: z.array(id).min(1).max(10),
    options: z.array(fieldRef).min(1).max(12),
    default: z.object({ field: fieldRef, dir: z.enum(["asc", "desc"]).default("desc") }).optional(),
  }),
  /** Viewer picks which metric KPIs and charts show. */
  z.object({
    ...controlBase,
    kind: z.literal("metric_picker"),
    widgets: z.array(id).min(1).max(10),
    options: z
      .array(z.object({ label: z.string().trim().min(1).max(60), metric: metricSchema }))
      .min(2)
      .max(8),
    default: z.number().int().min(0).max(7).default(0),
  }),
]);
export type ViewControlKind = "group_by" | "sort" | "metric_picker";
export const VIEW_CONTROL_KINDS: ReadonlySet<string> = new Set([
  "group_by",
  "sort",
  "metric_picker",
]);
export type ControlSpec = z.infer<typeof controlSchema>;

export const SPANS = [3, 4, 6, 8, 12] as const;
const widgetBase = {
  id,
  title: z.string().trim().max(100).default(""),
  /** Short line under the title (plain text). */
  subtitle: z.string().trim().max(160).optional(),
  description: z.string().max(400).optional(),
  span: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]).default(6),
  height: z.enum(["sm", "md", "lg", "auto"]).default("auto"),
  hidden: z.boolean().default(false),
};

export const COLUMN_AGGREGATES = [
  "auto",
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "count_distinct",
  "none",
] as const;
const columnSchema = z.object({
  field: fieldRef,
  label: z.string().max(60).optional(),
  format: z.enum(FORMATS).default("auto"),
  width: z.number().int().min(60).max(600).optional(),
  wrap: z.boolean().default(false),
  /**
   * Group subtotal behavior. auto = sum amounts and counts, nothing for percentages, and
   * aggregate calculations are re-evaluated over each group (weighted, never summed).
   */
  aggregate: z.enum(COLUMN_AGGREGATES).default("auto"),
});

export const HIGHLIGHT_TONES = ["green", "amber", "red", "blue", "gray"] as const;

export const CHART_TYPES = [
  "bar",
  "horizontal_bar",
  "stacked_bar",
  "line",
  "area",
  "donut",
  "scatter",
  "histogram",
] as const;

export const widgetSchema = z.discriminatedUnion("type", [
  z.object({
    ...widgetBase,
    type: z.literal("kpi"),
    appearance: kpiStyleSchema.optional(),
    dataset: id,
    metric: metricSchema,
    filters: z.array(conditionSchema).max(10).default([]),
    format: z.enum(FORMATS).default("auto"),
    drilldown: z.boolean().default(true),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("chart"),
    appearance: chartStyleSchema.optional(),
    dataset: id,
    chart: z.enum(CHART_TYPES),
    groupBy: fieldRef.optional(),
    seriesBy: fieldRef.optional(),
    metric: metricSchema.default({ op: "count" }),
    /** Scatter only. */
    x: fieldRef.optional(),
    y: fieldRef.optional(),
    bucket: z.enum(["day", "month", "quarter", "year"]).optional(),
    sort: z.enum(["value_desc", "value_asc", "label"]).default("value_desc"),
    limit: z.number().int().min(1).max(50).default(15),
    filters: z.array(conditionSchema).max(10).default([]),
    format: z.enum(FORMATS).default("auto"),
    drilldown: z.boolean().default(true),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("table"),
    appearance: tableStyleSchema.optional(),
    dataset: id,
    columns: z.array(columnSchema).min(1).max(30),
    sort: z
      .array(z.object({ field: fieldRef, dir: z.enum(["asc", "desc"]).default("asc") }))
      .max(3)
      .default([]),
    pageSize: z.number().int().min(5).max(100).default(25),
    groupBy: fieldRef.optional(),
    /** Nested, expandable groups (e.g. Phase → Project Manager → Job) with subtotals. */
    groupLevels: z.array(fieldRef).max(4).default([]),
    /** Levels expanded by default (0 = all collapsed). Viewers' own choices are kept per viewer. */
    expandDepth: z.number().int().min(0).max(4).default(1),
    /** Grand-total row across every group. */
    grandTotal: z.boolean().default(true),
    searchable: z.boolean().default(true),
    filters: z.array(conditionSchema).max(10).default([]),
    /** Clicking a job row opens its detail drawer. */
    rowDrilldown: z.boolean().default(true),
    highlight: z
      .array(
        z.object({
          field: fieldRef,
          op: z.enum(OPERATORS),
          value: z.union([scalar, z.array(scalar)]).optional(),
          tone: z.enum(HIGHLIGHT_TONES),
        }),
      )
      .max(10)
      .default([]),
    /** Comparison mode: select rows and compare them side by side. */
    comparable: z.boolean().default(false),
    /**
     * One row per distinct combination of the text columns, with amount columns summed and a
     * "Lines" count (e.g. model × option totals from cost items). A total is left blank when
     * any of its lines has no value; percentages are not summed.
     */
    summarize: z.boolean().default(false),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("project_header"),
    appearance: basicStyleSchema.optional(),
    control: id,
    fields: z.array(fieldRef).max(8).default([]),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("detail"),
    appearance: basicStyleSchema.optional(),
    control: id,
    style: z.enum(["grid", "long_text", "badges"]).default("grid"),
    fields: z
      .array(
        z.object({
          field: fieldRef,
          label: z.string().max(60).optional(),
          format: z.enum(FORMATS).default("auto"),
        }),
      )
      .min(1)
      .max(40),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("milestones"),
    appearance: basicStyleSchema.optional(),
    control: id,
    show: z.enum(["schedule", "checklists", "all"]).default("schedule"),
    style: z.enum(["timeline", "list"]).default("timeline"),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("documents"),
    appearance: basicStyleSchema.optional(),
    control: id,
    groupByFolder: z.boolean().default(true),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("text"),
    appearance: basicStyleSchema.optional(),
    body: z.string().max(2000),
  }),
  /**
   * Live data status: when each synced dataset this report reads last refreshed and whether it
   * is fresh. Use instead of typing sync dates or import progress into a text widget.
   */
  z.object({
    ...widgetBase,
    type: z.literal("data_status"),
    appearance: basicStyleSchema.optional(),
  }),
  /** Edit commission rates for a rule set (authorized users only; changes are audited). */
  z.object({
    ...widgetBase,
    type: z.literal("rate_editor"),
    appearance: basicStyleSchema.optional(),
    ruleSet: ruleSetKey,
  }),
  /** Assign JobTread projects to salespeople, with splits and payment dates. */
  z.object({
    ...widgetBase,
    type: z.literal("assignment_editor"),
    appearance: basicStyleSchema.optional(),
    ruleSet: ruleSetKey,
  }),
]);
export type WidgetSpec = z.infer<typeof widgetSchema>;
export type WidgetType = WidgetSpec["type"];

export const reportSpecSchema = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION).default(REPORT_SCHEMA_VERSION),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(1000).default(""),
  datasets: z.array(datasetSchema).min(0).max(8).default([]),
  /** Report-specific calculated fields (calc:<key>); shared ones live in the Metric Library. */
  calculations: z.array(calculationSchema).max(30).default([]),
  /** Report-specific relationships between sources (validated stable-id joins). */
  relationships: z.array(relationshipSchema).max(10).default([]),
  controls: z.array(controlSchema).max(12).default([]),
  /** Order = layout order on a 12-column grid. */
  widgets: z.array(widgetSchema).max(40).default([]),
  /** Optional report-wide styling (palette, tokens, density, category colors…). */
  theme: themeSchema.optional(),
});
export type ReportSpec = z.infer<typeof reportSpecSchema>;

export type SpecIssue = { path: string; message: string };

/** Structural checks beyond the schema (references between parts). Field existence is checked server-side. */
export function checkSpecReferences(spec: ReportSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const datasetIds = new Set<string>();
  spec.datasets.forEach((d, i) => {
    if (datasetIds.has(d.id))
      issues.push({ path: `datasets[${i}]`, message: `Duplicate dataset id "${d.id}".` });
    datasetIds.add(d.id);
  });
  const datasetById = new Map(spec.datasets.map((d) => [d.id, d]));
  spec.datasets.forEach((d, i) => {
    if (d.source === "commissions" && !d.ruleSet) {
      issues.push({
        path: `datasets[${i}]`,
        message: `Commission dataset "${d.id}" needs a ruleSet.`,
      });
    }
  });
  const controlIds = new Set<string>();
  spec.controls.forEach((c, i) => {
    if (controlIds.has(c.id))
      issues.push({ path: `controls[${i}]`, message: `Duplicate control id "${c.id}".` });
    controlIds.add(c.id);
    if (c.kind === "group_by" || c.kind === "sort" || c.kind === "metric_picker") return;
    const refs = c.kind === "job_picker" ? [c.dataset] : c.datasets;
    for (const ref of refs) {
      if (!datasetIds.has(ref))
        issues.push({
          path: `controls[${i}]`,
          message: `Control "${c.id}" uses unknown dataset "${ref}".`,
        });
    }
    if (c.kind === "job_picker" && datasetById.get(c.dataset)?.source !== "jobs") {
      issues.push({ path: `controls[${i}]`, message: "A job picker needs a jobs dataset." });
    }
  });
  const pickers = new Set(spec.controls.filter((c) => c.kind === "job_picker").map((c) => c.id));
  const widgetIds = new Set<string>();
  spec.widgets.forEach((w, i) => {
    if (widgetIds.has(w.id))
      issues.push({ path: `widgets[${i}]`, message: `Duplicate widget id "${w.id}".` });
    widgetIds.add(w.id);
    if ("dataset" in w && !datasetIds.has(w.dataset)) {
      issues.push({
        path: `widgets[${i}]`,
        message: `Widget "${w.id}" uses unknown dataset "${w.dataset}".`,
      });
    }
    if ("control" in w && !pickers.has(w.control)) {
      issues.push({
        path: `widgets[${i}]`,
        message: `Widget "${w.id}" needs a job picker control (got "${w.control}").`,
      });
    }
    if (w.type === "chart") {
      if (w.chart === "scatter" && (!w.x || !w.y))
        issues.push({ path: `widgets[${i}]`, message: "Scatter charts need x and y fields." });
      if (w.chart !== "scatter" && !w.groupBy)
        issues.push({ path: `widgets[${i}]`, message: `Chart "${w.id}" needs a groupBy field.` });
    }
    if ((w.type === "kpi" || w.type === "chart") && w.metric.op !== "count" && !w.metric.field) {
      issues.push({ path: `widgets[${i}]`, message: `"${w.metric.op}" needs a field.` });
    }
    if ((w.type === "kpi" || w.type === "chart") && w.metric.op === "formula") {
      if (!w.metric.field?.startsWith("calc:"))
        issues.push({
          path: `widgets[${i}]`,
          message: `"formula" metrics need an aggregate calculated field (calc:…).`,
        });
    }
    if (w.type === "table")
      (w.appearance?.rules ?? []).forEach((r, j) => {
        if (!r.field)
          issues.push({
            path: `widgets[${i}].appearance.rules[${j}].field`,
            message: "Table rules need the field to test (e.g. item.price).",
          });
      });
    if (w.type === "kpi")
      (w.appearance?.rules ?? []).forEach((r, j) => {
        if (r.target === "category")
          issues.push({
            path: `widgets[${i}].appearance.rules[${j}].target`,
            message: 'KPI rules compare the KPI value; "category" applies to charts only.',
          });
      });
    if (w.type === "table" && w.groupLevels.length && w.summarize)
      issues.push({
        path: `widgets[${i}]`,
        message: `Table "${w.id}": use either summarize or groupLevels, not both.`,
      });
  });
  const relIds = new Set<string>();
  spec.relationships.forEach((r, i) => {
    if (relIds.has(r.id))
      issues.push({ path: `relationships[${i}]`, message: `Duplicate relationship "${r.id}".` });
    relIds.add(r.id);
    const [a, b] = r.kind === "lookup" ? [r.from, r.to] : [r.parent, r.child];
    if (a === b)
      issues.push({
        path: `relationships[${i}]`,
        message: "A relationship joins two different sources.",
      });
  });
  const calcKeys = new Set<string>();
  spec.calculations.forEach((c, i) => {
    if (calcKeys.has(c.key))
      issues.push({ path: `calculations[${i}]`, message: `Duplicate calculation "${c.key}".` });
    calcKeys.add(c.key);
  });
  const widgetById = new Map(spec.widgets.map((w) => [w.id, w]));
  spec.controls.forEach((c, i) => {
    if (c.kind !== "group_by" && c.kind !== "sort" && c.kind !== "metric_picker") return;
    for (const wid of c.widgets) {
      const w = widgetById.get(wid);
      const ok =
        c.kind === "metric_picker"
          ? w?.type === "kpi" || w?.type === "chart"
          : w?.type === "table" || w?.type === "chart";
      if (!ok)
        issues.push({
          path: `controls[${i}]`,
          message: `Control "${c.id}" targets "${wid}", which isn't a ${c.kind === "metric_picker" ? "KPI or chart" : "table or chart"}.`,
        });
    }
    if (c.kind === "group_by") {
      const bad = c.default.filter((f) => !c.options.includes(f));
      if (bad.length)
        issues.push({
          path: `controls[${i}]`,
          message: `Default grouping ${bad.join(", ")} must be one of the options.`,
        });
    }
    if (c.kind === "sort" && c.default && !c.options.includes(c.default.field))
      issues.push({
        path: `controls[${i}]`,
        message: `Default sort ${c.default.field} must be one of the options.`,
      });
    if (c.kind === "metric_picker" && c.default >= c.options.length)
      issues.push({ path: `controls[${i}]`, message: "Default metric is out of range." });
  });
  return issues;
}

export function parseReportSpec(
  input: unknown,
): { ok: true; spec: ReportSpec } | { ok: false; issues: SpecIssue[] } {
  const parsed = reportSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues
        .slice(0, 12)
        .map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const issues = checkSpecReferences(parsed.data);
  return issues.length ? { ok: false, issues } : { ok: true, spec: parsed.data };
}

/** Collect every field reference in a spec (for validation, provenance, and access checks). */
export function collectFieldRefs(spec: ReportSpec): string[] {
  return [...new Set(collectDatasetFieldRefs(spec).map((r) => r.ref))];
}

/** Every field reference with the dataset(s) it's read from (null when none applies). */
export function collectDatasetFieldRefs(
  spec: ReportSpec,
): Array<{ ref: string; dataset: string | null }> {
  const out: Array<{ ref: string; dataset: string | null }> = [];
  const pickerDataset = new Map(
    spec.controls.flatMap((c) => (c.kind === "job_picker" ? [[c.id, c.dataset] as const] : [])),
  );
  const add = (dataset: string | null, f?: string) => {
    if (f) out.push({ ref: f, dataset });
  };
  const conds = (dataset: string | null, cs: Condition[]) =>
    cs.forEach((c) => add(dataset, c.field));
  spec.datasets.forEach((d) => conds(d.id, d.filters));
  const widgetDataset = new Map(
    spec.widgets.flatMap((w) => ("dataset" in w ? [[w.id, w.dataset] as const] : [])),
  );
  spec.controls.forEach((c) => {
    if (c.kind === "job_picker") return;
    if (c.kind === "group_by" || c.kind === "sort" || c.kind === "metric_picker") {
      const fields =
        c.kind === "metric_picker"
          ? c.options.flatMap((o) => (o.metric.field ? [o.metric.field] : []))
          : c.options;
      for (const wid of c.widgets) {
        const ds = widgetDataset.get(wid) ?? null;
        fields.forEach((f) => add(ds, f));
      }
      return;
    }
    const fields = c.kind === "search" ? c.fields : [c.field];
    const datasets = c.datasets.length ? c.datasets : [null];
    for (const ds of datasets) fields.forEach((f) => add(ds, f));
  });
  for (const w of spec.widgets) {
    if (w.type === "kpi") {
      add(w.dataset, w.metric.field);
      conds(w.dataset, w.filters);
    } else if (w.type === "chart") {
      [w.groupBy, w.seriesBy, w.x, w.y, w.metric.field].forEach((f) => add(w.dataset, f));
      conds(w.dataset, w.filters);
    } else if (w.type === "table") {
      w.columns.forEach((c) => add(w.dataset, c.field));
      w.sort.forEach((x) => add(w.dataset, x.field));
      add(w.dataset, w.groupBy);
      w.groupLevels.forEach((f) => add(w.dataset, f));
      conds(w.dataset, w.filters);
      w.highlight.forEach((h) => add(w.dataset, h.field));
    } else if (w.type === "detail")
      w.fields.forEach((f) => add(pickerDataset.get(w.control) ?? null, f.field));
    else if (w.type === "project_header")
      w.fields.forEach((f) => add(pickerDataset.get(w.control) ?? null, f));
  }
  return out;
}

/** Data sources every report can add from the widget builder (added on first use). */
export const DEFAULT_DATASETS: DatasetSpec[] = [
  { id: "jobs", source: "jobs", label: "All JobTread jobs", filters: [] },
  { id: "models", source: "catalog_models", label: "Product Library models", filters: [] },
  { id: "items", source: "cost_items", label: "Cost items (budget & catalog lines)", filters: [] },
];

export const BLANK_SPEC: ReportSpec = reportSpecSchema.parse({
  title: "Untitled report",
  datasets: DEFAULT_DATASETS.filter((d) => d.source !== "cost_items"),
});
