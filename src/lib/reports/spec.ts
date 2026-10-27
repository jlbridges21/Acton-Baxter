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
 */

import { z } from "zod";

export const REPORT_SCHEMA_VERSION = 1;

const id = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,39}$/, "Ids use lowercase letters, numbers, dashes, or underscores.");
export const fieldRef = z
  .string()
  .trim()
  .regex(
    /^(job\.[a-zA-Z]+|model\.[a-zA-Z]+|item\.[a-zA-Z]+|com\.[a-zA-Z]+|cf:[A-Za-z0-9]{6,40}|sem:[a-z0-9_]{2,60})$/,
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
] as const;
export const metricSchema = z.object({
  op: z.enum(METRIC_OPS),
  field: fieldRef.optional(),
  label: z.string().max(80).optional(),
});
export type Metric = z.infer<typeof metricSchema>;

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
]);
export type ControlSpec = z.infer<typeof controlSchema>;

export const SPANS = [3, 4, 6, 8, 12] as const;
const widgetBase = {
  id,
  title: z.string().trim().max(100).default(""),
  description: z.string().max(400).optional(),
  span: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]).default(6),
  height: z.enum(["sm", "md", "lg", "auto"]).default("auto"),
  hidden: z.boolean().default(false),
};

const columnSchema = z.object({
  field: fieldRef,
  label: z.string().max(60).optional(),
  format: z.enum(FORMATS).default("auto"),
  width: z.number().int().min(60).max(600).optional(),
  wrap: z.boolean().default(false),
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
    dataset: id,
    metric: metricSchema,
    filters: z.array(conditionSchema).max(10).default([]),
    format: z.enum(FORMATS).default("auto"),
    drilldown: z.boolean().default(true),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("chart"),
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
    dataset: id,
    columns: z.array(columnSchema).min(1).max(30),
    sort: z
      .array(z.object({ field: fieldRef, dir: z.enum(["asc", "desc"]).default("asc") }))
      .max(3)
      .default([]),
    pageSize: z.number().int().min(5).max(100).default(25),
    groupBy: fieldRef.optional(),
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
    control: id,
    fields: z.array(fieldRef).max(8).default([]),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("detail"),
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
    control: id,
    show: z.enum(["schedule", "checklists", "all"]).default("schedule"),
    style: z.enum(["timeline", "list"]).default("timeline"),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("documents"),
    control: id,
    groupByFolder: z.boolean().default(true),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("text"),
    body: z.string().max(2000),
  }),
  /**
   * Live data status: when each synced dataset this report reads last refreshed and whether it
   * is fresh. Use instead of typing sync dates or import progress into a text widget.
   */
  z.object({
    ...widgetBase,
    type: z.literal("data_status"),
  }),
  /** Edit commission rates for a rule set (authorized users only; changes are audited). */
  z.object({
    ...widgetBase,
    type: z.literal("rate_editor"),
    ruleSet: ruleSetKey,
  }),
  /** Assign JobTread projects to salespeople, with splits and payment dates. */
  z.object({
    ...widgetBase,
    type: z.literal("assignment_editor"),
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
  controls: z.array(controlSchema).max(10).default([]),
  /** Order = layout order on a 12-column grid. */
  widgets: z.array(widgetSchema).max(40).default([]),
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
  spec.controls.forEach((c) => {
    if (c.kind === "job_picker") return;
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
