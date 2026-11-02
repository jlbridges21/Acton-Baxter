/**
 * Field mapping health (id-keyed resolution: rename, delete, duplicate, unavailable, admin
 * toggle, permissions), column formatting by stable column id (persistence through save,
 * regeneration, reorder, relabel, repair, deletion; raw-value rules; values/exports untouched;
 * Dexter ambiguity), drill-downs (reconciliation, paging, filters, authorization, related
 * sources), integrity checks, and saved-report regressions. Synthetic JobTread fixture only —
 * no live JobTread or QuickBooks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDb, eq } from "@/lib/agents/store";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { DEXTER_PRESENTATION_TOOLS, DEXTER_TOOLS } from "@/lib/agents/defaults";
import { newStats } from "@/lib/jobtread/client";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { allowedValues } from "@/lib/jobtread/entities";
import { CUSTOM_FIELDS, F, JOBS } from "@/lib/jobtread/fixture";
import {
  ensureSemanticDefaults,
  listSemanticFields,
  resetCatalogSchemaProbe,
  syncCustomFieldMetadata,
} from "@/lib/jobtread/metadata";
import { processEntitySyncJob, requestEntitySync } from "@/lib/jobtread/sync-manager";
import { runFullSync } from "@/lib/jobtread/sync";
import { listMemoryJobsForTests, resetMemoryJobsForTests } from "@/lib/jobs/queue";
import { getReportsAccess } from "@/lib/reports/access";
import {
  assignColumnIds,
  cellRuleStyle,
  formatNumberCell,
  mergeColumnFormat,
} from "@/lib/reports/column-format";
import { invalidateDataHealthCache } from "@/lib/reports/data-health";
import { reconcileChildren, rowsAtPath } from "@/lib/reports/drill-core";
import { drillSpec } from "@/lib/reports/drill-http";
import { drillGroup, executeReport, invalidateCatalogContext } from "@/lib/reports/engine";
import { lookupField, validateFieldMappings } from "@/lib/reports/field-mapping-core";
import {
  buildFieldMappingReport,
  resetMappingSchemaProbe,
  resolveMappingReview,
  revalidateFieldMappings,
  setFieldReporting,
  visibleTo,
} from "@/lib/reports/field-mappings";
import { getFieldCatalog, invalidateFieldCatalog, resolveField } from "@/lib/reports/fields";
import { auditReportIntegrity } from "@/lib/reports/integrity";
import { invalidateMetricLibrary } from "@/lib/reports/metrics";
import { applyReportOps } from "@/lib/reports/ops";
import { replaceRefs } from "@/lib/reports/report-audit";
import { checkResultIntegrity, checkSpecIntegrity } from "@/lib/reports/report-integrity";
import {
  createReport,
  getReport,
  getReportRaw,
  loadReportFor,
  saveReportVersion,
} from "@/lib/reports/repo";
import type { TableResult } from "@/lib/reports/result-types";
import { parseReportSpec, reportSpecSchema, type ReportSpec } from "@/lib/reports/spec";
import { REPORT_TEMPLATES } from "@/lib/reports/templates";
import { ADMIN_ID, EMPLOYEE_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

vi.setConfig({ testTimeout: 30_000 });

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const employee = requester(EMPLOYEE_ID, "user", "Eli Employee");
const toolCtx = (r: Requester) => ({
  task: { id: "00000000-0000-4000-8000-0000000000f5", allowed_context: {} } as never,
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
  options: [],
  position: "60",
});

async function refresh(records: Array<Record<string, unknown>>) {
  uninstallFakePave();
  installFakePave({ records: { customFields: records } });
  const r = await syncCustomFieldMetadata(newStats(), { triggeredBy: "test" });
  invalidate();
  return r;
}

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

beforeEach(async () => {
  await setupAgentTestEnv();
  resetMemoryJobsForTests();
  clearJobDetailCache();
  resetCatalogSchemaProbe();
  resetMappingSchemaProbe();
  invalidate();
  installFakePave();
  await runFullSync("test");
  invalidate();
});
afterEach(() => uninstallFakePave());

/** Jobs grouped Phase → Project Manager, with a price column (financial) and a count. */
const groupedSpec = (extra: Record<string, unknown> = {}): ReportSpec =>
  reportSpecSchema.parse({
    title: "Pipeline by phase",
    datasets: [{ id: "jobs", source: "jobs" }],
    widgets: [
      {
        id: "t",
        type: "table",
        dataset: "jobs",
        groupLevels: ["sem:phase", "sem:project_manager"],
        columns: [
          { field: "job.name" },
          { field: "job.projectedPrice" },
          { field: `cf:${F.sqft}`, label: "Sq ft" },
        ],
        ...extra,
      },
    ],
  });

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("Phase 1 — field mapping resolution", () => {
  it("keeps a renamed field working by id and records its former name", async () => {
    await refresh([...CUSTOM_FIELDS, field("cfRenamed01", "Inspection Window")]);
    await revalidateFieldMappings();
    await refresh([...CUSTOM_FIELDS, field("cfRenamed01", "Inspection Date Window")]);
    const report = await buildFieldMappingReport();
    const r = report.results.find((x) => x.ref === "cf:cfRenamed01")!;
    expect(r).toMatchObject({ currentName: "Inspection Date Window", reportable: true });
    expect(r.previousNames).toContain("Inspection Window");
    expect(r.issues.map((i) => i.code)).toContain("field_renamed");
    // A person can still find it by its old name; reports keep the same ref.
    const found = lookupField(report.results, "Inspection Window");
    expect(found.status).toBe("resolved");
    expect(found.status === "resolved" && found.result.ref).toBe("cf:cfRenamed01");
    expect(resolveField(await getFieldCatalog(), "cf:cfRenamed01").ok).toBe(true);
  });

  it("marks a deleted field stale with a broken-mapping reason; history is kept", async () => {
    await refresh([...CUSTOM_FIELDS, field("cfGone00002", "Old Notes")]);
    await refresh(CUSTOM_FIELDS);
    const report = await buildFieldMappingReport();
    const r = report.results.find((x) => x.ref === "cf:cfGone00002")!;
    expect(r.syncStatus).toBe("stale");
    expect(r.exclusion?.reason).toBe("broken_mapping");
    expect(r.issues.some((i) => i.code === "field_removed" && i.severity === "error")).toBe(true);
    const stored = await agentDb().select("jt_custom_fields", {
      filters: [eq("id", "cfGone00002")],
    });
    expect(stored).toHaveLength(1); // never deleted
  });

  it("never picks between duplicate names — lookups are ambiguous and auto-mapping is skipped", async () => {
    await refresh([...CUSTOM_FIELDS, field("cfDupNameA1", "Notes"), field("cfDupNameB1", "Notes")]);
    const report = await buildFieldMappingReport();
    const found = lookupField(report.results, "Notes", { entity: "job" });
    expect(found.status).toBe("ambiguous");
    expect(found.status === "ambiguous" && found.matches.map((m) => m.ref).sort()).toEqual([
      "cf:cfDupNameA1",
      "cf:cfDupNameB1",
    ]);
    // Two live "Model" fields: the built-in vocabulary must not auto-map sem:model by name.
    await agentDb().update("jt_semantic_fields", [eq("key", "model")], {
      custom_field_id: null,
      updated_by: null,
    });
    await refresh([...CUSTOM_FIELDS, field("cfModelDup1", "Model")]);
    await ensureSemanticDefaults();
    const model = (await listSemanticFields()).find((s) => s.key === "model")!;
    expect(model.custom_field_id).toBeNull();
  });

  it("flags a legacy name-based alias whose name is now shared, without remapping it", async () => {
    // sem:model was auto-mapped by name to F.model; a second "Model" field appears.
    const before = (await listSemanticFields()).find((s) => s.key === "model")!;
    expect(before.custom_field_id).toBe(F.model);
    await refresh([...CUSTOM_FIELDS, field("cfModelDup2", "Model")]);
    const persisted = await revalidateFieldMappings();
    const alias = persisted.results.find((r) => r.ref === "sem:model")!;
    expect(alias.mappingStatus).toBe("needs_review");
    expect(alias.issues.map((i) => i.code)).toContain("legacy_name_ambiguous");
    expect((await listSemanticFields()).find((s) => s.key === "model")!.custom_field_id).toBe(
      F.model,
    );
    const [row] = await agentDb().select<{ review_status: string }>("jt_field_mappings", {
      filters: [eq("internal_ref", "sem:model")],
    });
    expect(row!.review_status).toBe("needs_review");
    // An administrator confirms it explicitly; the flag clears and the mapping is unchanged.
    const resolved = await resolveMappingReview({
      ref: "sem:model",
      action: "confirm",
      userId: ADMIN_ID,
      label: "Avery Admin",
    });
    expect(resolved.mappingStatus).not.toBe("needs_review");
    expect((await listSemanticFields()).find((s) => s.key === "model")!.custom_field_id).toBe(
      F.model,
    );
  });

  it("explains every unavailable case with the documented reason", () => {
    const base = {
      organizationId: "orgTest0001",
      aliases: [],
      aliasFindings: new Map(),
      overrides: [{ internal_ref: "cf:off", reporting_enabled: false }],
      datasets: [
        {
          key: "accounts",
          enabled: true,
          status: "completed",
          lastSuccessAt: "2026-11-01",
          droppedFields: [],
        },
        {
          key: "contacts",
          enabled: false,
          status: "disabled",
          lastSuccessAt: null,
          droppedFields: [],
        },
        {
          key: "jobs",
          enabled: true,
          status: "completed",
          lastSuccessAt: "2026-11-01",
          droppedFields: [],
        },
      ],
    };
    const f = (id: string, target: string, category = "general") => ({
      id,
      name: id,
      type: "text",
      target_type: target,
      category: category as "general",
      display_name: null,
      removed_at: null,
    });
    const report = validateFieldMappings({
      ...base,
      fields: [
        f("ok", "job"),
        f("off", "job"),
        f("privacy", "job", "excluded"),
        f("vendor", "vendor"),
        f("contact", "customerContact"),
        f("log", "dailyLog"),
        f("weird", "somethingNew"),
        f("money", "job", "financial"),
      ],
      viewer: { isAdmin: false, categories: new Set(["general"]) },
    });
    const reason = (id: string) =>
      report.results.find((r) => r.ref === `cf:${id}`)!.exclusion?.reason ?? null;
    expect(reason("ok")).toBeNull();
    expect(reason("off")).toBe("intentional");
    expect(reason("privacy")).toBe("intentional");
    expect(reason("vendor")).toBe("synced_not_exposed");
    expect(reason("contact")).toBe("not_synced"); // dataset off
    expect(reason("log")).toBe("not_synced");
    expect(reason("weird")).toBe("unsupported_api");
    expect(reason("money")).toBe("permission");
    const dropped = validateFieldMappings({
      ...base,
      datasets: [
        {
          key: "accounts",
          enabled: true,
          status: "completed",
          lastSuccessAt: "x",
          droppedFields: ["customFieldValues"],
        },
      ],
      fields: [f("vendor", "vendor")],
    });
    expect(dropped.results[0]!.exclusion?.reason).toBe("unsupported_api");
    expect(report.summary.byExclusion.intentional).toBe(2);
    const aliases = validateFieldMappings({
      ...base,
      fields: [f("ok", "job")],
      aliases: [
        { key: "unmapped_term", label: "Unmapped term", custom_field_id: null },
        { key: "gone_term", label: "Gone term", custom_field_id: "missingField1" },
      ],
    });
    const unmapped = aliases.results.find((r) => r.ref === "sem:unmapped_term")!;
    expect(unmapped).toMatchObject({
      mappingStatus: "unmapped",
      reportable: false,
      exclusion: null,
    });
    expect(aliases.results.find((r) => r.ref === "sem:gone_term")!.exclusion?.reason).toBe(
      "broken_mapping",
    );
    expect(aliases.summary.bySyncStatus.not_synced).toBe(0); // aliases don't count as fields
  });

  it("lets an administrator exclude an eligible field (values kept) and never widens access", async () => {
    const before = await executeReport({
      spec: groupedSpec(),
      access: await getReportsAccess(admin),
    });
    expect((before.widgets.t as TableResult).columns.map((c) => c.label)).toContain("Sq ft");
    await setFieldReporting({
      ref: `cf:${F.sqft}`,
      enabled: false,
      userId: ADMIN_ID,
      label: "Avery Admin",
    });
    invalidate();
    const after = await executeReport({
      spec: groupedSpec(),
      access: await getReportsAccess(admin),
    });
    const t = after.widgets.t as TableResult;
    expect(t.columns.map((c) => c.label)).not.toContain("Sq ft");
    expect(t.message).toMatch(/turned it off for reports/);
    expect(t.message).not.toMatch(/Total Sqft/); // the label isn't revealed
    // Cached values are untouched.
    const [job] = await agentDb().select<{ job_fields: Record<string, unknown> }>("jt_jobs", {
      filters: [eq("id", JOBS[0]!.id)],
    });
    expect(job!.job_fields[F.sqft]).toBeTruthy();
    await setFieldReporting({ ref: `cf:${F.sqft}`, enabled: true, userId: ADMIN_ID, label: "A" });
    invalidate();
    expect(resolveField(await getFieldCatalog(), `cf:${F.sqft}`).ok).toBe(true);
    // Ineligible fields can't be switched on (a vendor field has no report source).
    await expect(
      setFieldReporting({ ref: "cf:cfVendor001", enabled: true, userId: ADMIN_ID, label: "A" }),
    ).rejects.toThrow(/can't be switched on/);
    // Enabling a financial field doesn't let a general-access employee read it.
    await setFieldReporting({ ref: `cf:${F.budget}`, enabled: true, userId: ADMIN_ID, label: "A" });
    const emp = visibleTo(
      await buildFieldMappingReport(await getReportsAccess(employee)),
      await getReportsAccess(employee),
    );
    expect(emp.some((r) => r.ref === `cf:${F.budget}`)).toBe(false);
  });

  it("caches contact custom fields under JobTread's customerContact target", () => {
    const out = allowedValues(
      {
        customFieldValues: {
          nodes: [
            { value: "Decider", customField: { id: "cfRole01" } },
            { value: "x", customField: { id: "cfNotAllowed" } },
          ],
        },
      },
      ["customerContact", "vendorContact", "contact"],
      { syncedAt: "now", allowedFields: new Map([["customerContact", new Set(["cfRole01"])]]) },
    );
    expect(out).toEqual({ cfRole01: ["Decider"] });
  });

  it("persists a snapshot by id and tenant without deleting rows", async () => {
    const first = await revalidateFieldMappings();
    expect(first.persisted).toBe(true);
    const rows = await agentDb().select<{ internal_ref: string; organization_id: string }>(
      "jt_field_mappings",
    );
    expect(rows.every((r) => r.organization_id === "orgTest0001")).toBe(true);
    expect(rows.some((r) => r.internal_ref === `cf:${F.phase}`)).toBe(true);
    await refresh(CUSTOM_FIELDS.filter((c) => c.id !== F.model));
    await revalidateFieldMappings();
    const after = await agentDb().select<{ internal_ref: string; sync_status: string }>(
      "jt_field_mappings",
    );
    expect(after.length).toBeGreaterThanOrEqual(rows.length);
    expect(after.find((r) => r.internal_ref === `cf:${F.model}`)!.sync_status).toBe("stale");
  });

  it("gives Dexter the same validator: lookups, ambiguity, and hidden fields for non-admins", async () => {
    expect(DEXTER_TOOLS).toEqual(expect.arrayContaining(DEXTER_PRESENTATION_TOOLS));
    const hit = await run("reports_field_mappings", { action: "lookup", query: "Phase" });
    expect(hit).toMatchObject({ status: "resolved", field: { ref: `cf:${F.phase}` } });
    const summary = await run("reports_field_mappings", { action: "summary" }, employee);
    expect(summary).toHaveProperty("usableFields");
    expect(summary).not.toHaveProperty("needsAttention");
    const vendor = await run(
      "reports_field_mappings",
      { action: "lookup", query: "Vendor Rating" },
      employee,
    );
    expect(vendor.status).toBe("not_found"); // excluded fields' names aren't revealed
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("Phase 2 — column identity and formatting", () => {
  it("assigns deterministic, unique ids and inherits them on regeneration", () => {
    const cols = assignColumnIds([
      { field: "job.name" },
      { field: "job.name" },
      { field: "cf:Ab" },
    ]);
    expect(cols.map((c) => c.id)).toEqual(["job_name", "job_name_2", "cf_ab"]);
    expect(
      assignColumnIds([{ field: "job.name" }, { field: "job.name" }]).map((c) => c.id),
    ).toEqual(["job_name", "job_name_2"]);
    // Regenerated without ids: matched by field, then label; new columns derive fresh ids.
    const prev = [
      { id: "price", field: "job.projectedPrice" },
      { id: "who", field: "sem:project_manager", label: "Owner" },
    ];
    const next = assignColumnIds(
      [
        { field: "job.name" },
        { field: `cf:${F.pm}`, label: "Owner" },
        { field: "job.projectedPrice" },
      ],
      prev,
    );
    expect(next.map((c) => c.id)).toEqual(["job_name", "who", "price"]);
    // Duplicate explicit ids are re-derived (the first keeps it).
    expect(
      assignColumnIds([
        { id: "x", field: "job.name" },
        { id: "x", field: "job.number" },
      ]).map((c) => c.id),
    ).toEqual(["x", "job_number"]);
  });

  it("formats numbers for display only and evaluates rules on raw values", () => {
    expect(formatNumberCell(1234.5, "currency", { style: "currency", decimals: 2 })!.text).toBe(
      "$1,234.50",
    );
    expect(formatNumberCell(-1234, "number", { negative: "red_parens" })).toMatchObject({
      text: "(1,234)",
      red: true,
    });
    expect(
      formatNumberCell(0.125, "percent", { style: "percent", percentInput: "fraction" })!.text,
    ).toBe("12.5%");
    expect(formatNumberCell(12345, "number", { style: "plain" })!.text).toBe("12345");
    expect(formatNumberCell("abc", "text", { style: "currency" })).toBeNull();
    // 999.6 shows as "$1,000" but the rule compares 999.6 (raw), so "< 1000" matches.
    const fmt = mergeColumnFormat(undefined, {
      number: { style: "currency", decimals: 0 },
      rules: [{ op: "lt", value: 1000, style: { color: "token:negative" } }],
    });
    expect(formatNumberCell(999.6, "currency", fmt.number)!.text).toBe("$1,000");
    expect(cellRuleStyle(fmt, () => 999.6)).toEqual({ color: "token:negative" });
  });

  it("survives save, reopen, regeneration, reorder, relabel, field repair; deleted columns go stale", async () => {
    const created = await createReport({
      spec: groupedSpec(),
      ownerId: ADMIN_ID,
      authorKind: "user",
      summary: "x",
    });
    const priceId =
      created.spec.widgets[0]!.type === "table" ? created.spec.widgets[0]!.columns[1]!.id! : "";
    expect(priceId).toBe("job_projectedprice");
    let spec = applyReportOps(created.spec, [
      {
        op: "set_column_format",
        id: "t",
        column: priceId,
        format: {
          number: { style: "currency", decimals: 0 },
          header: { background: "#1f6feb", bold: true },
        },
      },
    ]);
    expect(spec.ok).toBe(true);
    const saved = await saveReportVersion({
      report: created,
      spec: (spec as { spec: ReportSpec }).spec,
      authorId: ADMIN_ID,
      authorKind: "user",
      summary: "format",
    });
    const reopened = (await getReport(saved.report.id))!;
    const table = () =>
      reopened.spec.widgets[0] as Extract<ReportSpec["widgets"][number], { type: "table" }>;
    expect(table().appearance?.columnFormats?.[priceId]?.number?.style).toBe("currency");
    // Dexter regenerates the columns (no ids), reordered and relabeled.
    spec = applyReportOps(reopened.spec, [
      {
        op: "update_widget",
        id: "t",
        changes: {
          columns: [
            { field: "job.projectedPrice", label: "Contract price" },
            { field: "job.name" },
            { field: `cf:${F.sqft}`, label: "Sq ft" },
          ],
          appearance: { zebra: true },
        },
      },
    ]);
    expect(spec.ok).toBe(true);
    let t = (spec as { spec: ReportSpec }).spec.widgets[0] as ReturnType<typeof table>;
    expect(t.columns[0]!.id).toBe(priceId);
    expect(t.appearance?.columnFormats?.[priceId]?.header?.bold).toBe(true); // appearance merged
    expect(t.appearance?.zebra).toBe(true);
    // Field repair rewrites the ref; the column keeps its id and formatting.
    const repaired = replaceRefs((spec as { spec: ReportSpec }).spec, {
      "job.projectedPrice": "job.projectedCost",
    });
    t = repaired.spec.widgets[0] as ReturnType<typeof table>;
    expect(t.columns.find((c) => c.id === priceId)!.field).toBe("job.projectedCost");
    expect(t.appearance?.columnFormats?.[priceId]).toBeDefined();
    // Removing the column leaves stale formatting that's reported and can be pruned.
    const removed = applyReportOps(repaired.spec, [
      { op: "update_widget", id: "t", changes: { columns: [{ field: "job.name" }] } },
    ]);
    expect(removed.ok).toBe(true);
    const removedSpec = (removed as { spec: ReportSpec }).spec;
    const findings = checkSpecIntegrity(removedSpec, await getFieldCatalog());
    expect(findings.some((f) => f.kind === "stale_config" && f.path.endsWith(priceId))).toBe(true);
    const pruned = applyReportOps(removedSpec, [{ op: "prune_column_formats", id: "t" }]);
    expect(
      ((pruned as { spec: ReportSpec }).spec.widgets[0] as ReturnType<typeof table>).appearance
        ?.columnFormats,
    ).toBeUndefined();
  });

  it("merges per-column appearance instead of dropping other columns' styles", () => {
    const s = groupedSpec({
      appearance: {
        columns: { "job.name": { align: "center" } },
        columnFormats: { job_name: { cell: { bold: true } } },
        rules: [{ field: "job.name", op: "not_blank", style: { emphasis: "bold" } }],
      },
    });
    const r = applyReportOps(s, [
      {
        op: "set_widget_appearance",
        id: "t",
        appearance: {
          columnFormats: { cf_cfsqft00001: { number: { decimals: 0 } } },
          columns: { [`cf:${F.sqft}`]: { align: "right" } },
        },
      },
    ]);
    expect(r.ok).toBe(true);
    const look = (
      (r as { spec: ReportSpec }).spec.widgets[0] as unknown as {
        appearance: Record<string, Record<string, unknown>>;
      }
    ).appearance;
    expect(Object.keys(look.columnFormats!).sort()).toEqual(["cf_cfsqft00001", "job_name"]);
    expect(Object.keys(look.columns!).sort()).toEqual(["cf:cfSqft00001", "job.name"]);
    expect(look.rules).toHaveLength(1);
  });

  it("never changes values, sorting, filters, or exports", async () => {
    const access = await getReportsAccess(admin);
    const plain = await executeReport({ spec: groupedSpec(), access });
    const styled = await executeReport({
      spec: groupedSpec({
        appearance: {
          columnFormats: {
            job_projectedprice: {
              number: { style: "percent", decimals: 4, negative: "parens" },
              hidden: true,
              pin: "left",
              rules: [{ op: "gt", value: 1, style: { background: "#ff0000" } }],
            },
          },
        },
      }),
      access,
    });
    const a = plain.widgets.t as TableResult;
    const b = styled.widgets.t as TableResult;
    expect(b.rows.map((r) => r.cells)).toEqual(a.rows.map((r) => r.cells));
    expect(b.groups).toEqual(a.groups);
    expect(b.totals).toEqual(a.totals);
  });

  it("lets Dexter format by name, surfaces ambiguity, and writes the editor's config", async () => {
    const report = await createReport({
      spec: reportSpecSchema.parse({
        title: "Two price columns",
        datasets: [{ id: "jobs", source: "jobs" }],
        widgets: [
          {
            id: "t",
            type: "table",
            dataset: "jobs",
            columns: [
              { field: "job.name" },
              { field: "job.projectedPrice", label: "Price" },
              { field: "job.projectedCost", label: "Price" },
            ],
          },
        ],
      }),
      ownerId: ADMIN_ID,
      authorKind: "user",
      summary: "x",
    });
    const ambiguous = await run("reports_format_column", {
      reportId: report.id,
      column: "Price",
      preset: "currency",
    });
    expect(ambiguous).toMatchObject({ saved: false, ambiguous: true });
    expect((await getReport(report.id))!.version).toBe(report.version);
    const done = await run("reports_format_column", {
      reportId: report.id,
      column: "job_projectedcost",
      preset: "negatives_red",
      format: { cell: { bold: true } },
    });
    expect(done).toMatchObject({ saved: true, column: "job_projectedcost" });
    const t = (await getReport(report.id))!.spec.widgets[0] as {
      appearance?: { columnFormats?: Record<string, unknown> };
    };
    expect(t.appearance?.columnFormats?.job_projectedcost).toEqual({
      number: { negative: "red_parens" },
      cell: { bold: true },
    });
    // Viewers who can't edit get a refusal, not a change.
    const refused = await run(
      "reports_format_column",
      { reportId: report.id, column: "job_name", preset: "emphasis" },
      employee,
    );
    expect(refused.saved).not.toBe(true);
    expect((await getReport(report.id))!.version).toBe(report.version + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("Phase 3 — drill-downs", () => {
  it("reconciles additive metrics, recomputes non-additive ones, and reports overlap", () => {
    const rows = [
      { id: "1", g: "A", s: "x", v: 10, tags: ["p"] },
      { id: "2", g: "A", s: "y", v: 30, tags: ["p", "q"] },
      { id: "3", g: "B", s: "x", v: 5, tags: ["q"] },
    ];
    const sum = reconcileChildren(rows, "s", { key: "v", mode: "sum" });
    expect(sum.reconciliation).toMatchObject({
      status: "reconciled",
      parent: 45,
      childrenTotal: 45,
    });
    const avg = reconcileChildren(rows, "s", { key: "v", mode: "avg" });
    expect(avg.reconciliation).toMatchObject({
      status: "recomputed",
      additive: false,
      childrenTotal: null,
    });
    expect(avg.reconciliation.parent).toBe(15);
    const pct = reconcileChildren(rows, "s", { key: "v", mode: "sum", type: "percent" });
    expect(pct.reconciliation.additive).toBe(false);
    const overlap = reconcileChildren(rows, "tags", { key: "v", mode: "sum" });
    expect(overlap.reconciliation).toMatchObject({ status: "overlap", overlap: 1 });
    expect(rowsAtPath(rows, ["g", "s"], ["A", "y"]).map((r) => r.id)).toEqual(["2"]);
  });

  it("matches the table's subtotal, keeps filters, and pages on the server", async () => {
    const access = await getReportsAccess(admin);
    const spec = reportSpecSchema.parse({
      ...groupedSpec(),
      controls: [
        {
          id: "city",
          kind: "select",
          label: "City",
          field: "job.city",
          datasets: ["jobs"],
        },
      ],
    });
    const state = { city: ["Testville"] };
    const table = (await executeReport({ spec, access, state })).widgets.t as TableResult;
    const design = table.groups!.find((g) => g.label === "BR-Design")!;
    const d = await drillGroup({
      spec,
      access,
      state,
      widgetId: "t",
      path: ["BR-Design"],
      columnId: "job_projectedprice",
    });
    expect(d.metric!.value).toBe(design.values["job.projectedPrice"]);
    expect(d.reconciliation!.status).toBe("reconciled");
    expect(d.breadcrumbs).toEqual([
      { field: `cf:${F.phase}`, fieldLabel: "Phase", label: "BR-Design" },
    ]);
    expect(d.next?.fieldLabel).toBe("Project Manager");
    expect(d.filters.join(" ")).toMatch(/City: Testville/);
    expect(d.records.total).toBe(design.count);
    expect(
      d.records.rows.every((r) => r.jobtreadUrl?.startsWith("https://app.jobtread.com/jobs/")),
    ).toBe(true);
    // Deeper path + paging.
    const all = await drillGroup({
      spec: groupedSpec(),
      access,
      widgetId: "t",
      path: ["BR-Permitting"],
      limit: 1,
    });
    expect(all.records.total).toBe(2);
    expect(all.records.rows).toHaveLength(1);
    const page2 = await drillGroup({
      spec: groupedSpec(),
      access,
      widgetId: "t",
      path: ["BR-Permitting"],
      offset: 1,
      limit: 1,
    });
    expect(page2.records.rows[0]!.id).not.toBe(all.records.rows[0]!.id);
    const leaf = await drillGroup({
      spec: groupedSpec(),
      access,
      widgetId: "t",
      path: ["BR-Design", "Maxx"],
    });
    expect(leaf.records.rows.map((r) => r.id)).toEqual([JOBS[0]!.id]);
    expect(leaf.next).toBeNull();
  });

  it("shows the formula of a calculated column and never sums it", async () => {
    const spec = reportSpecSchema.parse({
      ...groupedSpec(),
      calculations: [
        {
          key: "margin_pct",
          label: "Margin %",
          source: "jobs",
          basis: "aggregate",
          formula:
            "(SUM(job.projectedPrice) - SUM(job.projectedCost)) / SUM(job.projectedPrice) * 100",
          type: "percent",
        },
      ],
      widgets: [
        {
          ...groupedSpec().widgets[0],
          columns: [{ field: "job.name" }, { field: "calc:margin_pct" }],
        },
      ],
    });
    const d = await drillGroup({
      spec,
      access: await getReportsAccess(admin),
      widgetId: "t",
      path: ["BR-Design"],
      columnId: "calc_margin_pct",
    });
    expect(d.metric!.formula).toMatch(/SUM\(job.projectedPrice\)/);
    expect(d.reconciliation).toMatchObject({ additive: false, status: "recomputed" });
    // (700k - 510k) / 700k
    expect(Number(d.metric!.value)).toBeCloseTo(((700_000 - 510_000) / 700_000) * 100, 4);
  });

  it("enforces field access and report permissions on drills", async () => {
    const access = await getReportsAccess(employee);
    await expect(
      drillGroup({
        spec: groupedSpec(),
        access,
        widgetId: "t",
        path: ["BR-Design"],
        columnId: "job_projectedprice",
      }),
    ).rejects.toThrow(/isn't available to you/);
    const d = await drillGroup({ spec: groupedSpec(), access, widgetId: "t", path: ["BR-Design"] });
    expect(d.records.columns.some((c) => c.key.startsWith("job.projected"))).toBe(false);
    expect(Object.keys(d.records.subtotals).some((k) => k.startsWith("job.projected"))).toBe(false);
    // A private report isn't visible (or drillable) to someone it isn't shared with.
    const priv = await createReport({
      spec: groupedSpec(),
      ownerId: ADMIN_ID,
      authorKind: "user",
      summary: "x",
    });
    await expect(loadReportFor(priv.id, employee, access)).rejects.toThrow(/not found/i);
    // Drafts are accepted only from editors.
    expect(() => drillSpec(priv, { canEdit: false }, groupedSpec())).toThrow(/can't preview/);
    expect(drillSpec(priv, { canEdit: true }, groupedSpec()).title).toBe("Pipeline by phase");
    // Drill can be switched off in the builder.
    await expect(
      drillGroup({
        spec: groupedSpec({ drill: { enabled: false } }),
        access,
        widgetId: "t",
        path: ["BR-Design"],
      }),
    ).rejects.toThrow(/turned off/);
  });

  it("drills into related records only through a real relationship", async () => {
    await requestEntitySync({ entities: ["cost_groups", "cost_items"], triggeredBy: "test" });
    await drainJobs();
    invalidate();
    const spec = groupedSpec({ drill: { related: "jobs.cost_items" } });
    const d = await drillGroup({
      spec,
      access: await getReportsAccess(admin),
      widgetId: "t",
      path: ["BR-Design"],
    });
    expect(d.records.source).toBe("cost_items");
    expect(d.records.total).toBeGreaterThan(0);
    const designJobs = new Set([JOBS[0]!.id, JOBS[1]!.id]);
    const rows = await agentDb().select<{ id: string; job_id: string | null }>("jt_cost_items");
    const expected = rows.filter((r) => r.job_id && designJobs.has(r.job_id)).length;
    expect(d.records.total).toBe(expected);
    // A relationship that doesn't start from the table's source is rejected when saving…
    const bad = parseReportSpec({
      ...groupedSpec(),
      widgets: [{ ...groupedSpec().widgets[0], drill: { related: "catalog_models.cost_items" } }],
    });
    expect(bad.ok).toBe(false);
    // …and Dexter explains an unavailable relationship instead of guessing.
    const report = await createReport({
      spec: groupedSpec(),
      ownerId: ADMIN_ID,
      authorKind: "user",
      summary: "x",
    });
    const explained = await run("reports_drill", {
      reportId: report.id,
      widgetId: "t",
      path: ["BR-Design"],
      related: "daily logs",
    });
    expect(explained).toMatchObject({ ok: false, relationshipUnavailable: true });
    expect(String(explained.problem)).toMatch(/no stable-id relationship/);
    const ok = await run("reports_drill", {
      reportId: report.id,
      widgetId: "t",
      path: ["BR-Design"],
      column: "Sq ft",
    });
    expect((ok.records as { total: number }).total).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe("Phase 4 — integrity and saved-report regressions", () => {
  it("passes integrity on a healthy grouped report and catches broken configs", async () => {
    const report = await createReport({
      spec: groupedSpec(),
      ownerId: ADMIN_ID,
      authorKind: "user",
      summary: "x",
    });
    const healthy = await auditReportIntegrity({
      spec: report.spec,
      access: await getReportsAccess(admin),
    });
    expect(healthy.ok).toBe(true);
    expect(healthy.findings.filter((f) => f.kind === "reconciliation_failure")).toEqual([]);
    const broken = groupedSpec({
      appearance: {
        columnFormats: {
          ghost: { cell: { bold: true } },
          job_name: {
            rules: [{ column: "missing_col", op: "blank", style: { color: "token:negative" } }],
          },
        },
      },
    });
    const kinds = checkSpecIntegrity(broken, await getFieldCatalog(), {
      rawSpec: {
        widgets: [
          {
            id: "t",
            columns: [
              { id: "dup", field: "job.name" },
              { id: "dup", field: "job.number" },
            ],
          },
        ],
      },
    }).map((f) => f.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["stale_config", "invalid_column_id", "column_collision"]),
    );
    const missing = checkSpecIntegrity(
      reportSpecSchema.parse({
        ...groupedSpec(),
        widgets: [{ ...groupedSpec().widgets[0], columns: [{ field: "cf:nope000001" }] }],
      }),
      await getFieldCatalog(),
    );
    expect(missing.some((f) => f.kind === "missing_mapping")).toBe(true);
  });

  it("detects reconciliation failures and unauthorized columns in results", () => {
    const spec = groupedSpec();
    const bad = {
      widgets: {
        t: {
          id: "t",
          kind: "table",
          status: "ok",
          columns: [
            {
              key: "job.projectedPrice",
              label: "Price",
              type: "currency",
              origin: "x",
              columnId: "job_projectedprice",
            },
          ],
          rows: [],
          totalRows: 2,
          truncated: false,
          totals: { "job.projectedPrice": 999 },
          groups: [
            {
              id: '["A"]',
              level: 0,
              field: "f",
              fieldLabel: "F",
              label: "A",
              count: 2,
              values: { "job.projectedPrice": 100 },
              children: [
                {
                  id: '["A","x"]',
                  level: 1,
                  field: "g",
                  fieldLabel: "G",
                  label: "x",
                  count: 1,
                  values: { "job.projectedPrice": 30 },
                  children: [],
                  rowIds: [],
                },
              ],
              rowIds: [],
            },
          ],
        },
      },
    } as never;
    const findings = checkResultIntegrity(spec, bad, { allowedKeys: new Set(["job.name"]) });
    expect(
      findings.filter((f) => f.kind === "reconciliation_failure" && f.severity === "error"),
    ).toHaveLength(2);
    expect(findings.some((f) => f.kind === "unauthorized_access")).toBe(true);
  });

  it("loads legacy saved reports (no column ids) with stable ids and identical results", async () => {
    const legacy = groupedSpec();
    const stripped = {
      ...legacy,
      widgets: legacy.widgets.map((w) =>
        w.type === "table" ? { ...w, columns: w.columns.map(({ id: _id, ...c }) => c) } : w,
      ),
    };
    const report = await createReport({
      spec: legacy,
      ownerId: ADMIN_ID,
      authorKind: "user",
      summary: "x",
    });
    await agentDb().update("bi_reports", [eq("id", report.id)], { spec: stripped });
    const raw = (await getReportRaw(report.id))!;
    expect(
      (raw.spec.widgets[0] as { columns: Array<{ id?: string }> }).columns[0]!.id,
    ).toBeUndefined();
    const loaded = (await getReport(report.id))!;
    const again = (await getReport(report.id))!;
    expect(loaded.spec).toEqual(again.spec); // deterministic
    expect(
      (loaded.spec.widgets[0] as { columns: Array<{ id?: string }> }).columns.map((c) => c.id),
    ).toEqual(["job_name", "job_projectedprice", "cf_cfsqft00001"]);
    const access = await getReportsAccess(admin);
    const before = (await executeReport({ spec: stripped as ReportSpec, access })).widgets
      .t as TableResult;
    const after = (await executeReport({ spec: loaded.spec, access })).widgets.t as TableResult;
    expect(after.rows.map((r) => r.cells)).toEqual(before.rows.map((r) => r.cells));
    expect(after.totals).toEqual(before.totals);
    // Re-parsing a parsed spec is stable (no spurious versions on save).
    expect(JSON.stringify(reportSpecSchema.parse(JSON.parse(JSON.stringify(loaded.spec))))).toBe(
      JSON.stringify(reportSpecSchema.parse(loaded.spec)),
    );
  });

  it("keeps every built-in template valid, executable, and free of integrity errors", async () => {
    const access = await getReportsAccess(admin);
    for (const t of REPORT_TEMPLATES) {
      const parsed = parseReportSpec(t.spec);
      expect(parsed.ok, t.key).toBe(true);
      if (!parsed.ok) continue;
      const r = await auditReportIntegrity({ spec: parsed.spec, access });
      expect(
        r.findings.filter((f) => f.severity === "error" && f.kind !== "missing_mapping"),
        t.key,
      ).toEqual([]);
    }
  });
});
