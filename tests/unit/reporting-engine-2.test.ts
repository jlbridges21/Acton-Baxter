/**
 * Reporting engine 2.0: the safe formula language, calculated fields (row, aggregate,
 * rollup), the Metric Library, nested groups with subtotals, viewer grouping/sorting/metric
 * controls and saved views, cross-source rollups without double counting, and Dexter's
 * engineering tools. Synthetic fixture only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { DEXTER_ENGINE_TOOLS, DEXTER_TOOLS } from "@/lib/agents/defaults";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { COST_ITEMS } from "@/lib/jobtread/fixture";
import { processEntitySyncJob, requestEntitySync } from "@/lib/jobtread/sync-manager";
import { runFullSync } from "@/lib/jobtread/sync";
import { listMemoryJobsForTests, resetMemoryJobsForTests } from "@/lib/jobs/queue";
import { getReportsAccess } from "@/lib/reports/access";
import { extendCatalogWithCalcs } from "@/lib/reports/calculations";
import type { Row } from "@/lib/reports/compute";
import { invalidateDataHealthCache } from "@/lib/reports/data-health";
import {
  checkSpecFields,
  executeReport,
  invalidateCatalogContext,
  loadSourceRows,
} from "@/lib/reports/engine";
import { getFieldCatalog, invalidateFieldCatalog } from "@/lib/reports/fields";
import {
  analyzeFormula,
  evaluateAggregate,
  evaluateRow,
  FormulaError,
  parseFormula,
  type ResolvedRef,
} from "@/lib/reports/formula";
import { buildGroupTree } from "@/lib/reports/grouping";
import {
  invalidateMetricLibrary,
  listMetricVersions,
  getMetric,
  metricUsage,
} from "@/lib/reports/metrics";
import { applyReportOps } from "@/lib/reports/ops";
import { createReport, getReport } from "@/lib/reports/repo";
import { listSavedViews, saveView } from "@/lib/reports/saved-views";
import {
  collectFieldRefs,
  reportSpecSchema,
  type CalculationSpec,
  type ReportSpec,
} from "@/lib/reports/spec";
import type { ChartResult, KpiResult, TableResult } from "@/lib/reports/result-types";
import trackerV3 from "../fixtures/allowance-tracker-v3.json";
import { ADMIN_ID, EMPLOYEE_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

vi.setConfig({ testTimeout: 30_000 });

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const employee = requester(EMPLOYEE_ID, "user", "Eli Employee");
const toolCtx = (r: Requester) => ({
  task: { id: "00000000-0000-4000-8000-0000000000f3", allowed_context: {} } as never,
  agent: { row: { id: "00000000-0000-4000-8000-00000000d0d0" } } as never,
  requester: r,
  access: new Set<never>(),
});
const run = async (key: string, args: unknown, who = admin) =>
  (await getTool(key)!.execute(toolCtx(who), args)).data as Record<string, unknown>;

async function drainJobs() {
  const { claimJobById, completeJob } = await import("@/lib/jobs/queue");
  for (let i = 0; i < 20; i++) {
    const job = listMemoryJobsForTests().find(
      (j) => j.status === "queued" && j.metadata.mode === "entities",
    );
    if (!job) return;
    await claimJobById(job.id);
    await processEntitySyncJob(job.metadata, { budgetMs: 60_000 });
    await completeJob(job.id);
  }
}

function invalidate() {
  invalidateCatalogContext();
  invalidateFieldCatalog();
  invalidateDataHealthCache();
  invalidateMetricLibrary();
}

beforeEach(async () => {
  await setupAgentTestEnv();
  resetMemoryJobsForTests();
  clearJobDetailCache();
  invalidate();
  installFakePave();
  await runFullSync("test");
  await requestEntitySync({ entities: ["cost_groups", "cost_items"], triggeredBy: "test" });
  await drainJobs();
  invalidate();
});
afterEach(() => uninstallFakePave());

/** Fixture orders: job 1 300k/210k, job 2 400k/300k, job 4 200k/215k. */
const ORDER_PRICE = 900_000;
const ORDER_COST = 725_000;
const WEIGHTED_MARGIN = ((ORDER_PRICE - ORDER_COST) / ORDER_PRICE) * 100;
const AVERAGE_MARGIN = (30 + 25 + -7.5) / 3;

const marginCalc: CalculationSpec = {
  key: "order_margin_pct",
  label: "Order margin %",
  source: "jobs",
  basis: "aggregate",
  formula: "(SUM(job.orderPrice) - SUM(job.orderCost)) / SUM(job.orderPrice) * 100",
  type: "percent",
};
const profitCalc: CalculationSpec = {
  key: "order_profit",
  label: "Order profit",
  source: "jobs",
  basis: "row",
  formula: "job.orderPrice - job.orderCost",
  type: "currency",
};
const costPerSqft: CalculationSpec = {
  key: "cost_per_sqft",
  label: "Cost per SQFT",
  source: "jobs",
  basis: "row",
  formula: "DIVIDE(job.projectedCost, sem:total_sqft)",
  type: "currency",
};
const budgetCost: CalculationSpec = {
  key: "budget_cost",
  label: "Budget cost (cost items)",
  source: "jobs",
  basis: "rollup",
  rollup: { relationship: "jobs.cost_items", op: "sum", field: "item.cost", filters: [] },
  type: "currency",
};

