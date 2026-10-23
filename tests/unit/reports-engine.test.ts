import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAccessPolicy } from "@/lib/agents/admin";
import { getResolvedAgent } from "@/lib/agents/registry";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { runFullSync } from "@/lib/jobtread/sync";
import { getReportsAccess } from "@/lib/reports/access";
import {
  aggregate,
  computeSeries,
  formatCurrency,
  groupRows,
  parseModelName,
  sortRows,
  type Row,
} from "@/lib/reports/compute";
import { csvFilename, toCsv } from "@/lib/reports/csv";
import { drilldown, executeReport } from "@/lib/reports/engine";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { applyReportOps, diffSpecs } from "@/lib/reports/ops";
import type {
  ChartResult,
  DetailResult,
  KpiResult,
  MilestonesResult,
  TableResult,
} from "@/lib/reports/result-types";
import {
  parseReportSpec,
  reportSpecSchema,
  widgetSchema,
  type ReportSpec,
} from "@/lib/reports/spec";
import {
  ACTIVE_PROJECTS_TEMPLATE,
  DESIGN_HANDOFF_TEMPLATE,
  PRODUCT_LIBRARY_TEMPLATE,
  REPORT_TEMPLATES,
} from "@/lib/reports/templates";
import { ADMIN_ID, EMPLOYEE_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { F, installFakePave, JOBS, uninstallFakePave } from "./jobtread-fixtures";

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const employee = requester(EMPLOYEE_ID, "user", "Eli Employee");

// ---------------------------------------------------------------------------
// Pure calculations
// ---------------------------------------------------------------------------

describe("compute", () => {
  const rows: Row[] = [
    { id: "1", phase: "Design", pm: "Maxx", sqft: 500, price: 0.1, tags: ["A", "B"] },
    { id: "2", phase: "Design", pm: null, sqft: null, price: 0.2, tags: ["A"] },
    { id: "3", phase: "Permitting", pm: "Connor", sqft: 1000, price: null, tags: [] },
  ];

  it("excludes blanks from averages and reports how many were blank", () => {
    expect(aggregate(rows, { op: "avg", field: "sqft" })).toEqual({
      value: 750,
      counted: 2,
      blank: 1,
    });
    expect(aggregate(rows, { op: "count" }).value).toBe(3);
    expect(aggregate(rows, { op: "median", field: "sqft" }).value).toBe(750);
    expect(aggregate([], { op: "sum", field: "sqft" }).value).toBeNull();
  });

  it("avoids float noise in sums", () => {
    expect(aggregate(rows, { op: "sum", field: "price" }).value).toBe(0.3);
  });

  it("groups blanks as (blank) and multi-value rows under each value", () => {
    expect([...groupRows(rows, "pm").keys()]).toEqual(["Maxx", "(blank)", "Connor"]);
    const tags = groupRows(rows, "tags");
    expect(tags.get("A")?.length).toBe(2);
    expect(tags.get("B")?.length).toBe(1);
    expect(tags.get("(blank)")?.length).toBe(1);
  });

  it("folds extra groups into Other and re-aggregates the underlying rows", () => {
    const many: Row[] = Array.from({ length: 10 }, (_, i) => ({ id: String(i), g: `G${i}`, v: i }));
    const { points } = computeSeries({
      rows: many,
      groupBy: "g",
      metric: { op: "avg", field: "v" },
      sort: "value_desc",
      limit: 4,
    });
    expect(points).toHaveLength(4);
    expect(points[3]).toMatchObject({ key: "Other (7)", isOther: true, count: 7, value: 3 });
  });

  it("sorts blanks last in either direction", () => {
    expect(sortRows(rows, [{ field: "sqft", dir: "desc" }]).map((r) => r.id)).toEqual([
      "3",
      "1",
      "2",
    ]);
    expect(sortRows(rows, [{ field: "sqft", dir: "asc" }]).map((r) => r.id)).toEqual([
      "1",
      "3",
      "2",
    ]);
  });

  it("formats currency and splits model names", () => {
    expect(formatCurrency(368620.75)).toBe("$368,621");
    expect(formatCurrency(12.5)).toBe("$12.50");
    expect(parseModelName("Age in Place - 498-A-1")).toEqual({
      series: "Age in Place",
      code: "498-A-1",
    });
    expect(parseModelName("i+ 998-B-1")).toEqual({ series: "i+", code: "998-B-1" });
  });
});

describe("CSV export", () => {
  it("escapes quotes and neutralizes spreadsheet formulas", () => {
    const csv = toCsv(
      ["Name", "Value"],
      [
        ['=HYPERLINK("x")', -5],
        ['Smith, "Jr"', ["a", "b"]],
      ],
    );
    expect(csv).toBe(`Name,Value\r\n"'=HYPERLINK(""x"")",-5\r\n"Smith, ""Jr""",a; b\r\n`);
    expect(csvFilename("Design / Handoff!")).toMatch(/^Design-Handoff-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

// ---------------------------------------------------------------------------
// Specs, templates, and structured edits
// ---------------------------------------------------------------------------

describe("report spec", () => {
  it("validates every starter template", () => {
    for (const t of REPORT_TEMPLATES) expect(parseReportSpec(t.spec).ok).toBe(true);
  });

  it("rejects widget types and fields that aren't in the schema (no executable content)", () => {
    expect(
      widgetSchema.safeParse({ id: "x", type: "html", html: "<script>alert(1)</script>" }).success,
    ).toBe(false);
    expect(
      widgetSchema.safeParse({
        id: "x",
        type: "kpi",
        dataset: "d",
        metric: { op: "eval", field: "job.name" },
      }).success,
    ).toBe(false);
    expect(
      widgetSchema.safeParse({
        id: "x",
        type: "kpi",
        dataset: "d",
        metric: { op: "sum", field: "job.name; DROP TABLE" },
      }).success,
    ).toBe(false);
    const parsed = widgetSchema.parse({
      id: "note",
      type: "text",
      body: "<img src=x onerror=alert(1)>",
      onClick: "alert(1)",
    });
    expect(parsed).not.toHaveProperty("onClick");
  });

  it("reports broken references between datasets, controls, and widgets", () => {
    const res = parseReportSpec({
      title: "Broken",
      datasets: [{ id: "jobs", source: "jobs" }],
      controls: [{ id: "pick", kind: "job_picker", label: "Project", dataset: "missing" }],
      widgets: [
        { id: "chart", type: "chart", dataset: "jobs", chart: "bar" },
        { id: "detail", type: "detail", control: "nope", fields: [{ field: "job.name" }] },
        { id: "kpi", type: "kpi", dataset: "jobs", metric: { op: "sum" } },
      ],
    });
    expect(res.ok).toBe(false);
    const messages = res.ok ? [] : res.issues.map((i) => i.message).join(" | ");
    expect(messages).toMatch(/unknown dataset "missing"/);
    expect(messages).toMatch(/needs a groupBy/);
    expect(messages).toMatch(/needs a job picker/);
    expect(messages).toMatch(/"sum" needs a field/);
  });
});

describe("structured edits", () => {
  const base = ACTIVE_PROJECTS_TEMPLATE;

  it("changes only what the operations touch", () => {
    const res = applyReportOps(base, [
      { op: "update_widget", id: "by_pm", changes: { chart: "bar", title: "PM workload" } },
      {
        op: "add_widget",
        widget: {
          id: "by_model",
          type: "chart",
          dataset: "active_jobs",
          chart: "bar",
          groupBy: "sem:model",
        },
        position: { after: "by_phase" },
      },
      { op: "remove_widget", id: "in_permitting" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.spec.widgets.map((w) => w.id);
    expect(ids).toEqual([
      "active_count",
      "in_design",
      "avg_sqft",
      "by_phase",
      "by_model",
      "by_pm",
      "projects",
    ]);
    expect(res.spec.widgets.find((w) => w.id === "projects")).toEqual(
      base.widgets.find((w) => w.id === "projects"),
    );
    expect(res.spec.datasets).toEqual(base.datasets);
    expect(diffSpecs(base, res.spec)).toEqual(
      expect.arrayContaining([
        'Added chart "by_model"',
        'Removed kpi "In permitting"',
        'Changed chart "PM workload"',
      ]),
    );
  });

  it("rejects invalid edits atomically", () => {
    const res = applyReportOps(base, [
      { op: "set_title", title: "Renamed" },
      { op: "update_widget", id: "by_pm", changes: { chart: "pie3d" } },
    ]);
    expect(res.ok).toBe(false);
    expect(applyReportOps(base, [{ op: "remove_widget", id: "ghost" }]).ok).toBe(false);
    expect(applyReportOps(base, [{ op: "run_sql", sql: "select 1" }]).ok).toBe(false);
    expect(base.title).toBe("Active Projects");
  });
});

// ---------------------------------------------------------------------------
// Execution against a synced (synthetic) JobTread cache
// ---------------------------------------------------------------------------

describe("first use", () => {
  beforeEach(async () => {
    await setupAgentTestEnv();
    invalidateFieldCatalog();
  });
  afterEach(() => uninstallFakePave());

  it("syncs JobTread automatically the first time a report runs, so nobody sees an empty cache", async () => {
    const fake = installFakePave();
    const result = await executeReport({
      spec: ACTIVE_PROJECTS_TEMPLATE,
      access: await getReportsAccess(employee),
    });
    expect((result.widgets.active_count as KpiResult).value).toBe(4);
    expect(result.freshness.syncedAt).not.toBeNull();
    const calls = fake.calls;
    await executeReport({
      spec: ACTIVE_PROJECTS_TEMPLATE,
      access: await getReportsAccess(employee),
    });
    expect(fake.calls).toBe(calls); // no second sync
  });

  it("explains that JobTread isn't connected instead of syncing", async () => {
    const result = await executeReport({
      spec: ACTIVE_PROJECTS_TEMPLATE,
      access: await getReportsAccess(employee),
    });
    expect(result.issues.join(" ")).toMatch(/hasn't been synced/);
  });
});

describe("report execution", () => {
  beforeEach(async () => {
    await setupAgentTestEnv();
    clearJobDetailCache();
    invalidateFieldCatalog();
    installFakePave();
    expect((await runFullSync("test")).status).toBe("succeeded");
    invalidateFieldCatalog();
  });
  afterEach(() => uninstallFakePave());

  const run = async (spec: ReportSpec, who = employee, state = {}) =>
    executeReport({ spec, access: await getReportsAccess(who), state });

  it("counts active projects by Phase with filters and search", async () => {
    const result = await run(ACTIVE_PROJECTS_TEMPLATE);
    expect((result.widgets.active_count as KpiResult).value).toBe(4);
    expect((result.widgets.in_design as KpiResult).value).toBe(2);
    expect((result.widgets.in_permitting as KpiResult).value).toBe(2);
    const sqft = result.widgets.avg_sqft as KpiResult;
    expect(sqft.value).toBeCloseTo((498 + 698 + 998) / 3, 6);
    expect(sqft.provenance).toMatchObject({ rows: 4, withValue: 3 });
    expect(sqft.provenance?.calculation).toMatch(/1 blank, excluded/);
    const byPm = result.widgets.by_pm as ChartResult;
    expect(Object.fromEntries(byPm.points.map((p) => [p.key, p.value]))).toEqual({
      Maxx: 2,
      Connor: 1,
      "(blank)": 1,
    });
    expect(result.freshness.syncedAt).not.toBeNull();

    const filtered = await run(ACTIVE_PROJECTS_TEMPLATE, employee, { pm: ["Maxx"] });
    expect((filtered.widgets.active_count as KpiResult).value).toBe(2);
    const searched = await run(ACTIVE_PROJECTS_TEMPLATE, employee, { search: "Project 3" });
    expect((searched.widgets.projects as TableResult).rows.map((r) => r.id)).toEqual([JOBS[2]!.id]);
  });

  it("hides financial figures from people without financial access and shows them to admins", async () => {
    const asEmployee = await run(PRODUCT_LIBRARY_TEMPLATE);
    expect((asEmployee.widgets.model_count as KpiResult).value).toBe(3); // Selections Library isn't a model
    expect((asEmployee.widgets.with_budget as KpiResult).value).toBe(2);
    expect(asEmployee.widgets.avg_price!.status).toBe("restricted");
    expect(asEmployee.widgets.avg_price).not.toHaveProperty("value", expect.any(Number));
    const table = asEmployee.widgets.library as TableResult;
    expect(table.columns.map((c) => c.key)).toEqual([
      "model.name",
      "model.series",
      "model.code",
      "model.budgetStatus",
      "model.itemCount",
    ]);
    expect(JSON.stringify(table.rows)).not.toContain("368620");
    expect(table.message).toMatch(/4 column\(s\) hidden/);

    const asAdmin = await run(PRODUCT_LIBRARY_TEMPLATE, admin);
    expect((asAdmin.widgets.avg_price as KpiResult).value).toBeCloseTo((368620.75 + 150000) / 2, 6);
    const margin = (asAdmin.widgets.avg_margin as KpiResult).value!;
    expect(margin).toBeCloseTo((28.6 + 33.3) / 2, 1);
    const pending = (asAdmin.widgets.library as TableResult).rows.find(
      (r) => r.id === "cgModel998",
    );
    expect(pending).toMatchObject({ tone: "amber" });
    expect(pending?.cells["model.basePrice"]).toBeNull(); // never invent a price for a pending budget
  });

  it("grants customer and financial categories only through Dexter's access policies", async () => {
    const dexter = (await getResolvedAgent("dexter"))!;
    const spec = reportSpecSchema.parse({
      title: "Customer",
      datasets: [{ id: "jobs", source: "jobs" }],
      widgets: [
        {
          id: "t",
          type: "table",
          dataset: "jobs",
          columns: [
            { field: "job.name" },
            { field: `cf:${F.spouse}` },
            { field: `cf:${F.strategy}` },
            { field: "job.projectedPrice" },
          ],
        },
      ],
    });
    const before = (await run(spec)).widgets.t as TableResult;
    expect(before.columns.map((c) => c.key)).toEqual(["job.name"]);
    await addAccessPolicy({
      agentId: dexter.row.id,
      principalType: "user",
      principalValue: EMPLOYEE_ID,
      accessLevel: "customer_data",
      actor: { userId: ADMIN_ID, label: "Avery" },
    });
    await addAccessPolicy({
      agentId: dexter.row.id,
      principalType: "user",
      principalValue: EMPLOYEE_ID,
      accessLevel: "financial_data",
      actor: { userId: ADMIN_ID, label: "Avery" },
    });
    const after = (await run(spec)).widgets.t as TableResult;
    // Internal sales notes still need "Manage agent".
    expect(after.columns.map((c) => c.key)).toEqual([
      "job.name",
      `cf:${F.spouse}`,
      "job.projectedPrice",
    ]);
  });

  it("counts multi-value fields under each value and says so", async () => {
    const spec = reportSpecSchema.parse({
      title: "Electrical",
      datasets: [{ id: "jobs", source: "jobs" }],
      widgets: [
        {
          id: "c",
          type: "chart",
          dataset: "jobs",
          chart: "bar",
          groupBy: "sem:electrical",
          sort: "label",
        },
      ],
    });
    const chart = (await run(spec)).widgets.c as ChartResult;
    expect(Object.fromEntries(chart.points.map((p) => [p.key, p.value]))).toEqual({
      Overhead: 2,
      Solar: 1,
      Underground: 1,
      "(blank)": 3,
    });
    expect(chart.provenance?.notes.join(" ")).toMatch(/counted under each/);
  });

  it("explains unmapped or missing fields instead of inventing values", async () => {
    const spec = reportSpecSchema.parse({
      title: "Missing",
      datasets: [{ id: "jobs", source: "jobs" }],
      widgets: [
        {
          id: "hours",
          type: "kpi",
          dataset: "jobs",
          metric: { op: "sum", field: "sem:design_hours" },
        },
        {
          id: "ghost",
          type: "kpi",
          dataset: "jobs",
          metric: { op: "avg", field: "cf:doesNotExist1" },
        },
      ],
    });
    const result = await run(spec);
    expect(result.widgets.hours).toMatchObject({ status: "error" });
    expect(result.widgets.hours!.message).toMatch(/no time entries/i);
    expect(result.widgets.ghost!.message).toMatch(/doesn't exist/);
    expect(result.widgets.ghost).not.toHaveProperty("value", expect.any(Number));
  });

  it("keeps a table when one column isn't mapped, and says which column was skipped", async () => {
    // The synthetic org has no "Permit Status" field, so sem:permit_status is unmapped.
    const table = (await run(ACTIVE_PROJECTS_TEMPLATE)).widgets.projects as TableResult;
    expect(table.status).toBe("ok");
    expect(table.rows).toHaveLength(4);
    expect(table.columns.some((c) => c.label === "Permit Status")).toBe(false);
    expect(table.message).toMatch(/Column skipped: "Permit Status" isn't mapped/);
  });

  it("builds the Design Handoff view from the cache plus live JobTread detail", async () => {
    const result = await run(DESIGN_HANDOFF_TEMPLATE, employee, { project: JOBS[0]!.id });
    const specs = result.widgets.model_specs as DetailResult;
    expect(specs.jobId).toBe(JOBS[0]!.id);
    expect(specs.items.find((i) => i.key === "sem:model" || i.label === "Model")?.value).toBe(
      "i 498",
    );
    expect(specs.items.find((i) => i.label === "Vault Height")?.missing).toBe(true);
    const schedule = result.widgets.schedule as MilestonesResult;
    expect(schedule.milestones.map((m) => m.name)).toEqual(["Design", "Permitting"]);
    const checklists = result.widgets.checklists as MilestonesResult;
    expect(checklists.milestones.map((m) => m.name)).toEqual(["Design Checklist"]);
    // Only active projects are offered in the picker.
    const picker = result.controls.project;
    const options = picker?.kind === "job_picker" ? picker.options.map((o) => o.value) : [];
    expect(options.sort()).toEqual(
      JOBS.slice(0, 4)
        .map((j) => j.id)
        .sort(),
    );
  });

  it("drills into a chart segment with only authorized columns", async () => {
    const d = await drilldown({
      spec: ACTIVE_PROJECTS_TEMPLATE,
      access: await getReportsAccess(employee),
      widgetId: "by_phase",
      groupKey: "BR-Design",
    });
    expect(d.total).toBe(2);
    expect(d.rows.map((r) => r.cells["job.name"])).toEqual(["Test Project 1", "Test Project 2"]);
    expect(d.columns.some((c) => c.key.startsWith("job.projected"))).toBe(false);
    expect(d.rows[0]!.jobtreadUrl).toBe(`https://app.jobtread.com/jobs/${JOBS[0]!.id}`);
  });
});
