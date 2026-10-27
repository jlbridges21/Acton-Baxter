/**
 * Related job fields on cost items: budget line → job (by JobTread id) → Phase and other
 * approved job fields. Filtering, grouping, combined controls, totals, missing values, the
 * Project Allowance Tracker (v3 spec as saved), Dexter, diagnostics, and permissions.
 * Synthetic fixture only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDb, eq } from "@/lib/agents/store";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { COST_ITEMS, JOBS } from "@/lib/jobtread/fixture";
import { processEntitySyncJob, requestEntitySync } from "@/lib/jobtread/sync-manager";
import { runFullSync } from "@/lib/jobtread/sync";
import { listMemoryJobsForTests, resetMemoryJobsForTests } from "@/lib/jobs/queue";
import { getReportsAccess } from "@/lib/reports/access";
import type { Row } from "@/lib/reports/compute";
import { invalidateDataHealthCache } from "@/lib/reports/data-health";
import {
  checkSpecFields,
  executeReport,
  invalidateCatalogContext,
  loadSourceRows,
} from "@/lib/reports/engine";
import {
  fieldOnSource,
  getFieldCatalog,
  invalidateFieldCatalog,
  resolveField,
} from "@/lib/reports/fields";
import { getRelatedFieldsOverview, setRelatedField } from "@/lib/reports/related-fields";
import { attachRelated, RELATIONSHIPS } from "@/lib/reports/relationships";
import { createReport, getReport, listRevisions, saveReportVersion } from "@/lib/reports/repo";
import { describeSourcesForModel } from "@/lib/reports/sources";
import { collectFieldRefs, reportSpecSchema, type ReportSpec } from "@/lib/reports/spec";
import type { ChartResult, KpiResult, TableResult } from "@/lib/reports/result-types";
import trackerV3 from "../fixtures/allowance-tracker-v3.json";
import { ADMIN_ID, EMPLOYEE_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

vi.setConfig({ testTimeout: 30_000 });

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const employee = requester(EMPLOYEE_ID, "user", "Eli Employee");
const toolCtx = (r: Requester) => ({
  task: { id: "00000000-0000-4000-8000-0000000000f2", allowed_context: {} } as never,
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
}

/** Fixture budget lines: items 40–229 belong to job (i % 3) + 1. */
const JOB_ITEMS = COST_ITEMS.map((c, i) => ({ ...c, i })).filter((c) => c.i >= 40);
const jobOf = (i: number) => (i % 3) + 1;
/** Fixture phases: jobs 1–2 are BR-Design, job 3 is BR-Permitting. */
const PHASE: Record<number, string> = { 1: "BR-Design", 2: "BR-Design", 3: "BR-Permitting" };
const sum = (items: typeof JOB_ITEMS, key: "cost" | "price") =>
  Math.round(items.reduce((t, c) => t + (c[key] ?? 0), 0) * 100) / 100;

let phaseKey: string;

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
  const r = resolveField(await getFieldCatalog(), "sem:phase");
  if (!r.ok) throw new Error(r.reason);
  phaseKey = r.key;
});
afterEach(() => uninstallFakePave());

/** The tracker's matching rule is "name contains allowance"; give some budget lines that name. */
async function nameAllowances() {
  const ids = JOB_ITEMS.filter((c) => c.i % 4 === 0).map((c) => c.id);
  for (const id of ids)
    await agentDb().update("jt_cost_items", [eq("id", id)], { name: `Allowance – ${id}` });
  invalidate();
  return JOB_ITEMS.filter((c) => c.i % 4 === 0);
}

const trackerSpec = () => reportSpecSchema.parse(trackerV3);
/** The v4 change: a Phase select beside the Job select, and a Phase column. */
function addPhaseFilter(spec: ReportSpec): ReportSpec {
  const next = structuredClone(spec);
  const at = next.controls.findIndex((c) => c.id === "job_select");
  next.controls.splice(at + 1, 0, {
    id: "phase_select",
    kind: "select",
    field: "sem:phase",
    label: "Phase",
    default: [],
    datasets: ["allowance_lines"],
    multiple: true,
  });
  const table = next.widgets.find((w) => w.id === "table_lines");
  if (table?.type === "table") {
    const n = table.columns.findIndex((c) => c.field === "item.jobNumber");
    table.columns.splice(n + 1, 0, {
      field: "sem:phase",
      label: "Phase",
      format: "auto",
      wrap: false,
      aggregate: "auto",
    });
  }
  return reportSpecSchema.parse(next);
}

