/**
 * Cost items as a report source: registry discovery, hierarchy relationships, exterior
 * options, honest pricing, summaries without double counting, regions, model scope, Dexter
 * tools, versioning, live status, and financial permissions. Synthetic fixture only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDb } from "@/lib/agents/store";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { COST_ITEMS } from "@/lib/jobtread/fixture";
import { processEntitySyncJob, requestEntitySync } from "@/lib/jobtread/sync-manager";
import { runFullSync } from "@/lib/jobtread/sync";
import { listMemoryJobsForTests, resetMemoryJobsForTests } from "@/lib/jobs/queue";
import { getReportsAccess } from "@/lib/reports/access";
import { capabilityMatrix } from "@/lib/reports/capabilities";
import { filterRows, type Row } from "@/lib/reports/compute";
import { nameVariants, optionPriceAnalysis } from "@/lib/reports/cost-item-admin";
import { costItemRow, groupChain, isOptionGroup } from "@/lib/reports/cost-items";
import { invalidateDataHealthCache, staticDataClaims } from "@/lib/reports/data-health";
import {
  executeReport,
  invalidateCatalogContext,
  loadSourceRows,
  summarizeRows,
} from "@/lib/reports/engine";
import { getFieldCatalog, invalidateFieldCatalog } from "@/lib/reports/fields";
import { saveValueMapping } from "@/lib/reports/mappings";
import { createReport, getReport, listRevisions } from "@/lib/reports/repo";
import { describeSourcesForModel, SOURCE_REGISTRY } from "@/lib/reports/sources";
import { reportSpecSchema, SOURCES } from "@/lib/reports/spec";
import { EXTERIOR_OPTIONS_TEMPLATE, PRODUCT_LIBRARY_TEMPLATE } from "@/lib/reports/templates";
import type { TableResult } from "@/lib/reports/result-types";
import { ADMIN_ID, EMPLOYEE_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

vi.setConfig({ testTimeout: 30_000 });

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const employee = requester(EMPLOYEE_ID, "user", "Eli Employee");
const toolCtx = (r: Requester, taskId = "00000000-0000-4000-8000-0000000000f1") => ({
  task: { id: taskId, allowed_context: {} } as never,
  agent: { row: { id: "00000000-0000-4000-8000-00000000d0d0" } } as never,
  requester: r,
  access: new Set<never>(),
});
const run = async (key: string, args: unknown, who = admin, task?: string) =>
  (await getTool(key)!.execute(toolCtx(who, task), args)).data as Record<string, unknown>;

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

const itemRows = async () => (await loadSourceRows("cost_items")).rows;
const byId = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;
const fixtureSum = (ids: number[], key: "cost" | "price") =>
  ids.reduce((t, i) => t + (COST_ITEMS[i]![key] ?? 0), 0);

beforeEach(async () => {
  await setupAgentTestEnv();
  resetMemoryJobsForTests();
  clearJobDetailCache();
  invalidateFieldCatalog();
  invalidateCatalogContext();
  invalidateDataHealthCache();
  installFakePave();
  await runFullSync("test");
  await requestEntitySync({ entities: ["cost_groups", "cost_items"], triggeredBy: "test" });
  await drainJobs();
  invalidateCatalogContext();
  invalidateFieldCatalog();
  invalidateDataHealthCache();
});
afterEach(() => uninstallFakePave());

describe("source registry and discovery", () => {
  it("registers cost_items everywhere sources are listed", async () => {
    expect(SOURCES).toContain("cost_items");
    for (const s of SOURCES) expect(SOURCE_REGISTRY[s].id).toBe(s);
    expect(describeSourcesForModel()).toMatch(/"cost_items" \(item\.\* fields\)/);
    const catalog = await getFieldCatalog();
    expect(catalog.bySource.cost_items.map((f) => f.key)).toEqual(
      expect.arrayContaining(["item.model", "item.option", "item.unitPrice", "item.price"]),
    );
  });

  it("lets Dexter discover the source, its relationships, records, and freshness", async () => {
    const res = await run("reports_sources", { source: "cost_items" });
    const [src] = res.sources as Array<Record<string, unknown>>;
    expect(src).toMatchObject({ id: "cost_items", records: COST_ITEMS.length });
    expect(src!.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: "catalog_models", via: "item.modelId" }),
      ]),
    );
    expect(src!.freshness).toEqual(
      expect.arrayContaining([expect.objectContaining({ dataset: "cost_items", level: "fresh" })]),
    );
    // Without financial access, cost and price fields are counted as restricted, not listed.
    const emp = await run("reports_sources", { source: "cost_items" }, employee);
    const e = (
      emp.sources as Array<{ fields: Array<{ key: string }>; restrictedFields: number }>
    )[0]!;
    expect(e.fields.map((f) => f.key)).not.toContain("item.price");
    expect(e.restrictedFields).toBeGreaterThan(0);
  });
});

describe("relationships", () => {
  it("resolves each item to its model, section, option group, and option by id", async () => {
    const rows = await itemRows();
    expect(rows).toHaveLength(COST_ITEMS.length); // one row per item, no fan-out
    expect(byId(rows, "ci000000")).toMatchObject({
      "item.context": "Product Library model",
      "item.model": "i 398",
      "item.modelId": "cgModel398",
      "item.section": "Exterior Package Options",
      "item.optionGroup": "Exterior Package Options",
      "item.option": "Hayward Modern",
      "item.groupPath": "i 398 › Exterior Package Options › Hayward Modern",
      "item.unit": "Each",
      "item.sourceItemId": "org0",
    });
    expect(byId(rows, "ci000006")).toMatchObject({
      "item.section": "Windows",
      "item.option": null,
    });
    expect(byId(rows, "ci000100")).toMatchObject({
      "item.context": "Job budget",
      "item.model": null,
      "item.job": "Test Project 2",
    });
  });

  it("filters by budget group and keeps sums equal to the source records", async () => {
    const rows = await itemRows();
    const windows = filterRows(rows, [{ field: "item.section", op: "eq", value: "Windows" }]);
    expect(windows.map((r) => r.id)).toEqual(["ci000006", "ci000007", "ci000008", "ci000009"]);
    const total = rows.reduce((t, r) => t + Number(r["item.cost"] ?? 0), 0);
    expect(total).toBe(COST_ITEMS.reduce((t, i) => t + i.cost, 0));
  });

  it("is safe with cycles and unknown groups", () => {
    const groups = new Map([
      ["a", { id: "a", name: "A", parent_id: "b", job_id: null }],
      ["b", { id: "b", name: "B", parent_id: "a", job_id: null }],
    ]);
    expect(groupChain(groups, "a")).toHaveLength(2);
    const row = costItemRow(
      {
        id: "x",
        scope: "catalog",
        job_id: null,
        cost_group_id: "zzz",
        cost_group_name: "Unsynced",
        name: "X",
        description: null,
        quantity: 1,
        unit_cost: 1,
        unit_price: null,
        cost: 1,
        price: null,
        cost_code_name: null,
        cost_type_name: null,
        synced_at: "",
      },
      { groups, models: new Map(), jobs: new Map(), optionRules: [] },
    );
    expect(row).toMatchObject({ "item.context": "Group not synced", "item.price": null });
    expect(row["item.priceStatus"]).toBe("No selling price in JobTread");
  });
});

describe("exterior options and pricing", () => {
  it("finds option groups per model", async () => {
    const models = (await loadSourceRows("catalog_models")).rows;
    const m398 = models.find((m) => m.id === "cgModel398")!;
    expect(m398["model.optionGroups"]).toEqual(["Exterior Package Options"]);
    expect(m398["model.optionCount"]).toBe(2);
    expect(models.find((m) => m.id === "cgModelAge")!["model.optionCount"]).toBe(1);
    expect(isOptionGroup("Exterior Package Options", [])).toBe(true);
    expect(isOptionGroup("Windows", [])).toBe(false);
  });

  it("computes model-specific option totals and never fills missing prices", async () => {
    const access = await getReportsAccess(admin);
    const result = await executeReport({ spec: EXTERIOR_OPTIONS_TEMPLATE, access });
    const totals = result.widgets.option_totals as TableResult;
    expect(totals.status).toBe("ok");
    const row = (model: string, option: string) =>
      totals.rows.find((r) => r.cells["item.model"] === model && r.cells["item.option"] === option)!
        .cells;
    // i 398 × Hayward Modern = fixture lines 0–3; line 3 has no price in JobTread.
    expect(row("i 398", "Hayward Modern")).toMatchObject({
      "item.cost": fixtureSum([0, 1, 2, 3], "cost"),
      "item.price": null,
      __lines: 4,
    });
    expect(row("i 398", "Half Moon Bay Coastal")).toMatchObject({
      "item.cost": fixtureSum([4, 5], "cost"),
      "item.price": Math.round(fixtureSum([4, 5], "price") * 100) / 100,
    });
    expect(totals.message).toMatch(/totals are blank/);
    // Charts sum the lines that have a price and say how many don't.
    const chart = result.widgets.price_by_option as { provenance: { notes: string[] } };
    expect(chart.provenance.notes.join(" ")).toMatch(/1 of \d+ records have no Extended Price/);
    expect((result.widgets.unpriced as { value: number }).value).toBe(1);
    expect((result.widgets.models_with_options as { value: number }).value).toBe(2);
    // Prices differ by model → reported as varying.
    const analysis = optionPriceAnalysis(await itemRows());
    expect(analysis.find((o) => o.option === "Hayward Modern")).toMatchObject({
      models: 2,
      modelsMissingPrice: 1,
    });
    expect(nameVariants(["Saratoga Countryside", "Saratoga Country Side", "Hayward"])).toEqual([
      ["Saratoga Country Side", "Saratoga Countryside"],
    ]);
  });

  it("summarizes deterministically and never sums percentages", () => {
    const fields = [
      { key: "g", def: { type: "text" as const, label: "G" } },
      { key: "c", def: { type: "currency" as const, label: "C" } },
      { key: "p", def: { type: "percent" as const, label: "P" } },
    ];
    const out = summarizeRows(
      [
        { id: "1", g: "a", c: 1.1, p: 10 },
        { id: "2", g: "a", c: 2.2, p: 20 },
        { id: "3", g: "b", c: null, p: 5 },
      ],
      fields,
    );
    expect(out.rows).toEqual([
      { id: "group:1", __lines: 2, g: "a", c: 3.3, p: null },
      { id: "group:2", __lines: 1, g: "b", c: null, p: null },
    ]);
    expect(out.notes).toHaveLength(2);
  });

  it("hides costs and prices from people without financial access", async () => {
    const access = await getReportsAccess(employee);
    const result = await executeReport({ spec: EXTERIOR_OPTIONS_TEMPLATE, access });
    const totals = result.widgets.option_totals as TableResult;
    expect(totals.columns.map((c) => c.key)).not.toContain("item.price");
    expect(totals.message).toMatch(/hidden by your access/);
    const preview = await run(
      "reports_preview",
      { source: "cost_items", fields: ["item.name", "item.price"], limit: 3 },
      employee,
    );
    expect(JSON.stringify(preview)).toMatch(/Financial|access/);
  });
});

describe("regions and model scope", () => {
  it("applies admin region rules to models and their items", async () => {
    expect(byId(await itemRows(), "ci000000")["item.modelRegion"]).toBeNull();
    await saveValueMapping(
      {
        kind: "region",
        sourceField: "model.name",
        matchType: "exact",
        pattern: "i 398",
        value: "Bay Area",
      },
      ADMIN_ID,
    );
    invalidateCatalogContext();
    expect(byId(await itemRows(), "ci000000")["item.modelRegion"]).toBe("Bay Area");
  });

  it("uses model-scope rules once configured; legacy description rule otherwise", async () => {
    const names = async () =>
      (await loadSourceRows("catalog_models")).rows.map((r) => r["model.name"]).sort();
    expect(await names()).toEqual(["Age in Place - 498-A-1", "i 398", "i+ 998-B-1"]);
    await saveValueMapping(
      {
        kind: "model_scope",
        sourceField: "model.name",
        matchType: "exact",
        pattern: "Selections Library",
        value: "exclude",
      },
      ADMIN_ID,
    );
    invalidateCatalogContext();
    // With rules: every top-level group except excluded ones (no description guesswork).
    expect(await names()).toEqual(["Age in Place - 498-A-1", "i 398", "i+ 998-B-1"]);
    await saveValueMapping(
      {
        kind: "model_scope",
        sourceField: "model.name",
        matchType: "exact",
        pattern: "i 398",
        value: "exclude",
      },
      ADMIN_ID,
    );
    invalidateCatalogContext();
    expect(await names()).not.toContain("i 398");
    expect(byId(await itemRows(), "ci000000")["item.context"]).toBe("Other catalog group");
    await expect(
      saveValueMapping(
        {
          kind: "model_scope",
          sourceField: "model.name",
          matchType: "exact",
          pattern: "x",
          value: "maybe",
        },
        ADMIN_ID,
      ),
    ).rejects.toThrow(/include, exclude/);
  });
});

describe("Dexter, templates, and versions", () => {
  it("builds and saves a cost-item report from a natural-language-style spec", async () => {
    const created = await run("reports_create", {
      spec: {
        title: "Exterior option price list",
        datasets: [
          {
            id: "opts",
            source: "cost_items",
            filters: [{ field: "item.optionGroup", op: "eq", value: "Exterior Package Options" }],
          },
        ],
        widgets: [
          {
            id: "list",
            type: "table",
            dataset: "opts",
            summarize: true,
            columns: [{ field: "item.model" }, { field: "item.option" }, { field: "item.price" }],
          },
        ],
      },
      summary: "Exterior options",
    });
    expect(created).toMatchObject({ saved: true });
    const id = created.reportId as string;
    const report = (await getReport(id))!;
    expect(report.spec.datasets[0]!.source).toBe("cost_items");
    const fields = await run("reports_list_fields", { source: "cost_items", search: "option" });
    expect((fields.fields as Array<{ key: string }>).map((f) => f.key)).toEqual(
      expect.arrayContaining(["item.option", "item.optionGroup"]),
    );
  });

  it("keeps existing Product Library reports working and adds live status as a new version", async () => {
    const legacy = reportSpecSchema.parse({
      ...PRODUCT_LIBRARY_TEMPLATE,
      datasets: [
        {
          id: "bay_area",
          source: "catalog_models",
          filters: [{ op: "not_contains", field: "model.name", value: "LA - " }],
        },
      ],
      controls: [],
      widgets: [
        { id: "ba_models", type: "kpi", dataset: "bay_area", metric: { op: "count" } },
        { id: "gaps", type: "text", body: "Most budgets are still 'pending import'." },
      ],
    });
    const report = await createReport({ spec: legacy, ownerId: ADMIN_ID, authorKind: "user" });
    const access = await getReportsAccess(admin);
    const before = await executeReport({ spec: report.spec, access });
    expect((before.widgets.ba_models as { value: number }).value).toBe(3);
    expect(staticDataClaims(report.spec)).toEqual([
      expect.objectContaining({
        widgetId: "gaps",
        excerpt: expect.stringMatching(/pending import/),
      }),
    ]);
    const updated = await run(
      "reports_update",
      {
        reportId: report.id,
        expectedVersion: 1,
        summary: "Add live data status",
        operations: [
          { op: "add_widget", widget: { id: "status", type: "data_status" }, position: "bottom" },
        ],
      },
      admin,
    );
    expect(updated).toMatchObject({ saved: true, version: 2 });
    const after = (await getReport(report.id))!;
    expect(after.version).toBe(2);
    expect(after.spec.widgets.map((w) => w.id)).toEqual(["ba_models", "gaps", "status"]);
    expect((await listRevisions(report.id)).map((r) => r.version).sort()).toEqual([1, 2]);
    const result = await executeReport({ spec: after.spec, access });
    expect(result.widgets.status).toMatchObject({ kind: "data_status", status: "ok" });
    expect(
      (
        result.widgets.status as {
          datasets: Array<{ entity: string; lastSuccessAt: string | null }>;
        }
      ).datasets.find((d) => d.entity === "catalog_models")!.lastSuccessAt,
    ).toBeTruthy();
    expect((result.widgets.gaps as { body: string }).body).toMatch(/pending import/); // never rewritten
  });

  it("reports model and option pricing capability from live data", async () => {
    const access = await getReportsAccess(admin);
    const caps = await capabilityMatrix(access, ["model_pricing", "option_pricing"]);
    const model = caps.find((c) => c.key === "model_pricing")!;
    expect(model.available).toMatch(/of 3 models have budget prices/);
    expect(model.gap).not.toMatch(/pending budget import/);
    expect(caps.find((c) => c.key === "option_pricing")).toMatchObject({
      status: "partial",
      gap: expect.stringMatching(/no selling price/),
    });
  });

  it("enables reports_sources for Dexter", async () => {
    const { DEXTER_TOOLS } = await import("@/lib/agents/defaults");
    expect(DEXTER_TOOLS).toContain("reports_sources");
    expect((await agentDb().select("jt_cost_groups", {})).length).toBeGreaterThan(5);
  });
});