const spec = (input: Record<string, unknown>) =>
  reportSpecSchema.parse({ title: "Test", ...input });

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("formula language", () => {
  const kinds: Record<string, ResolvedRef> = {
    "item.price": { kind: "number", label: "Price" },
    "item.cost": { kind: "number", label: "Cost" },
    "item.name": { kind: "text", label: "Name" },
    "job.createdAt": { kind: "date", label: "Created" },
    "sem:phase": { kind: "list", label: "Phase" },
  };
  const resolve = (ref: string) => {
    const k = kinds[ref];
    if (!k) throw new FormulaError(`Unknown ${ref}`);
    return k;
  };
  const row = (r: Partial<Row>): Row => ({ id: "r", ...r }) as Row;
  const ev = (f: string, r: Partial<Row> = {}) => evaluateRow(parseFormula(f), row(r));

  it("evaluates arithmetic with precedence and financial-safe blanks", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev("-2 * 3")).toBe(-6);
    expect(ev("item.price - item.cost", { "item.price": 10.1, "item.cost": 5.05 })).toBe(5.05);
    expect(ev("item.price - item.cost", { "item.price": 10, "item.cost": null })).toBeNull();
    expect(ev("COALESCE(item.cost, 0) + 1", { "item.cost": null })).toBe(1);
    expect(ev("item.price / item.cost", { "item.price": 10, "item.cost": 0 })).toBeNull();
    expect(ev("DIVIDE(10, 4)")).toBe(2.5);
    expect(ev("PERCENT(1, 8)")).toBe(12.5);
    expect(ev("ROUND(2.345, 2)")).toBe(2.35);
    expect(ev("ABS(-3) + MIN(4, 2) + MAX(1, 5)")).toBe(10);
  });

  it("supports conditions, text, dates, and list comparisons", () => {
    expect(ev('IF(item.price > 100, "big", "small")', { "item.price": 150 })).toBe("big");
    expect(ev("IF(item.price > 100, 1)", { "item.price": 5 })).toBeNull();
    expect(ev('CONTAINS(item.name, "allow")', { "item.name": "Flooring Allowance" })).toBe(true);
    expect(ev('sem:phase = "BR-Permitting"', { "sem:phase": ["BR-Permitting"] })).toBe(true);
    expect(ev('DAYS_BETWEEN("2026-01-01", "2026-03-01")')).toBe(59);
    expect(ev('YEAR("2026-10-27") * 100 + MONTH("2026-10-27")')).toBe(202610);
    expect(ev("ISBLANK(item.cost) AND NOT ISBLANK(item.price)", { "item.price": 1 })).toBe(true);
    expect(ev('"#" & item.name', { "item.name": "A" })).toBe("#A");
  });

  it("computes aggregate formulas as weighted totals, distinct from averages", () => {
    const rows = [
      row({ "item.price": 100, "item.cost": 50 }), // 50%
      row({ "item.price": 900, "item.cost": 810 }), // 10%
    ];
    const weighted = evaluateAggregate(
      parseFormula("(SUM(item.price) - SUM(item.cost)) / SUM(item.price) * 100"),
      rows,
    );
    expect(weighted).toBe(14);
    expect(
      evaluateAggregate(parseFormula("AVG((item.price - item.cost) / item.price * 100)"), rows),
    ).toBe(30);
    expect(evaluateAggregate(parseFormula("COUNT()"), rows)).toBe(2);
    expect(
      evaluateAggregate(parseFormula("SUM(item.price) / SUM(item.cost * 0)"), rows),
    ).toBeNull();
  });

  it("rejects unsafe or invalid formulas with helpful messages", () => {
    const check =
      (f: string, basis: "row" | "aggregate" = "row") =>
      () =>
        analyzeFormula(parseFormula(f), basis, resolve);
    expect(check("constructor('x')")).toThrow(/Unknown function CONSTRUCTOR/);
    expect(() => parseFormula("process.exit")).toThrow(/isn't a field or function|Unexpected/);
    expect(check("EVAL(1)")).toThrow(/Unknown function EVAL/);
    expect(() => parseFormula("item.price; drop table")).toThrow(/Unexpected/);
    expect(check("SUM(item.price)")).toThrow(/aggregates across records/);
    expect(check("item.price - SUM(item.cost)", "aggregate")).toThrow(/wrap Price/);
    expect(check("item.name + 1")).toThrow(/needs numbers/);
    expect(check("item.price", "aggregate")).toThrow(/wrap/);
    expect(check("COUNT()", "aggregate")).not.toThrow();
    expect(check("job.createdAt - job.createdAt")).toThrow(/DAYS_BETWEEN/);
    expect(() => parseFormula("1 +".repeat(400))).toThrow(/limited|too long|ends/);
    expect(check("unknown.field")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("calculated fields in the catalog", () => {
  it("detects cycles, unknown fields, and type mismatches; inherits access", async () => {
    const base = await getFieldCatalog();
    const catalog = extendCatalogWithCalcs(base, [
      { spec: { ...profitCalc }, origin: "report" },
      {
        spec: {
          key: "a_calc",
          label: "A",
          source: "jobs",
          basis: "row",
          formula: "calc:b_calc + 1",
          type: "number",
        },
        origin: "report",
      },
      {
        spec: {
          key: "b_calc",
          label: "B",
          source: "jobs",
          basis: "row",
          formula: "calc:a_calc + 1",
          type: "number",
        },
        origin: "report",
      },
      {
        spec: {
          key: "bad_field",
          label: "Bad",
          source: "jobs",
          basis: "row",
          formula: "job.nope * 2",
          type: "number",
        },
        origin: "report",
      },
      {
        spec: {
          key: "bad_type",
          label: "Bad type",
          source: "jobs",
          basis: "row",
          formula: 'job.name & "!"',
          type: "currency",
        },
        origin: "report",
      },
      {
        spec: {
          key: "wrong_source",
          label: "Wrong source",
          source: "jobs",
          basis: "row",
          formula: "item.cost * 2",
          type: "number",
        },
        origin: "report",
      },
    ]);
    expect(catalog.calcErrors.get("calc:a_calc")).toMatch(/circular|uses calc:b_calc/);
    expect(catalog.calcErrors.get("calc:bad_field")).toMatch(/doesn't exist/);
    expect(catalog.calcErrors.get("calc:bad_type")).toMatch(/set to currency/);
    expect(catalog.calcErrors.get("calc:wrong_source")).toMatch(/cost_items field|relationship/);
    const profit = catalog.calcs.get("calc:order_profit")!;
    expect(profit.def.category).toBe("financial");
    expect(profit.def.requires).toContain("financial");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("A/B — calculated metrics in reports", () => {
  it("A: weighted margin KPI and chart are recomputed per group, not averaged", async () => {
    const access = await getReportsAccess(admin);
    const result = await executeReport({
      spec: spec({
        datasets: [{ id: "jobs", source: "jobs" }],
        calculations: [
          marginCalc,
          { ...profitCalc },
          {
            key: "order_margin_row",
            label: "Row margin %",
            source: "jobs",
            basis: "row",
            formula: "PERCENT(job.orderPrice - job.orderCost, job.orderPrice)",
            type: "percent",
          },
        ],
        widgets: [
          {
            id: "weighted",
            type: "kpi",
            dataset: "jobs",
            metric: { op: "formula", field: "calc:order_margin_pct" },
          },
          {
            id: "average",
            type: "kpi",
            dataset: "jobs",
            metric: { op: "avg", field: "calc:order_margin_row" },
          },
          {
            id: "profit",
            type: "kpi",
            dataset: "jobs",
            metric: { op: "sum", field: "calc:order_profit" },
          },
          {
            id: "by_phase",
            type: "chart",
            chart: "bar",
            dataset: "jobs",
            groupBy: "sem:phase",
            metric: { op: "formula", field: "calc:order_margin_pct" },
          },
        ],
      }),
      access,
    });
    expect((result.widgets.weighted as KpiResult).value).toBeCloseTo(WEIGHTED_MARGIN, 6);
    expect((result.widgets.average as KpiResult).value).toBeCloseTo(AVERAGE_MARGIN, 6);
    expect((result.widgets.profit as KpiResult).value).toBe(ORDER_PRICE - ORDER_COST);
    const chart = result.widgets.by_phase as ChartResult;
    const design = chart.points.find((p) => p.key === "BR-Design")!;
    expect(design.value).toBeCloseTo(((700_000 - 510_000) / 700_000) * 100, 6); // jobs 1+2 weighted
    expect(chart.provenance?.notes.join(" ")).toMatch(/weighted/);
  });

  it("B: cost per SQFT handles missing and zero square footage as blank", async () => {
    const { rows } = await loadSourceRows("jobs", undefined, { calculations: [costPerSqft] });
    const byName = Object.fromEntries(rows.map((r) => [r["job.name"], r["calc:cost_per_sqft"]]));
    expect(byName["Test Project 1"]).toBeCloseTo(210_000 / 498, 6);
    expect(byName["Test Project 2"]).toBeCloseTo(300_000 / 698, 6);
    expect(byName["Test Project 3"]).toBeNull(); // no projected cost
    expect(byName["Test Project 4"]).toBeNull(); // no square footage
    const check = await run("reports_calculation_check", { calculation: costPerSqft });
    expect(check).toMatchObject({ ok: true, computed: 2, blank: 4 });
  });

  it("hides financial calculations from people without financial access", async () => {
    const access = await getReportsAccess(employee);
    const result = await executeReport({
      spec: spec({
        datasets: [{ id: "jobs", source: "jobs" }],
        calculations: [marginCalc],
        widgets: [
          {
            id: "k",
            type: "kpi",
            dataset: "jobs",
            metric: { op: "formula", field: "calc:order_margin_pct" },
          },
        ],
      }),
      access,
    });
    expect(result.widgets.k!.status).toBe("restricted");
  });

  it("refuses aggregate calculations as filters or groupings when saving", async () => {
    const s = spec({
      datasets: [
        {
          id: "jobs",
          source: "jobs",
          filters: [{ field: "calc:order_margin_pct", op: "gt", value: 10 }],
        },
      ],
      calculations: [marginCalc],
      widgets: [{ id: "k", type: "kpi", dataset: "jobs", metric: { op: "count" } }],
    });
    const check = await checkSpecFields(s, await getReportsAccess(admin), collectFieldRefs(s));
    expect(check.missing.join(" ")).toMatch(/aggregate calculation/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("C — multi-level grouping with subtotals", () => {
  it("builds Phase → Project Manager → Job groups whose subtotals add up", async () => {
    const access = await getReportsAccess(admin);
    const result = await executeReport({
      spec: spec({
        datasets: [
          {
            id: "lines",
            source: "cost_items",
            filters: [{ field: "item.context", op: "eq", value: "Job budget" }],
          },
        ],
        widgets: [
          {
            id: "t",
            type: "table",
            dataset: "lines",
            groupLevels: ["sem:phase", "sem:project_manager", "item.job"],
            columns: [{ field: "item.name" }, { field: "item.cost" }, { field: "item.price" }],
          },
        ],
      }),
      access,
    });
    const table = result.widgets.t as TableResult;
    const jobLines = COST_ITEMS.filter((_, i) => i >= 40);
    const total = jobLines.reduce((t, c) => t + c.cost, 0);
    expect(table.groupLevels!.map((l) => l.label)).toEqual(["Phase", "Project Manager", "Job"]);
    expect(table.totals!["item.cost"]).toBe(total);
    expect(table.groups!.reduce((t, g) => t + Number(g.values["item.cost"]), 0)).toBe(total);
    const design = table.groups!.find((g) => g.label === "BR-Design")!;
    expect(design.children.map((c) => c.label).sort()).toEqual(["Connor", "Maxx"]);
    const leaf = design.children[0]!.children[0]!;
    expect(leaf.rowIds.length).toBe(leaf.count);
    expect(table.rows.length).toBe(jobLines.length);
    // Prices with blanks: subtotal of known values, with the blank count flagged.
    expect(table.totalsIncomplete!["item.price"]).toBeGreaterThan(0);
  });

  it("recomputes aggregate calculations per group instead of summing them", () => {
    const rows: Row[] = [
      { id: "1", "item.group": "A", "item.price": 100, "item.cost": 50 },
      { id: "2", "item.group": "A", "item.price": 900, "item.cost": 810 },
      { id: "3", "item.group": "B", "item.price": 100, "item.cost": 90 },
    ];
    const margin = parseFormula("(SUM(item.price) - SUM(item.cost)) / SUM(item.price) * 100");
    const tree = buildGroupTree(
      rows,
      [{ key: "item.group", label: "G" }],
      [
        { key: "item.price", mode: "sum" },
        { key: "m", mode: "formula", evaluate: (rs) => evaluateAggregate(margin, rs) as number },
      ],
    );
    expect(tree.groups.map((g) => [g.label, g.values["item.price"], g.values.m])).toEqual([
      ["A", 1000, 14],
      ["B", 100, 10],
    ]);
    expect(tree.totals.m).toBeCloseTo(((1100 - 950) / 1100) * 100, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("D — viewer controls and saved views", () => {
  const controlled = () =>
    spec({
      datasets: [{ id: "jobs", source: "jobs" }],
      calculations: [costPerSqft],
      controls: [
        {
          id: "grouping",
          kind: "group_by",
          label: "Group by",
          widgets: ["t", "c"],
          options: ["sem:phase", "sem:project_manager", "job.city"],
          default: ["sem:phase"],
        },
        {
          id: "sorting",
          kind: "sort",
          label: "Sort",
          widgets: ["t"],
          options: ["job.projectedCost", "job.name"],
          default: { field: "job.name", dir: "asc" },
        },
        {
          id: "measure",
          kind: "metric_picker",
          label: "Show",
          widgets: ["c"],
          options: [
            { label: "Jobs", metric: { op: "count" } },
            { label: "Avg cost per sqft", metric: { op: "avg", field: "calc:cost_per_sqft" } },
          ],
        },
      ],
      widgets: [
        {
          id: "t",
          type: "table",
          dataset: "jobs",
          columns: [{ field: "job.name" }, { field: "job.projectedCost" }],
        },
        {
          id: "c",
          type: "chart",
          chart: "bar",
          dataset: "jobs",
          groupBy: "job.state",
          metric: { op: "count" },
        },
      ],
    });

  it("applies viewer grouping, sorting, and metric choices without changing the spec", async () => {
    const access = await getReportsAccess(admin);
    const s = controlled();
    const before = JSON.stringify(s);
    const byDefault = await executeReport({ spec: s, access });
    expect((byDefault.widgets.t as TableResult).groupLevels!.map((l) => l.label)).toEqual([
      "Phase",
    ]);
    expect((byDefault.widgets.c as ChartResult).groupLabel).toBe("Phase");

    const viewer = await executeReport({
      spec: s,
      access,
      state: {
        grouping: ["job.city", "sem:phase"],
        sorting: ["job.projectedCost", "desc"],
        measure: "1",
      },
    });
    const t = viewer.widgets.t as TableResult;
    expect(t.groupLevels!.map((l) => l.label)).toEqual(["City", "Phase"]);
    expect(t.sortedBy).toEqual({ key: "job.projectedCost", dir: "desc" });
    const chart = viewer.widgets.c as ChartResult;
    expect(chart.groupLabel).toBe("City");
    expect(chart.metricLabel).toBe("Average Cost per SQFT");
    expect(viewer.controls.grouping).toMatchObject({
      kind: "group_by",
      selected: ["job.city", "sem:phase"],
    });
    // Ungrouped on request.
    const flat = await executeReport({ spec: s, access, state: { grouping: [] } });
    expect((flat.widgets.t as TableResult).groups).toBeUndefined();
    expect(JSON.stringify(s)).toBe(before); // published defaults untouched
  });

  it("offers only fields the viewer may see", async () => {
    const s = controlled();
    const result = await executeReport({ spec: s, access: await getReportsAccess(employee) });
    const sorting = result.controls.sorting;
    expect(sorting?.kind === "sort" && sorting.options.map((o) => o.value)).toEqual(["job.name"]);
    const measure = result.controls.measure;
    expect(measure?.kind === "metric_picker" && measure.options.map((o) => o.label)).toEqual([
      "Jobs",
    ]);
  });

  it("saves personal views per person, keeping only known controls", async () => {
    const s = controlled();
    const report = await createReport({
      spec: s,
      ownerId: ADMIN_ID,
      authorKind: "user",
      summary: "x",
    });
    await saveView({
      reportId: report.id,
      userId: ADMIN_ID,
      spec: s,
      name: "By city",
      state: { grouping: ["job.city"], bogus: "x" },
      isDefault: true,
    });
    const mine = await listSavedViews(report.id, ADMIN_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.state).toEqual({ grouping: ["job.city"] });
    expect(await listSavedViews(report.id, EMPLOYEE_ID)).toHaveLength(0);
    expect((await getReport(report.id))!.version).toBe(report.version);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("E — cross-source rollups", () => {
  it("rolls cost items up to jobs by id, so totals by phase match the line-level totals", async () => {
    const access = await getReportsAccess(admin);
    const result = await executeReport({
      spec: spec({
        datasets: [
          { id: "jobs", source: "jobs" },
          {
            id: "lines",
            source: "cost_items",
            filters: [{ field: "item.context", op: "eq", value: "Job budget" }],
          },
        ],
        calculations: [
          budgetCost,
          {
            key: "line_count",
            label: "Budget lines",
            source: "jobs",
            basis: "rollup",
            rollup: { relationship: "jobs.cost_items", op: "count" },
            type: "number",
          },
        ],
        widgets: [
          {
            id: "by_phase_jobs",
            type: "chart",
            chart: "bar",
            dataset: "jobs",
            groupBy: "sem:phase",
            metric: { op: "sum", field: "calc:budget_cost" },
          },
          {
            id: "by_phase_lines",
            type: "chart",
            chart: "bar",
            dataset: "lines",
            groupBy: "sem:phase",
            metric: { op: "sum", field: "item.cost" },
          },
          { id: "jobs_count", type: "kpi", dataset: "jobs", metric: { op: "count" } },
          {
            id: "total",
            type: "kpi",
            dataset: "jobs",
            metric: { op: "sum", field: "calc:budget_cost" },
          },
        ],
      }),
      access,
    });
    const viaJobs = (result.widgets.by_phase_jobs as ChartResult).points.filter(
      (p) => p.value !== null,
    );
    const viaLines = (result.widgets.by_phase_lines as ChartResult).points;
    expect(Object.fromEntries(viaJobs.map((p) => [p.key, p.value]))).toEqual(
      Object.fromEntries(viaLines.map((p) => [p.key, p.value])),
    );
    expect((result.widgets.jobs_count as KpiResult).value).toBe(6); // no fan-out
    expect((result.widgets.total as KpiResult).value).toBe(
      COST_ITEMS.filter((_, i) => i >= 40).reduce((t, c) => t + c.cost, 0),
    );
    const { rows } = await loadSourceRows("jobs", undefined, {
      calculations: [
        budgetCost,
        {
          key: "line_count",
          label: "n",
          source: "jobs",
          basis: "rollup",
          rollup: { relationship: "jobs.cost_items", op: "count", filters: [] },
          type: "number",
        },
      ],
    });
    const job5 = rows.find((r) => r["job.name"] === "Test Project 5")!;
    expect(job5["calc:budget_cost"]).toBeNull(); // no lines → blank, not 0
    expect(job5["calc:line_count"]).toBe(0);
  });

  it("H: Dexter discovers and validates relationships; admins approve related fields after preview", async () => {
    const rels = await run("reports_relationships", { source: "jobs" });
    expect((rels.rollups as Array<{ id: string }>).map((r) => r.id)).toContain("jobs.cost_items");
    const check = await run("reports_relationship_check", { relationship: "jobs.cost_items" });
    expect(check).toMatchObject({ ok: true, unmatched: 0, parentsWithChildren: 3 });

    const preview = await run("reports_relationship_approve_field", {
      relationship: "cost_items.job",
      ref: "sem:total_sqft",
    });
    expect(preview).toMatchObject({ ok: true, preview: expect.any(Object) });
    const applied = await run("reports_relationship_approve_field", {
      relationship: "cost_items.job",
      ref: "sem:total_sqft",
      confirm: true,
    });
    expect(applied).toMatchObject({ ok: true, applied: true });
    expect(applied.approvedFields).toContain("sem:total_sqft");

    const refused = await run(
      "reports_relationship_approve_field",
      { relationship: "cost_items.job", ref: "job.projectedPrice", confirm: true },
      employee,
    );
    expect(refused).toMatchObject({ ok: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("F/G — conversational editing and the Metric Library", () => {
  it("F: changes a chart's metric through report ops, preserving other widgets", async () => {
    const base = reportSpecSchema.parse(trackerV3);
    const applied = applyReportOps(base, [
      {
        op: "set_calculation",
        calculation: {
          key: "allowance_markup_pct",
          label: "Allowance markup %",
          source: "cost_items",
          basis: "aggregate",
          formula: "(SUM(item.price) - SUM(item.cost)) / SUM(item.cost) * 100",
          type: "percent",
        },
      },
      {
        op: "update_widget",
        id: "chart_job_price",
        changes: { metric: { op: "formula", field: "calc:allowance_markup_pct" } },
      },
      {
        op: "update_widget",
        id: "table_lines",
        changes: { groupLevels: ["sem:phase", "item.job"] },
      },
    ]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.spec.widgets.map((w) => w.id)).toEqual(base.widgets.map((w) => w.id));
    expect(applied.summary.join(" ")).toMatch(/Added calculation/);
    const result = await executeReport({
      spec: applied.spec,
      access: await getReportsAccess(admin),
    });
    expect(result.widgets.chart_job_price!.status).not.toBe("error");
    expect(result.widgets.kpi_lines!.status).not.toBe("error");
  });

  it("G: saves a reusable metric, reuses it in another report, and versions changes", async () => {
    const saved = await run("reports_metric_save", {
      calculation: costPerSqft,
      visibility: "private",
    });
    expect(saved).toMatchObject({ saved: true, ref: "calc:cost_per_sqft", version: 1 });
    const listed = await run("reports_metrics", { search: "sqft" });
    expect((listed.metrics as Array<{ ref: string; canEdit: boolean }>)[0]).toMatchObject({
      ref: "calc:cost_per_sqft",
      canEdit: true,
    });
    // Another report uses the library metric without redefining it.
    const created = await run("reports_create", {
      spec: {
        title: "Cost per sqft by phase",
        datasets: [{ id: "jobs", source: "jobs" }],
        widgets: [
          {
            id: "c",
            type: "chart",
            chart: "bar",
            dataset: "jobs",
            groupBy: "sem:phase",
            metric: { op: "avg", field: "calc:cost_per_sqft" },
          },
        ],
      },
      summary: "Reuse",
    });
    expect(created).toMatchObject({ saved: true });
    expect((await metricUsage("cost_per_sqft")).reports.map((r) => r.title)).toContain(
      "Cost per sqft by phase",
    );
    const v2 = await run("reports_metric_save", {
      calculation: {
        ...costPerSqft,
        formula: "ROUND(DIVIDE(job.projectedCost, sem:total_sqft), 2)",
      },
      visibility: "private",
      expectedVersion: 1,
    });
    expect(v2).toMatchObject({ saved: true, version: 2 });
    const metric = (await getMetric("cost_per_sqft"))!;
    expect((await listMetricVersions(metric.id)).map((v) => v.version)).toEqual([2, 1]);
  });

  it("G: company metrics need a Reports manager; others can't overwrite them", async () => {
    const refused = await run(
      "reports_metric_save",
      { calculation: marginCalc, visibility: "company" },
      employee,
    );
    expect(refused).toMatchObject({ ok: false });
    expect(String(refused.problem)).toMatch(/Reports managers/);
    await run("reports_metric_save", { calculation: { ...profitCalc }, visibility: "company" });
    const overwrite = await run(
      "reports_metric_save",
      { calculation: { ...profitCalc, formula: "job.orderPrice" }, visibility: "private" },
      employee,
    );
    expect(String(overwrite.problem)).toMatch(/company metric/);
  });

  it("enables the engine tools for Dexter", () => {
    for (const t of DEXTER_ENGINE_TOOLS) {
      expect(DEXTER_TOOLS).toContain(t);
      expect(getTool(t)).toBeDefined();
      expect(t.startsWith("reports_")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("I/J — persistence and backwards compatibility", () => {
  it("keeps saved v1 specs (no calculations, single groupBy) rendering unchanged", async () => {
    const old = reportSpecSchema.parse(trackerV3) as ReportSpec;
    expect(old.calculations).toEqual([]);
    const result = await executeReport({ spec: old, access: await getReportsAccess(admin) });
    const table = result.widgets.table_lines as TableResult;
    expect(table.groups).toBeUndefined();
    expect(table.totals).toBeUndefined();
  });

  it("persists calculations, grouping, and controls through a saved report", async () => {
    const s = spec({
      datasets: [{ id: "jobs", source: "jobs" }],
      calculations: [costPerSqft, budgetCost],
      controls: [
        {
          id: "g",
          kind: "group_by",
          label: "Group",
          widgets: ["t"],
          options: ["sem:phase", "job.city"],
        },
      ],
      widgets: [
        {
          id: "t",
          type: "table",
          dataset: "jobs",
          groupLevels: ["sem:phase"],
          columns: [{ field: "job.name" }, { field: "calc:budget_cost" }],
        },
      ],
    });
    const report = await createReport({
      spec: s,
      ownerId: ADMIN_ID,
      authorKind: "dexter",
      summary: "x",
    });
    const reopened = (await getReport(report.id))!;
    expect(reopened.spec.calculations.map((c) => c.key)).toEqual(["cost_per_sqft", "budget_cost"]);
    const result = await executeReport({
      spec: reopened.spec,
      access: await getReportsAccess(admin),
    });
    expect((result.widgets.t as TableResult).groups!.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("autonomous cross-source relationships", () => {
  const modelLookup = {
    id: "item_model",
    kind: "lookup",
    label: "Model",
    from: "cost_items",
    to: "catalog_models",
    key: "item.modelId",
    fields: ["model.series", "model.basePrice"],
  } as const;

  it("discovers verified stable-id joins and refuses sources without one", async () => {
    const found = await run("reports_relationship_discover", { from: "cost_items", to: "jobs" });
    const top = (found.candidates as Array<Record<string, unknown>>)[0]!;
    expect(top).toMatchObject({
      key: "item.jobId",
      keySource: "cost_items",
      idSource: "jobs",
      verdict: "verified",
      matchRate: 1,
    });
    expect(["cost_items.job", "jobs.cost_items"]).toContain(top.registered);
    expect(top.rollup).toMatchObject({
      parent: "jobs",
      child: "cost_items",
      childKey: "item.jobId",
    });
    const none = await run("reports_relationship_discover", { from: "jobs", to: "catalog_models" });
    expect(
      (none.candidates as unknown[]).filter(
        (c) => (c as { verdict: string }).verdict === "verified",
      ),
    ).toEqual([]);
    expect(String(none.summary)).toMatch(/No stable-id join|uncertain/);
  });

  it("lets Dexter save a report-specific lookup without approval; rows and totals are unchanged", async () => {
    const created = await run(
      "reports_create",
      {
        spec: {
          title: "Lines with model data",
          datasets: [{ id: "lines", source: "cost_items" }],
          relationships: [modelLookup],
          widgets: [
            { id: "n", type: "kpi", dataset: "lines", metric: { op: "count" } },
            {
              id: "by_series",
              type: "chart",
              chart: "bar",
              dataset: "lines",
              groupBy: "model.series",
              metric: { op: "count" },
            },
          ],
        },
        summary: "Join cost items to their model",
      },
      employee,
    );
    expect(created).toMatchObject({ saved: true });
    const report = (await getReport(created.reportId as string))!;
    expect(report.spec.relationships.map((r) => r.id)).toEqual(["item_model"]);
    const result = await executeReport({
      spec: report.spec,
      access: await getReportsAccess(employee),
    });
    expect((result.widgets.n as KpiResult).value).toBe(COST_ITEMS.length);
    const series = (result.widgets.by_series as ChartResult).points;
    expect(series.reduce((t, p) => t + p.count, 0)).toBe(COST_ITEMS.length);
    expect(series.map((p) => p.key)).not.toContain("i 398"); // series, not model names
    // Financial related fields stay restricted for this viewer.
    const { rows, catalog } = await loadSourceRows("cost_items", undefined, report.spec);
    expect(rows.find((r) => r.id === "ci000000")!["model.series"]).not.toBeNull();
    expect(catalog.related.cost_items.get("model.basePrice")?.relationship).toBe("item_model");
  });

  it("supports report rollups through calculations, without double counting", async () => {
    const s = spec({
      datasets: [{ id: "models", source: "catalog_models" }],
      relationships: [
        {
          id: "model_lines",
          kind: "rollup",
          label: "Model lines",
          parent: "catalog_models",
          child: "cost_items",
          childKey: "item.modelId",
        },
      ],
      calculations: [
        {
          key: "line_cost",
          label: "Line cost",
          source: "catalog_models",
          basis: "rollup",
          rollup: { relationship: "model_lines", op: "sum", field: "item.cost" },
          type: "currency",
        },
      ],
      widgets: [
        { id: "models", type: "kpi", dataset: "models", metric: { op: "count" } },
        {
          id: "cost",
          type: "kpi",
          dataset: "models",
          metric: { op: "sum", field: "calc:line_cost" },
        },
      ],
    });
    const check = await checkSpecFields(s, await getReportsAccess(admin), collectFieldRefs(s));
    expect(check.missing).toEqual([]);
    const result = await executeReport({ spec: s, access: await getReportsAccess(admin) });
    const catalogLines = COST_ITEMS.filter((_, i) => i < 40).reduce((t, c) => t + c.cost, 0);
    expect((result.widgets.cost as KpiResult).value).toBe(catalogLines);
  });

  it("rejects name joins, wrong-id keys, and ambiguous second joins with clear reasons", async () => {
    const access = await getReportsAccess(admin);
    const bad = spec({
      datasets: [{ id: "lines", source: "cost_items" }],
      relationships: [
        {
          id: "by_name",
          kind: "lookup",
          label: "Job by name",
          from: "cost_items",
          to: "jobs",
          key: "item.job",
          fields: ["sem:total_sqft"],
        },
        {
          id: "wrong_id",
          kind: "lookup",
          label: "Wrong",
          from: "cost_items",
          to: "catalog_models",
          key: "item.jobId",
          fields: ["model.series"],
        },
        {
          id: "twice",
          kind: "lookup",
          label: "Twice",
          from: "cost_items",
          to: "jobs",
          key: "item.sourceItemId",
          fields: ["sem:phase"],
        },
      ],
      widgets: [{ id: "n", type: "kpi", dataset: "lines", metric: { op: "count" } }],
    });
    const { missing } = await checkSpecFields(bad, access, collectFieldRefs(bad));
    const text = missing.join(" | ");
    expect(text).toMatch(/Job by name.*isn't a stable key/);
    expect(text).toMatch(/Wrong.*holds jobs ids, not catalog_models ids/);
    expect(text).toMatch(/Twice.*already available on cost_items/);
  });

  it("lets administrators promote a report relationship company-wide after a preview", async () => {
    const report = await createReport({
      spec: spec({
        datasets: [{ id: "lines", source: "cost_items" }],
        relationships: [modelLookup],
      }),
      ownerId: ADMIN_ID,
      authorKind: "dexter",
      summary: "x",
    });
    const refused = await run(
      "reports_relationship_promote",
      { reportId: report.id, relationship: "item_model", confirm: true },
      employee,
    );
    expect(refused).toMatchObject({ ok: false });
    const preview = await run("reports_relationship_promote", {
      reportId: report.id,
      relationship: "item_model",
    });
    expect(preview).toMatchObject({ ok: true, preview: expect.any(Object) });
    const done = await run("reports_relationship_promote", {
      reportId: report.id,
      relationship: "item_model",
      confirm: true,
    });
    expect(done).toMatchObject({ ok: true, applied: true });
    // Another report uses the company relationship without defining it.
    const other = spec({
      datasets: [{ id: "lines", source: "cost_items" }],
      widgets: [
        {
          id: "c",
          type: "chart",
          chart: "bar",
          dataset: "lines",
          groupBy: "model.series",
          metric: { op: "count" },
        },
      ],
    });
    const check = await checkSpecFields(
      other,
      await getReportsAccess(admin),
      collectFieldRefs(other),
    );
    expect(check.missing).toEqual([]);
    const listed = await run("reports_relationships", { source: "cost_items" });
    expect((listed.company as Array<{ id: string }>).map((r) => r.id)).toContain("item_model");
  });
});