describe("cost item → job relationship", () => {
  it("resolves each budget line's job by id and reads Phase from that job", async () => {
    const { rows } = await loadSourceRows("cost_items");
    expect(rows).toHaveLength(COST_ITEMS.length); // never adds or drops lines
    for (const c of JOB_ITEMS.slice(0, 12)) {
      const row = rows.find((r) => r.id === c.id)!;
      expect(row["item.jobId"]).toBe(`job0000000${jobOf(c.i)}`);
      expect(row[phaseKey]).toEqual([PHASE[jobOf(c.i)]]);
      expect(row["job.number"]).toBe(JOBS[jobOf(c.i) - 1]!.number);
    }
    // Catalog lines have no job, so job fields are blank — not a phase.
    const catalogLine = rows.find((r) => r.id === "ci000000")!;
    expect(catalogLine["item.jobId"]).toBeNull();
    expect(catalogLine[phaseKey] ?? null).toBeNull();
  });

  it("attaches related values without changing row count, order, or unmatched rows", () => {
    const rows: Row[] = [
      { id: "a", "item.jobId": "j1", "item.cost": 10 },
      { id: "b", "item.jobId": "missing", "item.cost": 5 },
      { id: "c", "item.jobId": null, "item.cost": 1 },
    ];
    const out = attachRelated(
      rows,
      RELATIONSHIPS["cost_items.job"],
      new Map([["j1", { id: "j1", "cf:p": ["BR-Design"] }]]),
      ["cf:p"],
    );
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out[0]!["cf:p"]).toEqual(["BR-Design"]);
    expect(out[1]).toBe(rows[1]); // unmatched job: untouched, Phase stays blank
    expect(out[2]).toBe(rows[2]);
  });

  it("exposes Phase (and other approved job fields) as cost-item report fields", async () => {
    const catalog = await getFieldCatalog();
    const phase = catalog.bySource.cost_items.find((f) => f.key === phaseKey)!;
    expect(phase).toMatchObject({ via: "cost_items.job", type: "list" });
    expect(phase.label).toMatch(/Phase · Job/);
    const keys = [...catalog.related.cost_items.values()].map((f) => f.ref);
    expect(keys).toEqual(
      expect.arrayContaining(["job.number", "job.customer", "sem:phase", "sem:project_manager"]),
    );
    // Not every job field: unapproved ones stay off cost items.
    expect(keys).not.toContain("job.projectedPrice");
    expect(fieldOnSource(catalog, "cost_items", phase)).toEqual({
      ok: true,
      via: "cost_items.job",
    });
  });
});

