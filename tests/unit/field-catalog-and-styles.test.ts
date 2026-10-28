/**
 * JobTread-native field catalog (discovery, renames, duplicates, removals, held removals,
 * tenant scope), business-name alias audit and repairs (conflict, ambiguous, shared text),
 * report audit/repair, security of optional fields, and report styling (schema, colors,
 * rules, ops, Dexter dry runs, versioning). Synthetic fixture only.
 */

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDb, eq } from "@/lib/agents/store";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { DEXTER_ENGINE_TOOLS, DEXTER_TOOLS } from "@/lib/agents/defaults";
import { analyzeAliases } from "@/lib/jobtread/alias-audit";
import { applyAliasRepair } from "@/lib/jobtread/alias-repair";
import { newStats } from "@/lib/jobtread/client";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { CUSTOM_FIELDS } from "@/lib/jobtread/fixture";
import {
  fieldSourceRef,
  listCustomFields,
  resetCatalogSchemaProbe,
  shouldHoldRemovals,
  syncCustomFieldMetadata,
} from "@/lib/jobtread/metadata";
import { runFullSync } from "@/lib/jobtread/sync";
import { getReportsAccess } from "@/lib/reports/access";
import { invalidateDataHealthCache } from "@/lib/reports/data-health";
import { executeReport, invalidateCatalogContext } from "@/lib/reports/engine";
import { canonicalEntity, searchNativeFields } from "@/lib/reports/field-catalog";
import { invalidateFieldCatalog, getFieldCatalog, resolveField } from "@/lib/reports/fields";
import { invalidateMetricLibrary } from "@/lib/reports/metrics";
import { applyReportOps } from "@/lib/reports/ops";
import {
  applyReportRepair,
  auditReport,
  collectRefUses,
  previewReportRepair,
} from "@/lib/reports/report-audit";
import { createReport, duplicateReport, getReport, saveReportVersion } from "@/lib/reports/repo";
import { reportSpecSchema, widgetSchema } from "@/lib/reports/spec";
import {
  categoryColor,
  colorSchema,
  firstRuleStyle,
  PALETTES,
  resolvePalette,
  stableIndex,
  styleWarnings,
  themeSchema,
} from "@/lib/reports/style";
import type { KpiResult, TableResult } from "@/lib/reports/result-types";
import { ADMIN_ID, EMPLOYEE_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

vi.setConfig({ testTimeout: 30_000 });

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const employee = requester(EMPLOYEE_ID, "user", "Eli Employee");
const toolCtx = (r: Requester) => ({
  task: { id: "00000000-0000-4000-8000-0000000000f4", allowed_context: {} } as never,
  agent: { row: { id: "00000000-0000-4000-8000-00000000d0d0" } } as never,
  requester: r,
  access: new Set<never>(),
});
const run = async (key: string, args: unknown, who = admin) =>
  (await getTool(key)!.execute(toolCtx(who), args)).data as Record<string, unknown>;

function invalidate() {
  invalidateCatalogContext();
  invalidateFieldCatalog();
  invalidateDataHealthCache();
  invalidateMetricLibrary();
}

const field = (id: string, name: string, type = "text", targetType = "job") => ({
  id,
  name,
  type,
  targetType,
  options: type === "option" ? ["Yes", "No"] : [],
  position: "50",
});

/** Re-run metadata discovery against a given custom-field list. */
async function refresh(
  records: Array<Record<string, unknown>>,
  opts: { confirmRemovals?: boolean } = {},
) {
  uninstallFakePave();
  installFakePave({ records: { customFields: records } });
  const r = await syncCustomFieldMetadata(newStats(), { triggeredBy: "test", ...opts });
  invalidate();
  return r;
}

beforeEach(async () => {
  await setupAgentTestEnv();
  clearJobDetailCache();
  resetCatalogSchemaProbe();
  invalidate();
  installFakePave();
  await runFullSync("test");
  invalidate();
});
afterEach(() => uninstallFakePave());

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("native field catalog", () => {
  it("discovers new fields automatically, with their JobTread label and a stable ref", async () => {
    await refresh([...CUSTOM_FIELDS, field("cfNewField01", "Inspection Window")]);
    const access = await getReportsAccess(admin);
    const r = await searchNativeFields(access, { search: "Inspection" });
    expect(r.fields[0]).toMatchObject({
      ref: "cf:cfNewField01",
      label: "Inspection Window",
      entity: "job",
      status: "active",
    });
    expect(r.fields[0]!.sourceRef).toBe("jobtread:orgTest0001:job:cfNewField01");
    expect(resolveField(await getFieldCatalog(), "cf:cfNewField01").ok).toBe(true);
  });

  it("keeps identity on rename: label changes, ref and reports don't", async () => {
    await refresh([...CUSTOM_FIELDS, field("cfNewField01", "Inspection Window")]);
    const report = await createReport({
      spec: reportSpecSchema.parse({
        title: "Uses a native field",
        datasets: [{ id: "jobs", source: "jobs" }],
        widgets: [
          {
            id: "t",
            type: "table",
            dataset: "jobs",
            columns: [{ field: "job.name" }, { field: "cf:cfNewField01" }],
          },
        ],
      }),
      ownerId: ADMIN_ID,
      authorKind: "user",
      summary: "x",
    });
    await refresh([...CUSTOM_FIELDS, field("cfNewField01", "Inspection Date Window")]);
    const result = await executeReport({
      spec: report.spec,
      access: await getReportsAccess(admin),
    });
    const t = result.widgets.t as TableResult;
    expect(t.columns.map((c) => c.label)).toContain("Inspection Date Window");
    const byOld = await searchNativeFields(await getReportsAccess(admin), {
      search: "Inspection Window",
    });
    expect(byOld.fields[0]).toMatchObject({
      ref: "cf:cfNewField01",
      renamedFrom: ["Inspection Window"],
    });
    const history = await agentDb().select<{ change: string }>("jt_custom_field_history", {
      filters: [eq("field_id", "cfNewField01")],
    });
    expect(history.map((h) => h.change).sort()).toEqual(["added", "renamed"]);
  });

  it("keeps duplicate labels as separate fields", async () => {
    await refresh([...CUSTOM_FIELDS, field("cfDupA00001", "Notes"), field("cfDupB00001", "Notes")]);
    const r = await searchNativeFields(await getReportsAccess(admin), {
      search: "Notes",
      entity: "job",
    });
    expect(r.fields.map((f) => f.ref).sort()).toEqual(["cf:cfDupA00001", "cf:cfDupB00001"]);
    expect(r.fields.every((f) => f.duplicateLabel)).toBe(true);
  });

  it("marks removed fields stale (history kept) and reports show a nonfatal reason", async () => {
    await refresh([...CUSTOM_FIELDS, field("cfGone00001", "Old Field")]);
    const spec = reportSpecSchema.parse({
      title: "Has a removed field",
      datasets: [{ id: "jobs", source: "jobs" }],
      widgets: [
        { id: "n", type: "kpi", dataset: "jobs", metric: { op: "count" } },
        {
          id: "t",
          type: "table",
          dataset: "jobs",
          columns: [{ field: "job.name" }, { field: "cf:cfGone00001" }],
        },
      ],
    });
    await refresh(CUSTOM_FIELDS);
    const rows = await listCustomFields({ includeRemoved: true });
    expect(rows.find((f) => f.id === "cfGone00001")?.removed_at).toBeTruthy();
    const result = await executeReport({ spec, access: await getReportsAccess(admin) });
    expect((result.widgets.n as KpiResult).value).toBe(6); // the rest of the report runs
    expect(result.widgets.t!.status).toBe("ok");
    expect(result.widgets.t!.message).toMatch(/Old Field.*was removed from JobTread/);
  });

  it("holds removals when JobTread's response looks incomplete, and keeps the catalog", async () => {
    const before = (await listCustomFields()).length;
    const r = await refresh([]);
    expect(r).toMatchObject({ seen: 0, removed: 0, heldRemovals: before });
    expect((await listCustomFields()).length).toBe(before);
    const [refreshRow] = await agentDb().select<{ status: string }>("jt_field_catalog_refreshes", {
      order: { col: "started_at", ascending: false },
    });
    expect(refreshRow!.status).toBe("held");
    expect(shouldHoldRemovals(20, 19, 1)).toBe(false);
    expect(shouldHoldRemovals(20, 5, 15)).toBe(true);
    const confirmed = await refresh([], { confirmRemovals: true });
    expect(confirmed.removed).toBe(before);
  });

  it("leaves the last good catalog untouched when discovery fails", async () => {
    const before = (await listCustomFields()).map((f) => f.id).sort();
    uninstallFakePave();
    installFakePave({ failAt: { connection: "customFields", offset: 0, status: 500, times: 99 } });
    await expect(syncCustomFieldMetadata(newStats())).rejects.toThrow();
    expect((await listCustomFields()).map((f) => f.id).sort()).toEqual(before);
  });

  it("uses canonical JobTread entities and tenant-scoped rows", async () => {
    expect(canonicalEntity("Jobs")).toBe("job");
    expect(canonicalEntity("customer contacts")).toBe("customerContact");
    expect(canonicalEntity("daily_logs")).toBe("dailyLog");
    expect(canonicalEntity("vendor accounts")).toBe("vendor");
    expect(canonicalEntity("widgets")).toBeNull();
    await agentDb().insert("jt_custom_fields", {
      id: "cfOtherOrg01",
      name: "Other company field",
      type: "text",
      target_type: "job",
      options: [],
      category: "general",
      organization_id: "orgSomebodyElse",
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      removed_at: null,
    });
    expect((await listCustomFields()).some((f) => f.id === "cfOtherOrg01")).toBe(false);
    expect(fieldSourceRef({ id: "x1", target_type: "job" }, "orgA")).toBe("jobtread:orgA:job:x1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("business-name aliases", () => {
  /** Acton's situation, synthetically: structured fields consolidated into narrative ones. */
  async function seedConsolidation() {
    await refresh([
      ...CUSTOM_FIELDS,
      field("cfCityFb0001", "City Feedback & Special Requirements", "text", "location"),
      field("cfSoilsReq01", "Soils Report Required", "option", "location"),
      field("cfAduSprk001", "ADU Sprinklers Required", "option", "location"),
      field("cfMainSprk01", "Main Home Sprinklers", "option", "location"),
      field("cfWaterSv001", "Water Service & Scope", "text", "location"),
      field("cfPermitNo01", "Permit Number", "text", "job"),
    ]);
    const now = new Date().toISOString();
    const alias = (
      key: string,
      label: string,
      target: string,
      extra: Record<string, unknown> = {},
    ) =>
      agentDb().upsert(
        "jt_semantic_fields",
        {
          key,
          label,
          custom_field_id: target,
          updated_by: ADMIN_ID,
          updated_at: now,
          mapped_by: "admin",
          ...extra,
        },
        ["key"],
      );
    await alias("soils_report", "Soils Report Required", "cfCityFb0001", {
      source_name: "Soils Report Required",
      source_category: "Locations",
      requested_target: "location",
      requested_type: "Dropdown",
    });
    await alias("sprinklers_required", "Sprinklers Required", "cfCityFb0001");
    await alias("water_line_size", "Current Water Line Size", "cfWaterSv001");
    await alias("water_meter_size", "Current Water Meter Size", "cfWaterSv001");
    await alias("water_service_and_scope", "Water Service & Scope", "cfWaterSv001");
    await alias("permit", "Permit", "cfPermitNo01");
    const [job] = await agentDb().select<{ id: string; location_fields: Record<string, string[]> }>(
      "jt_jobs",
      { filters: [eq("id", "job00000001")] },
    );
    await agentDb().update("jt_jobs", [eq("id", "job00000001")], {
      location_fields: {
        ...(job!.location_fields ?? {}),
        cfCityFb0001: ["Soils needed; ADU sprinklers yes"],
        cfSoilsReq01: ["Yes"],
        cfWaterSv001: ['1" line, 5/8" meter'],
      },
    });
    invalidate();
  }

  const siteSpec = () =>
    reportSpecSchema.parse({
      title: "Site data",
      datasets: [
        {
          id: "jobs",
          source: "jobs",
          filters: [{ field: "job.name", op: "eq", value: "Test Project 1" }],
        },
      ],
      widgets: [
        {
          id: "t",
          type: "table",
          dataset: "jobs",
          columns: [
            { field: "job.name" },
            { field: "sem:soils_report" },
            { field: "sem:sprinklers_required" },
            { field: "sem:water_line_size" },
            { field: "sem:water_meter_size" },
          ],
        },
      ],
    });

  it("classifies aliases by id: conflict with a certain repair, ambiguity, shared text", async () => {
    await seedConsolidation();
    const aliases = await agentDb().select("jt_semantic_fields", {});
    const findings = analyzeAliases(
      aliases as never,
      await listCustomFields({ includeRemoved: true }),
    );
    expect(findings.get("soils_report")).toMatchObject({
      status: "conflict",
      repair: { id: "cfSoilsReq01", name: "Soils Report Required" },
    });
    const sprinklers = findings.get("sprinklers_required")!;
    expect(sprinklers.status).toBe("ambiguous");
    expect(sprinklers.repair).toBeNull(); // never guessed
    expect(sprinklers.candidates.map((c) => c.name).sort()).toEqual([
      "ADU Sprinklers Required",
      "Main Home Sprinklers",
    ]);
    expect(findings.get("water_line_size")!.status).toBe("shared_text");
    expect(findings.get("water_service_and_scope")!.status).toBe("ok"); // honest name
    expect(findings.get("permit")!.status).toBe("ok"); // "Permit" → "Permit Number" is the same field
  });

  it("keeps the report running: bad aliases are skipped with reasons, shared text warns", async () => {
    await seedConsolidation();
    const result = await executeReport({ spec: siteSpec(), access: await getReportsAccess(admin) });
    const t = result.widgets.t as TableResult;
    expect(t.status).toBe("ok");
    expect(t.columns.map((c) => c.key)).toEqual(["job.name", "cf:cfWaterSv001", "cf:cfWaterSv001"]);
    expect(t.message).toMatch(/Soils Report Required.*cfSoilsReq01/);
    expect(t.message).toMatch(/ADU Sprinklers Required.*Main Home Sprinklers/);
    expect(result.issues.join(" ")).toMatch(/whole “Water Service & Scope” text field/);
  });

  it("repairs the soils alias to its verified field; ambiguity needs an explicit choice", async () => {
    await seedConsolidation();
    const preview = await applyAliasRepair("soils_report", { action: "apply_suggested" }, ADMIN_ID);
    expect(preview.to).toMatchObject({ id: "cfSoilsReq01" });
    expect(preview.reports).toEqual([]);
    await expect(
      applyAliasRepair("sprinklers_required", { action: "apply_suggested" }, ADMIN_ID),
    ).rejects.toThrow(/no certain repair — choose one of/);
    invalidate();
    const result = await executeReport({ spec: siteSpec(), access: await getReportsAccess(admin) });
    const t = result.widgets.t as TableResult;
    expect(t.rows[0]!.cells["cf:cfSoilsReq01"]).toEqual(["Yes"]);
  });

  it("previews and applies a report repair as a new version (shared text → native ref)", async () => {
    await seedConsolidation();
    const report = await createReport({
      spec: siteSpec(),
      ownerId: ADMIN_ID,
      authorKind: "user",
      summary: "x",
    });
    const access = await getReportsAccess(admin);
    const preview = await previewReportRepair({ reportId: report.id, access });
    expect(preview.replacements).toEqual({
      "sem:water_line_size": "cf:cfWaterSv001",
      "sem:water_meter_size": "cf:cfWaterSv001",
    });
    expect(preview.removedDuplicates).toEqual(["t.columns: duplicate cf:cfWaterSv001"]);
    expect((await getReport(report.id))!.version).toBe(report.version); // dry run saves nothing
    const applied = await applyReportRepair({
      reportId: report.id,
      access,
      userId: ADMIN_ID,
      authorKind: "user",
    });
    expect(applied).toMatchObject({ saved: true, version: report.version + 1 });
    const saved = (await getReport(report.id))!;
    const cols =
      saved.spec.widgets[0]!.type === "table"
        ? saved.spec.widgets[0]!.columns.map((c) => c.field)
        : [];
    expect(cols).toEqual([
      "job.name",
      "sem:soils_report",
      "sem:sprinklers_required",
      "cf:cfWaterSv001",
    ]);
  });

  it("audits every place a field can be used, including formulas, colors, and saved views", async () => {
    const spec = reportSpecSchema.parse({
      title: "Everywhere",
      datasets: [
        { id: "jobs", source: "jobs", filters: [{ field: "cf:cfMissing001", op: "not_blank" }] },
      ],
      calculations: [
        {
          key: "x_calc",
          label: "X",
          source: "jobs",
          basis: "row",
          formula: "COALESCE(cf:cfMissing002, 0) + 1",
          type: "number",
        },
      ],
      controls: [
        {
          id: "g",
          kind: "group_by",
          label: "Group",
          widgets: ["t"],
          options: ["cf:cfMissing003", "job.city"],
        },
      ],
      widgets: [
        {
          id: "t",
          type: "table",
          dataset: "jobs",
          groupLevels: ["cf:cfMissing004"],
          sort: [{ field: "job.name", dir: "asc" }],
          columns: [{ field: "job.name" }],
        },
      ],
      theme: { categoryColors: { "cf:cfMissing005": { A: "#112233" } } },
    });
    const refs = collectRefUses(spec).map((u) => u.ref);
    for (const id of [
      "cfMissing001",
      "cfMissing002",
      "cfMissing003",
      "cfMissing004",
      "cfMissing005",
    ])
      expect(refs).toContain(`cf:${id}`);
    const findings = await auditReport({
      id: "r1",
      title: "Everywhere",
      spec,
      updated_at: new Date().toISOString(),
    });
    expect(
      findings
        .filter((f) => f.kind === "missing")
        .map((f) => f.ref)
        .sort(),
    ).toEqual([
      "cf:cfMissing001",
      "cf:cfMissing002",
      "cf:cfMissing003",
      "cf:cfMissing004",
      "cf:cfMissing005",
    ]);
    expect(collectRefUses({ grouping: ["cf:cfView00001"] }, "state")[0]).toEqual({
      ref: "cf:cfView00001",
      path: "state.grouping[0]",
    });
  });

  it("flags type changes made after a report was saved", async () => {
    await refresh([...CUSTOM_FIELDS, field("cfTyped00001", "Lot Size", "text")]);
    const spec = reportSpecSchema.parse({
      title: "Typed",
      datasets: [{ id: "jobs", source: "jobs" }],
      widgets: [
        { id: "t", type: "table", dataset: "jobs", columns: [{ field: "cf:cfTyped00001" }] },
      ],
    });
    const savedAt = new Date(Date.now() - 60_000).toISOString();
    await refresh([...CUSTOM_FIELDS, field("cfTyped00001", "Lot Size", "number")]);
    const findings = await auditReport({ id: "r2", title: "Typed", spec, updated_at: savedAt });
    expect(findings).toEqual([
      expect.objectContaining({
        kind: "type_changed",
        message: expect.stringMatching(/text → number/),
      }),
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("security of optional fields", () => {
  it("keeps vendor/contact/daily-log fields out of reports and hides them from non-admins", async () => {
    await refresh([
      ...CUSTOM_FIELDS,
      field("cfVendor0001", "Vendor Rating", "text", "vendor"),
      field("cfDaily00001", "Work Performed", "text", "dailyLog"),
    ]);
    const adminView = await run("reports_fields", { search: "Vendor Rating" });
    expect((adminView.fields as Array<{ status: string }>)[0]).toMatchObject({
      status: "unsupported",
    });
    const employeeView = await run("reports_fields", { search: "Vendor Rating" }, employee);
    expect(employeeView.fields).toEqual([]);
    const financial = await run("reports_fields", { search: "cfBudget001" }, employee);
    expect(financial.fields).toEqual([]); // financial-category fields need financial access
    const adminFinancial = await run("reports_fields", { search: "cfBudget001" });
    expect((adminFinancial.fields as unknown[]).length).toBe(1);
    const r = resolveField(await getFieldCatalog(), "cf:cfVendor0001");
    expect(r.ok).toBe(false);
  });

  it("refuses organization-wide audits to non-admins and keeps table rules access-aware", async () => {
    expect(await run("reports_catalog_audit", {}, employee)).toMatchObject({ ok: false });
    const spec = reportSpecSchema.parse({
      title: "Colored rows",
      datasets: [{ id: "jobs", source: "jobs" }],
      widgets: [
        {
          id: "t",
          type: "table",
          dataset: "jobs",
          columns: [{ field: "job.name" }],
          appearance: {
            rules: [
              {
                field: "job.projectedPrice",
                op: "gt",
                value: 350000,
                style: { background: "token:negative" },
              },
            ],
          },
        },
      ],
    });
    const asAdmin = (await executeReport({ spec, access: await getReportsAccess(admin) })).widgets
      .t as TableResult;
    expect(asAdmin.rows.filter((r) => r.ruleStyle).length).toBe(1);
    const asEmployee = (await executeReport({ spec, access: await getReportsAccess(employee) }))
      .widgets.t as TableResult;
    expect(asEmployee.rows.some((r) => r.ruleStyle)).toBe(false); // can't infer hidden prices
  });

  it("creates new tables with row-level security and enables the new Dexter tools", () => {
    const sql = fs.readFileSync("supabase/migrations/080_field_catalog.sql", "utf8");
    for (const t of ["jt_custom_field_history", "jt_field_catalog_refreshes"])
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
    expect(sql).not.toMatch(/\bdrop table\b|\bdelete from\b/i);
    for (const t of [
      "reports_fields",
      "reports_catalog_audit",
      "reports_field_impact",
      "reports_field_repair",
    ]) {
      expect(DEXTER_ENGINE_TOOLS).toContain(t);
      expect(DEXTER_TOOLS).toContain(t);
      expect(getTool(t)).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("report styling", () => {
  const base = () =>
    reportSpecSchema.parse({
      title: "Styled",
      datasets: [{ id: "jobs", source: "jobs" }],
      widgets: [
        { id: "k", type: "kpi", dataset: "jobs", metric: { op: "count" } },
        {
          id: "c",
          type: "chart",
          chart: "bar",
          dataset: "jobs",
          groupBy: "sem:phase",
          metric: { op: "count" },
        },
        {
          id: "t",
          type: "table",
          dataset: "jobs",
          groupLevels: ["sem:phase"],
          columns: [{ field: "job.name" }],
        },
      ],
    });

  it("leaves unstyled specs unchanged", () => {
    const s = base();
    expect(s.theme).toBeUndefined();
    expect(s.widgets.every((w) => !("appearance" in w) || w.appearance === undefined)).toBe(true);
    expect(JSON.stringify(reportSpecSchema.parse(JSON.parse(JSON.stringify(s))))).toBe(
      JSON.stringify(s),
    );
  });

  it("validates colors strictly and rejects CSS, URLs, and unknown keys with paths", () => {
    expect(colorSchema.parse("#ABC")).toBe("#aabbcc");
    expect(colorSchema.parse(" token:negative ")).toBe("token:negative");
    for (const bad of [
      "red",
      "#12345",
      "#ff000080",
      "transparent",
      "url(javascript:alert(1))",
      "expression(alert(1))",
      "var(--x)",
      "token:evil",
    ])
      expect(colorSchema.safeParse(bad).success).toBe(false);
    expect(themeSchema.safeParse({ palette: "neon" }).success).toBe(false);
    const bad = applyReportOps(base(), [
      { op: "set_widget_appearance", id: "k", appearance: { css: "color:red" } },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]!.message).toMatch(/kpi widgets support: .*valueColor/);
    const badRule = applyReportOps(base(), [
      {
        op: "set_widget_appearance",
        id: "t",
        appearance: { rules: [{ op: "gt", value: 1, style: { color: "#ff0000" } }] },
      },
    ]);
    expect(badRule.ok).toBe(false);
    if (!badRule.ok) expect(badRule.issues[0]!.path).toBe("widgets[2].appearance.rules[0].field");
    const badColor = applyReportOps(base(), [
      { op: "set_theme", theme: { tokens: { accent: "blue" } } },
    ]);
    expect(badColor.ok).toBe(false);
    if (!badColor.ok) expect(badColor.issues[0]!.path).toBe("operations[0].theme.tokens.accent");
    expect(
      widgetSchema.safeParse({ id: "x", type: "text", body: "hi", appearance: { html: "<b>" } })
        .success,
    ).toBe(false);
  });

  it("binds category colors to values, not positions, with deterministic fallbacks", () => {
    const theme = themeSchema.parse({
      palette: "acton",
      categoryColors: { "sem:phase": { Blocked: "token:negative", Waiting: "#eda100" } },
    });
    const palette = resolvePalette(theme);
    expect(palette).toEqual(PALETTES.acton!.categorical);
    const color = (v: string) => categoryColor(v, { theme, field: "sem:phase", palette });
    expect(color("Blocked")).toBe("#e34948");
    expect(color("Waiting")).toBe("#eda100");
    const newPhase = color("BR-Design");
    expect(newPhase).toBe(palette[stableIndex("BR-Design", palette.length)]);
    // Same value → same color whatever else is shown or in which order.
    const pass1 = ["BR-Design", "Complete", "Warranty"].map(color);
    const pass2 = ["Warranty", "BR-Design"].map(color);
    expect(pass2).toEqual([pass1[2], pass1[0]]);
    expect(color("(blank)")).toBe("#a3acb8");
    expect(
      categoryColor("BR-Design", {
        theme,
        field: "sem:phase",
        widget: { "BR-Design": "#000000" },
        palette,
      }),
    ).toBe("#000000");
  });

  it("applies the first matching conditional rule (KPI value, chart category)", () => {
    const rules = [
      { op: "lt" as const, value: 20, style: { color: "token:negative" } },
      { op: "between" as const, value: [20, 30], style: { color: "token:warning" } },
    ];
    expect(firstRuleStyle(rules, () => 12)).toEqual({ color: "token:negative" });
    expect(firstRuleStyle(rules, () => 25)).toEqual({ color: "token:warning" });
    expect(firstRuleStyle(rules, () => 31)).toBeNull();
    expect(firstRuleStyle(rules, () => null)).toBeNull();
    const cat = [
      {
        target: "category" as const,
        op: "in" as const,
        value: ["Blocked"],
        style: { color: "#ff0000" },
      },
    ];
    expect(firstRuleStyle(cat, () => "Blocked")).toEqual({ color: "#ff0000" });
  });

  it("supports every style through Dexter, dry-run first, and keeps it across versions and copies", async () => {
    const report = await createReport({
      spec: base(),
      ownerId: ADMIN_ID,
      authorKind: "user",
      summary: "x",
    });
    const ops = [
      {
        op: "set_theme",
        theme: {
          palette: "acton",
          density: "compact",
          spacing: "tight",
          typography: "sm",
          card: "outlined",
          categoryColors: { "sem:phase": { "BR-Design": "token:accent" } },
          statusColors: { Canceled: "token:neutral" },
          nullColor: "#cccccc",
        },
      },
      {
        op: "set_widget_appearance",
        id: "k",
        appearance: {
          valueColor: "#0b1f3a",
          accent: "token:accent",
          background: "#ffffff",
          align: "center",
          rules: [{ op: "lt", value: 20, style: { color: "token:negative", emphasis: "bold" } }],
        },
      },
      {
        op: "set_widget_appearance",
        id: "c",
        appearance: {
          palette: "slate",
          seriesColors: { Count: "#123456" },
          categoryColors: { Complete: "#00aa00" },
          legend: { show: true, position: "bottom" },
          axis: { x: { show: true, label: "Phase" }, y: { show: false }, grid: false },
          rules: [
            { target: "category", op: "eq", value: "Canceled", style: { color: "token:neutral" } },
          ],
        },
      },
      {
        op: "set_widget_appearance",
        id: "t",
        appearance: {
          density: "compact",
          header: "accent",
          zebra: true,
          dividers: "grid",
          groupHeader: "emphasized",
          subtotal: "bold",
          columns: { "job.name": { align: "left" } },
          controls: {
            columns: false,
            expandAll: false,
            collapseAll: true,
            expandToLevel: false,
            search: false,
          },
          rules: [
            { field: "job.name", op: "contains", value: "1", style: { background: "#fff5d6" } },
          ],
        },
      },
    ];
    const dry = await run("reports_update", {
      reportId: report.id,
      expectedVersion: report.version,
      operations: ops,
      summary: "Style",
      dryRun: true,
    });
    expect(dry).toMatchObject({ saved: false, dryRun: true, valid: true });
    expect((await getReport(report.id))!.version).toBe(report.version);
    const saved = await run("reports_update", {
      reportId: report.id,
      expectedVersion: report.version,
      operations: ops,
      summary: "Style",
    });
    expect(saved).toMatchObject({ saved: true });
    const v2 = (await getReport(report.id))!;
    expect(v2.spec.theme).toMatchObject({ palette: "acton", density: "compact" });
    const copy = await duplicateReport(v2, ADMIN_ID, "Styled copy");
    expect((await getReport(copy.id))!.spec.theme?.palette).toBe("acton");
    const reset = applyReportOps(v2.spec, [
      { op: "remove_theme" },
      { op: "remove_widget_appearance", id: "t" },
    ]);
    expect(reset.ok && reset.spec.theme === undefined).toBe(true);
    // Styling never changes the numbers.
    const access = await getReportsAccess(admin);
    const plain = await executeReport({ spec: base(), access });
    const styledRun = await executeReport({ spec: v2.spec, access });
    expect((styledRun.widgets.k as KpiResult).value).toBe((plain.widgets.k as KpiResult).value);
    expect((styledRun.widgets.t as TableResult).totals).toEqual(
      (plain.widgets.t as TableResult).totals,
    );
    void saveReportVersion;
  });

  it("warns (doesn't fail) about low-contrast colors", () => {
    const warnings = styleWarnings({
      theme: undefined,
      widgets: [
        { id: "k", type: "kpi", appearance: { valueColor: "#eeeeee", background: "#ffffff" } },
      ],
    });
    expect(warnings[0]).toMatch(/widget k: text contrast .* below 4\.5:1/);
  });
});