describe("filtering, grouping, and totals", () => {
  const spec = (state?: Record<string, string[]>) => ({
    spec: reportSpecSchema.parse({
      title: "Budget lines by phase",
      datasets: [
        {
          id: "lines",
          source: "cost_items",
          filters: [{ field: "item.context", op: "eq", value: "Job budget" }],
        },
      ],
      controls: [
        { id: "job", kind: "select", field: "item.job", label: "Job", datasets: ["lines"] },
        { id: "phase", kind: "select", field: "sem:phase", label: "Phase", datasets: ["lines"] },
      ],
      widgets: [
        { id: "count", type: "kpi", dataset: "lines", metric: { op: "count" } },
        { id: "cost", type: "kpi", dataset: "lines", metric: { op: "sum", field: "item.cost" } },
        {
          id: "by_phase",
          type: "chart",
          chart: "bar",
          dataset: "lines",
          groupBy: "sem:phase",
          metric: { op: "sum", field: "item.cost" },
        },
        {
          id: "list",
          type: "table",
          dataset: "lines",
          columns: [{ field: "item.name" }, { field: "sem:phase" }, { field: "item.cost" }],
        },
      ],
    }),
    state,
  });

  it("keeps totals unchanged when no Phase is selected", async () => {
    const access = await getReportsAccess(admin);
    const result = await executeReport({ ...spec(), access });
    expect((result.widgets.count as KpiResult).value).toBe(JOB_ITEMS.length);
    expect((result.widgets.cost as KpiResult).value).toBe(sum(JOB_ITEMS, "cost"));
  });

  it("filters by Phase and lists phases dynamically from the data", async () => {
    const access = await getReportsAccess(admin);
    const result = await executeReport({ ...spec({ phase: ["BR-Permitting"] }), access });
    const expected = JOB_ITEMS.filter((c) => jobOf(c.i) === 3);
    expect((result.widgets.count as KpiResult).value).toBe(expected.length);
    expect((result.widgets.cost as KpiResult).value).toBe(sum(expected, "cost"));
    const phase = result.controls.phase!;
    expect(phase.kind === "select" && phase.options.map((o) => o.value)).toEqual([
      "BR-Design",
      "BR-Permitting",
    ]);
  });

  it("groups by Phase without double counting", async () => {
    const access = await getReportsAccess(admin);
    const chart = (await executeReport({ ...spec(), access })).widgets.by_phase as ChartResult;
    const byKey = Object.fromEntries(chart.points.map((p) => [p.key, p.value]));
    expect(byKey).toEqual({
      "BR-Design": sum(
        JOB_ITEMS.filter((c) => jobOf(c.i) !== 3),
        "cost",
      ),
      "BR-Permitting": sum(
        JOB_ITEMS.filter((c) => jobOf(c.i) === 3),
        "cost",
      ),
    });
    expect(chart.points.reduce((t, p) => t + (p.value ?? 0), 0)).toBeCloseTo(
      sum(JOB_ITEMS, "cost"),
    );
  });

  it("combines Job and Phase filters (and shows an empty state when nothing matches)", async () => {
    const access = await getReportsAccess(admin);
    const both = await executeReport({
      ...spec({ job: ["Test Project 1", "Test Project 3"], phase: ["BR-Permitting"] }),
      access,
    });
    expect((both.widgets.count as KpiResult).value).toBe(
      JOB_ITEMS.filter((c) => jobOf(c.i) === 3).length,
    );
    const none = await executeReport({
      ...spec({ job: ["Test Project 1"], phase: ["BR-Permitting"] }),
      access,
    });
    const table = none.widgets.list as TableResult;
    expect(table.totalRows).toBe(0);
    expect(table.status).toBe("empty");
  });

  it("treats a job without Phase as blank, never as a phase", async () => {
    const [job3] = await agentDb().select<{ id: string; job_fields: Record<string, string[]> }>(
      "jt_jobs",
      { filters: [eq("id", "job00000003")] },
    );
    const fields = { ...job3!.job_fields };
    delete fields[phaseKey.slice(3)];
    await agentDb().update("jt_jobs", [eq("id", "job00000003")], { job_fields: fields });
    invalidate();
    const access = await getReportsAccess(admin);
    const all = await executeReport({ ...spec(), access });
    expect((all.widgets.count as KpiResult).value).toBe(JOB_ITEMS.length); // still counted
    const phase = all.controls.phase!;
    expect(phase.kind === "select" && phase.options.map((o) => o.value)).toEqual(["BR-Design"]);
    const permitting = await executeReport({ ...spec({ phase: ["BR-Permitting"] }), access });
    expect((permitting.widgets.count as KpiResult).value).toBe(0);
  });
});

describe("Project Allowance Tracker", () => {
  it("adds a Phase filter as a new version, preserving widgets, controls, and history", async () => {
    const allowances = await nameAllowances();
    const v3 = trackerSpec();
    const report = await createReport({
      spec: v3,
      ownerId: ADMIN_ID,
      authorKind: "dexter",
      summary: "Created",
    });
    const access = await getReportsAccess(admin);
    const before = await executeReport({ spec: v3, access });
    expect((before.widgets.kpi_lines as KpiResult).value).toBe(allowances.length);

    const { report: v2 } = await saveReportVersion({
      report,
      spec: addPhaseFilter(v3),
      authorId: ADMIN_ID,
      authorKind: "user",
      summary: "Added a Phase filter",
      expectedVersion: report.version,
    });
    expect(v2.version).toBe(report.version + 1);
    expect((await listRevisions(report.id)).map((r) => r.version)).toEqual([2, 1]);
    const saved = (await getReport(report.id))!.spec;
    expect(saved.widgets.map((w) => w.id)).toEqual(v3.widgets.map((w) => w.id));
    expect(saved.controls.map((c) => c.id)).toEqual(["job_select", "phase_select", "item_search"]);
    expect(saved.datasets).toEqual(v3.datasets);

    // No Phase selected: identical numbers to the version before.
    const after = await executeReport({ spec: saved, access });
    for (const id of ["kpi_lines", "kpi_jobs", "kpi_cost", "kpi_price"])
      expect((after.widgets[id] as KpiResult).value).toBe((before.widgets[id] as KpiResult).value);
    expect((after.widgets.table_lines as TableResult).columns.map((c) => c.label)).toContain(
      "Phase",
    );

    // Phase + Job + item search, consistently across KPIs, chart, and table.
    const permitting = allowances.filter((c) => jobOf(c.i) === 3);
    const filtered = await executeReport({
      spec: saved,
      access,
      state: { phase_select: ["BR-Permitting"] },
    });
    expect((filtered.widgets.kpi_lines as KpiResult).value).toBe(permitting.length);
    expect((filtered.widgets.kpi_jobs as KpiResult).value).toBe(1);
    expect((filtered.widgets.kpi_cost as KpiResult).value).toBe(sum(permitting, "cost"));
    expect((filtered.widgets.table_lines as TableResult).totalRows).toBe(permitting.length);
    expect((filtered.widgets.chart_job_price as ChartResult).points.map((p) => p.key)).toEqual([
      "Test Project 3",
    ]);
    const combined = await executeReport({
      spec: saved,
      access,
      state: {
        phase_select: ["BR-Permitting"],
        job_select: ["Test Project 1"],
        item_search: "allowance",
      },
    });
    expect((combined.widgets.kpi_lines as KpiResult).value).toBe(0);
    expect((combined.widgets.table_lines as TableResult).status).toBe("empty");
  });

  it("lets Dexter add the Phase filter to the existing tracker", async () => {
    await nameAllowances();
    const report = await createReport({
      spec: trackerSpec(),
      ownerId: ADMIN_ID,
      authorKind: "dexter",
      summary: "Created",
    });
    const res = await run("reports_update", {
      reportId: report.id,
      expectedVersion: report.version,
      summary: "Only show allowances for jobs in BR-Permitting",
      operations: [
        {
          op: "add_control",
          control: {
            id: "phase_select",
            kind: "select",
            field: "sem:phase",
            label: "Phase",
            datasets: ["allowance_lines"],
            multiple: true,
            default: ["BR-Permitting"],
          },
        },
      ],
    });
    expect(res).toMatchObject({ saved: true });
    const saved = (await getReport(report.id))!;
    expect(saved.version).toBe(report.version + 1);
    const result = await executeReport({
      spec: saved.spec,
      access: await getReportsAccess(admin),
    });
    expect((result.widgets.kpi_jobs as KpiResult).value).toBe(1);
  });
});

describe("Dexter", () => {
  it("discovers related job fields from source metadata", async () => {
    expect(describeSourcesForModel()).toMatch(/Related job fields \(via item\.jobId/);
    const fields = await run("reports_list_fields", { source: "cost_items", search: "phase" });
    expect(fields.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: phaseKey, via: "cost_items.job" })]),
    );
    expect(fields.businessNames).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "sem:phase", available: true })]),
    );
    const sources = await run("reports_sources", { source: "cost_items" });
    const [src] = sources.sources as Array<{ relatedFields: Array<{ ref: string }> }>;
    expect(src!.relatedFields.map((f) => f.ref)).toContain("sem:phase");
  });

  it("builds 'total allowance cost by project phase' from cost items", async () => {
    const res = await run("reports_create", {
      spec: {
        title: "Allowance cost by phase",
        datasets: [
          {
            id: "lines",
            source: "cost_items",
            filters: [
              { field: "item.context", op: "eq", value: "Job budget" },
              { field: "sem:phase", op: "in", value: ["BR-Permitting"] },
            ],
          },
        ],
        widgets: [
          {
            id: "by_phase",
            type: "chart",
            chart: "bar",
            dataset: "lines",
            groupBy: "sem:phase",
            metric: { op: "sum", field: "item.cost" },
          },
        ],
      },
      summary: "Allowance cost by phase",
    });
    expect(res).toMatchObject({ saved: true });
  });

  it("explains related-but-unapproved and unrelated fields instead of calling them missing", async () => {
    const access = await getReportsAccess(admin);
    const unapproved = reportSpecSchema.parse({
      title: "Sqft",
      datasets: [{ id: "lines", source: "cost_items" }],
      widgets: [
        {
          id: "t",
          type: "table",
          dataset: "lines",
          columns: [{ field: "item.name" }, { field: "sem:total_sqft" }],
        },
      ],
    });
    const a = await checkSpecFields(unapproved, access, collectFieldRefs(unapproved));
    expect(a.missing.join(" ")).toMatch(/isn't approved for cost_items.*administrator can approve/);

    const unrelated = reportSpecSchema.parse({
      title: "Models",
      datasets: [{ id: "m", source: "catalog_models" }],
      widgets: [{ id: "t", type: "table", dataset: "m", columns: [{ field: "sem:phase" }] }],
    });
    const b = await checkSpecFields(unrelated, access, collectFieldRefs(unrelated));
    expect(b.missing.join(" ")).toMatch(/aren.t joined to jobs yet/);
  });
});

describe("admin approvals and permissions", () => {
  it("lets admins approve and remove job fields, never non-job fields", async () => {
    await setRelatedField(
      { relationship: "cost_items.job", ref: "sem:total_sqft", enabled: true },
      ADMIN_ID,
    );
    let catalog = await getFieldCatalog();
    const sqft = resolveField(catalog, "sem:total_sqft");
    expect(sqft.ok && catalog.related.cost_items.get(sqft.key)?.approvedBy).toBe("admin");

    await setRelatedField(
      { relationship: "cost_items.job", ref: "sem:phase", enabled: false },
      ADMIN_ID,
    );
    catalog = await getFieldCatalog();
    expect(catalog.related.cost_items.has(phaseKey)).toBe(false);

    await expect(
      setRelatedField(
        { relationship: "cost_items.job", ref: "item.cost", enabled: true },
        ADMIN_ID,
      ),
    ).rejects.toThrow(/isn't a jobs field/);
    await expect(
      setRelatedField({ relationship: "cost_items.job", ref: "sem:nope", enabled: true }, ADMIN_ID),
    ).rejects.toThrow(/business field/);

    const [overview] = await getRelatedFieldsOverview();
    expect(overview).toMatchObject({
      id: "cost_items.job",
      linkedRows: JOB_ITEMS.length,
      unmatchedRows: 0,
    });
    expect(overview!.eligible.map((f) => f.ref)).toContain("sem:phase");
  });

  it("enforces the related field's own access category server-side", async () => {
    await setRelatedField(
      { relationship: "cost_items.job", ref: "job.projectedPrice", enabled: true },
      ADMIN_ID,
    );
    const spec = reportSpecSchema.parse({
      title: "Projected price on lines",
      datasets: [{ id: "lines", source: "cost_items" }],
      widgets: [
        {
          id: "t",
          type: "table",
          dataset: "lines",
          columns: [{ field: "item.name" }, { field: "job.projectedPrice" }],
        },
      ],
    });
    const empAccess = await getReportsAccess(employee);
    const table = (await executeReport({ spec, access: empAccess })).widgets.t as TableResult;
    expect(table.columns.map((c) => c.key)).not.toContain("job.projectedPrice");
    const fields = await run("reports_list_fields", { source: "cost_items" }, employee);
    expect((fields.fields as Array<{ key: string }>).map((f) => f.key)).not.toContain(
      "job.projectedPrice",
    );
    const adminTable = (await executeReport({ spec, access: await getReportsAccess(admin) }))
      .widgets.t as TableResult;
    expect(adminTable.columns.map((c) => c.key)).toContain("job.projectedPrice");
  });
});
