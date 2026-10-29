/**
 * Business-rule lifecycle: rule-set scope and ownership, report bindings, template / duplicate /
 * delete behaviour, rate lifecycle (end, void, correct, restore, hard delete), permissions,
 * idempotency, optimistic concurrency, and Dexter's tools. All data is synthetic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAccessPolicy } from "@/lib/agents/admin";
import { getResolvedAgent } from "@/lib/agents/registry";
import { agentDb, eq } from "@/lib/agents/store";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { runFullSync } from "@/lib/jobtread/sync";
import { getReportsAccess } from "@/lib/reports/access";
import { executeReport } from "@/lib/reports/engine";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import {
  createReport,
  deleteReport,
  duplicateReport,
  ensureReportTemplates,
  getReport,
  resetReportTemplatesForTests,
  saveReportVersion,
  type ReportRow,
} from "@/lib/reports/repo";
import type { KpiResult, RuleEditorResult, TableResult } from "@/lib/reports/result-types";
import {
  auditRuleSets,
  copyRuleSet,
  listBindingsForReport,
  listConsumers,
} from "@/lib/reports/rule-bindings";
import {
  RulePermissionError,
  runRateOperation,
  runReportRulesOperation,
  runRuleSetOperation,
  type RuleCaller,
} from "@/lib/reports/rule-operations";
import { ruleSetKeysIn, templateSafeSpec, TEMPLATE_RULE_SET_KEY } from "@/lib/reports/rule-scope";
import {
  assignProject,
  auditLabel,
  createRuleSet,
  findOverlaps,
  getRuleSet,
  listRates,
  listRuleChanges,
  rateState,
  requireRuleSet,
  ruleActor,
  setRate,
  type RuleSetRow,
  type StoredRate,
} from "@/lib/reports/rules";
import { reportSpecSchema, type ReportSpec } from "@/lib/reports/spec";
import { SALES_COMMISSIONS_TEMPLATE } from "@/lib/reports/templates";
import { ADMIN_ID, EMPLOYEE_ID, HR_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const editor = requester(EMPLOYEE_ID, "user", "Eli Employee");
const viewer = requester(HR_ID, "user", "Harper HR");
const adminActor = ruleActor("Avery Admin", ADMIN_ID, "ui");
const JOB1 = "job00000001"; // approved order: gross profit 90,000
const KORNILOV = "job00000002"; // draft order: gross profit 100,000

async function caller(r: Requester, via: RuleCaller["via"] = "ui"): Promise<RuleCaller> {
  return { access: await getReportsAccess(r), requester: r, via };
}

async function grant(userId: string, levels: string[]) {
  const dexter = (await getResolvedAgent("dexter"))!;
  for (const accessLevel of levels)
    await addAccessPolicy({
      agentId: dexter.row.id,
      principalType: "user",
      principalValue: userId,
      accessLevel: accessLevel as never,
      actor: { userId: ADMIN_ID, label: "Avery Admin" },
    });
}

const toolCtx = (r: Requester, taskId = "00000000-0000-4000-8000-0000000000a1") => ({
  task: { id: taskId, allowed_context: {} } as never,
  agent: {} as never,
  requester: r,
  access: new Set<never>(),
});
const dexter = async (r: Requester, args: Record<string, unknown>, taskId?: string) =>
  (await getTool("reports_rules")!.execute(toolCtx(r, taskId), args)).data as Record<
    string,
    unknown
  >;

async function commissionTemplate(): Promise<ReportRow> {
  await ensureReportTemplates();
  const [row] = await agentDb().select<ReportRow>("bi_reports", {
    filters: [eq("template_key", "sales_commissions")],
  });
  return row!;
}

const keyOf = (r: ReportRow) => r.spec.datasets.find((d) => d.source === "commissions")!.ruleSet!;
const rsOf = async (r: ReportRow) => (await getRuleSet(keyOf(r)))!;

function commissionSpec(title: string, key: string): ReportSpec {
  return reportSpecSchema.parse({
    title,
    datasets: [{ id: "c", source: "commissions", ruleSet: key }],
    widgets: [
      {
        id: "total",
        type: "kpi",
        title: "Total",
        dataset: "c",
        metric: { op: "sum", field: "com.commission" },
      },
      { id: "rates", type: "rate_editor", title: "Rates", ruleSet: key },
    ],
  });
}

/** Latest change with this action (the test clock is frozen, so look up by action). */
async function lastChange(ruleSetId: string, action: string) {
  return (await listRuleChanges(ruleSetId, 500)).filter((c) => c.action === action).at(-1);
}

/** The three rows from the incident, on one rule set. */
async function incidentRates(rs: RuleSetRow) {
  await setRate({
    ruleSet: rs,
    salesperson: "Connor",
    ratePct: 5,
    effectiveFrom: "2026-10-23",
    actor: adminActor,
  });
  await setRate({
    ruleSet: rs,
    salesperson: "Kevin",
    jobId: KORNILOV,
    ratePct: 5,
    effectiveFrom: "2026-10-23",
    actor: adminActor,
  });
  await setRate({
    ruleSet: rs,
    salesperson: "Kevin",
    jobId: KORNILOV,
    ratePct: 5,
    effectiveFrom: "2026-10-29",
    actor: adminActor,
  });
}

/** A rule set as it existed before migration 081: shared by key, ownership unknown. */
async function legacySharedRuleSet(): Promise<RuleSetRow> {
  const rs = await createRuleSet({
    name: "Sales commissions",
    key: "sales_commissions",
    scope: "company",
    actor: adminActor,
  });
  await agentDb().update("bi_rule_sets", [eq("id", rs.id)], { needs_review: true });
  return (await getRuleSet("sales_commissions"))!;
}

/** A pre-081 report row: references a rule set by key, no binding. */
async function legacyReport(title: string, key: string): Promise<ReportRow> {
  const spec = commissionSpec(title, key);
  const [row] = await agentDb().insert<ReportRow>("bi_reports", {
    title,
    description: "",
    owner_id: ADMIN_ID,
    visibility: "company",
    is_template: false,
    template_key: null,
    status: "active",
    spec,
    version: 1,
    created_by_agent: false,
  });
  return row!;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T15:00:00Z"));
  await setupAgentTestEnv();
  resetReportTemplatesForTests();
  clearJobDetailCache();
  invalidateFieldCatalog();
  installFakePave();
  await runFullSync("test");
  invalidateFieldCatalog();
});
afterEach(() => {
  uninstallFakePave();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("rule-set references and rate states", () => {
  it("finds and rewrites every rule-set reference; templates point at the placeholder", () => {
    const spec = commissionSpec("X", "rs_abc");
    expect(ruleSetKeysIn(spec)).toEqual(["rs_abc"]);
    expect(ruleSetKeysIn(templateSafeSpec(spec))).toEqual([TEMPLATE_RULE_SET_KEY]);
    expect(ruleSetKeysIn(SALES_COMMISSIONS_TEMPLATE)).toEqual([TEMPLATE_RULE_SET_KEY]);
  });

  it("derives states and detects overlaps per salesperson and project scope", () => {
    const base = { status: "active" as const, salesperson: "Kevin", job_id: null };
    const rates = [
      { ...base, id: "a", effective_from: "2026-01-01", effective_to: "2026-06-30" },
      { ...base, id: "b", effective_from: "2026-07-01", effective_to: null },
      { ...base, id: "c", job_id: KORNILOV, effective_from: "2026-01-01", effective_to: null },
      {
        ...base,
        id: "d",
        status: "voided" as const,
        effective_from: "2026-01-01",
        effective_to: null,
      },
    ];
    const ids = (c: Parameters<typeof findOverlaps>[1]) => findOverlaps(rates, c).map((r) => r.id);
    expect(
      ids({
        salesperson: "kevin ",
        job_id: null,
        effective_from: "2026-06-01",
        effective_to: "2026-07-15",
      }),
    ).toEqual(["a", "b"]);
    expect(
      ids({
        salesperson: "Kevin",
        job_id: null,
        effective_from: "2025-01-01",
        effective_to: "2025-12-31",
      }),
    ).toEqual([]);
    expect(
      ids({
        salesperson: "Kevin",
        job_id: KORNILOV,
        effective_from: "2026-03-01",
        effective_to: null,
      }),
    ).toEqual(["c"]);
    const today = "2026-10-29";
    expect(
      rateState({ status: "active", effective_from: "2026-11-01", effective_to: null }, today),
    ).toBe("scheduled");
    expect(
      rateState(
        { status: "active", effective_from: "2026-01-01", effective_to: "2026-10-28" },
        today,
      ),
    ).toBe("ended");
    expect(
      rateState({ status: "active", effective_from: "2026-01-01", effective_to: null }, today),
    ).toBe("current");
    expect(
      rateState({ status: "voided", effective_from: "2026-01-01", effective_to: null }, today),
    ).toBe("voided");
  });

  it("words audit entries as 'performed using [account], via [channel]'", () => {
    expect(auditLabel("Avery Admin", "ui")).toBe("performed using Avery Admin, via UI");
    expect(auditLabel("Avery Admin", "dexter")).toBe("performed using Avery Admin, via Dexter");
    expect(auditLabel("Baxter system", "system")).toBe("performed using Baxter system, via system");
  });
});

// ---------------------------------------------------------------------------
// Root cause regression: delete a dashboard, create a new one
// ---------------------------------------------------------------------------

describe("new dashboards never inherit another dashboard's rates", () => {
  it("delete old commission dashboard → new one from the template starts empty", async () => {
    const template = await commissionTemplate();
    expect(ruleSetKeysIn(template.spec)).toEqual([TEMPLATE_RULE_SET_KEY]);
    // No shared rule set is created for the template any more.
    expect(await getRuleSet("sales_commissions")).toBeNull();

    const oldDash = await duplicateReport(template, ADMIN_ID, "Old commissions", {
      ruleActor: adminActor,
    });
    const oldRs = await rsOf(oldDash);
    expect(oldRs).toMatchObject({ scope: "dashboard", owner_report_id: oldDash.id });
    expect(oldRs.key).toMatch(/^rs_[0-9a-f]{16}$/);
    await incidentRates(oldRs);

    const released = await deleteReport(oldDash, { ruleActor: adminActor });
    expect(released).toMatchObject({ detached: [oldRs.id], archived: [], leftUnused: [oldRs.key] });

    const newDash = await duplicateReport(template, EMPLOYEE_ID, "Sales Commissions", {
      ruleActor: adminActor,
    });
    const newRs = await rsOf(newDash);
    expect(newRs.id).not.toBe(oldRs.id);
    expect(await listRates(newRs.id)).toEqual([]);
    const [binding] = await listBindingsForReport(newDash.id);
    expect(binding).toMatchObject({ mode: "created_empty", rule_set_id: newRs.id });

    const result = await executeReport({
      spec: newDash.spec,
      access: await getReportsAccess(admin),
    });
    const rows = (result.widgets.rates as RuleEditorResult) ?? null;
    expect(rows).toMatchObject({ status: "ok", ruleSet: newRs.key });
    expect(
      (result.widgets.details as TableResult).rows.every((r) => r.cells["com.ratePct"] == null),
    ).toBe(true);

    // The old rule set is kept (history intact) and reported as unused.
    const audit = await auditRuleSets();
    expect(audit.find((a) => a.key === oldRs.key)).toMatchObject({
      orphaned: true,
      activeRates: 3,
    });
    expect(
      (await listRuleChanges(oldRs.id)).some(
        (c) => c.entity === "binding" && c.action === "detached",
      ),
    ).toBe(true);
  });

  it("archives the private rule set with the dashboard only when asked", async () => {
    const template = await commissionTemplate();
    const dash = await duplicateReport(template, ADMIN_ID, "Short-lived", {
      ruleActor: adminActor,
    });
    const rs = await rsOf(dash);
    const released = await deleteReport(dash, { archivePrivateRules: true, ruleActor: adminActor });
    expect(released.archived).toEqual([rs.key]);
    expect((await getRuleSet(rs.key))!.status).toBe("archived");
    expect(await listRuleChanges(rs.id)).not.toHaveLength(0); // history kept
  });

  it("an old template row that still names a live rule set runs with no rates", async () => {
    const legacy = await legacySharedRuleSet();
    await incidentRates(legacy);
    const template = await commissionTemplate();
    await agentDb().update("bi_reports", [eq("id", template.id)], {
      spec: {
        ...template.spec,
        datasets: [
          {
            id: "commissions",
            source: "commissions",
            label: "Commissions",
            ruleSet: "sales_commissions",
            filters: [],
          },
        ],
      },
    });
    const stale = (await getReport(template.id))!;
    const dash = await duplicateReport(stale, EMPLOYEE_ID, undefined, { ruleActor: adminActor });
    expect(keyOf(dash)).not.toBe("sales_commissions");
    expect(await listRates((await rsOf(dash)).id)).toEqual([]);
    const run = await executeReport({
      spec: templateSafeSpec(stale.spec),
      access: await getReportsAccess(admin),
    });
    expect((run.widgets.total_commission as KpiResult).value).toBeNull();
    // An admin saving the template can't point it at a live rule set.
    const saved = await saveReportVersion({
      report: stale,
      spec: { ...stale.spec, description: "Edited" },
      authorId: ADMIN_ID,
      authorKind: "user",
    });
    expect(ruleSetKeysIn(saved.report.spec)).toEqual([TEMPLATE_RULE_SET_KEY]);
  });
});

// ---------------------------------------------------------------------------
// Ownership and binding rules
// ---------------------------------------------------------------------------

describe("bindings and ownership", () => {
  it("rejects silently sharing a company rule set or another dashboard's rule set", async () => {
    const legacy = await legacySharedRuleSet();
    await expect(
      createReport({
        spec: commissionSpec("Mine", legacy.key),
        ownerId: EMPLOYEE_ID,
        authorKind: "user",
      }),
    ).rejects.toThrow(/shared company rule set\. Choose deliberately/);
    const shared = await createReport({
      spec: commissionSpec("Mine", legacy.key),
      ownerId: EMPLOYEE_ID,
      authorKind: "user",
      ruleChoices: { attachShared: [legacy.key] },
    });
    expect((await listBindingsForReport(shared.id))[0]).toMatchObject({ mode: "attached_shared" });

    const template = await commissionTemplate();
    const a = await duplicateReport(template, ADMIN_ID, "A", { ruleActor: adminActor });
    await expect(
      createReport({
        spec: commissionSpec("B", keyOf(a)),
        ownerId: EMPLOYEE_ID,
        authorKind: "user",
      }),
    ).rejects.toThrow(/belongs to another dashboard/);
    // Nothing half-made was left behind.
    expect(
      (await agentDb().select<ReportRow>("bi_reports", {})).filter((r) => r.title === "B"),
    ).toHaveLength(0);
  });

  it("records legacy references as bindings flagged for review, without re-owning them", async () => {
    const legacy = await legacySharedRuleSet();
    await incidentRates(legacy);
    const old1 = await legacyReport("Commissions (old)", legacy.key);
    const old2 = await legacyReport("Commissions (new)", legacy.key);
    const consumers = await listConsumers(legacy);
    expect(consumers.map((c) => [c.title, c.mode])).toEqual([
      ["Commissions (old)", null],
      ["Commissions (new)", null],
    ]);
    await saveReportVersion({
      report: old2,
      spec: { ...old2.spec, description: "touched" },
      authorId: ADMIN_ID,
      authorKind: "user",
    });
    expect((await listBindingsForReport(old2.id))[0]).toMatchObject({
      mode: "migrated_legacy",
      needs_review: true,
    });
    expect((await getRuleSet(legacy.key))!).toMatchObject({
      scope: "company",
      owner_report_id: null,
      needs_review: true,
    });
    const entry = (await auditRuleSets()).find((e) => e.key === legacy.key)!;
    expect(entry).toMatchObject({ legacy: true, needsReview: true, activeRates: 3 });
    expect(entry.findings.join(" ")).toMatch(/Shared by 2 reports without a deliberate choice/);
    void old1;
  });

  it("duplicates copy rules by default; sharing needs an explicit choice and a company rule set", async () => {
    const template = await commissionTemplate();
    const a = await duplicateReport(template, ADMIN_ID, "A", { ruleActor: adminActor });
    const aRs = await rsOf(a);
    await setRate({
      ruleSet: aRs,
      salesperson: "Connor",
      ratePct: 4,
      effectiveFrom: "2026-01-01",
      actor: adminActor,
    });
    await assignProject({
      ruleSet: aRs,
      jobId: JOB1,
      salesperson: "Connor",
      paymentDate: "2026-05-01",
      actor: adminActor,
    });

    const copy = await duplicateReport(a, ADMIN_ID, undefined, { ruleActor: adminActor });
    const copyRs = await rsOf(copy);
    expect(copyRs.id).not.toBe(aRs.id);
    expect(copyRs).toMatchObject({
      scope: "dashboard",
      copied_from_rule_set_id: aRs.id,
      status: "active",
      owner_report_id: copy.id,
    });
    expect((await listBindingsForReport(copy.id))[0]!.mode).toBe("copied");
    const [copiedRate] = await listRates(copyRs.id);
    expect(copiedRate).toMatchObject({
      rate_pct: 4,
      copied_from_rate_id: (await listRates(aRs.id))[0]!.id,
    });
    // Independent: changing the copy leaves the original alone.
    await setRate({
      ruleSet: copyRs,
      salesperson: "Connor",
      ratePct: 9,
      effectiveFrom: "2026-06-01",
      actor: adminActor,
    });
    expect((await listRates(aRs.id)).map((r) => Number(r.rate_pct))).toEqual([4]);

    await expect(
      duplicateReport(a, ADMIN_ID, undefined, { rules: "share", ruleActor: adminActor }),
    ).rejects.toThrow(/can't be shared/);
    const empty = await duplicateReport(a, ADMIN_ID, undefined, {
      rules: "empty",
      ruleActor: adminActor,
    });
    expect(await listRates((await rsOf(empty)).id)).toEqual([]);

    const legacy = await legacySharedRuleSet();
    const legacyDash = await createReport({
      spec: commissionSpec("Shared", legacy.key),
      ownerId: ADMIN_ID,
      authorKind: "user",
      ruleChoices: { attachShared: [legacy.key] },
    });
    const sharedDup = await duplicateReport(legacyDash, ADMIN_ID, undefined, {
      rules: "share",
      ruleActor: adminActor,
    });
    expect(keyOf(sharedDup)).toBe(legacy.key);
    expect((await listBindingsForReport(sharedDup.id))[0]!.mode).toBe("attached_shared");
  });

  it("a failed copy is archived and never usable; the duplicate leaves no report behind", async () => {
    const template = await commissionTemplate();
    const a = await duplicateReport(template, ADMIN_ID, "A", { ruleActor: adminActor });
    const aRs = await rsOf(a);
    await assignProject({ ruleSet: aRs, jobId: JOB1, salesperson: "Connor", actor: adminActor });
    const db = agentDb();
    const realInsert = db.insert.bind(db);
    vi.spyOn(db, "insert").mockImplementation(async (name, input) => {
      if (name === "bi_project_assignments") throw new Error("connection reset");
      return realInsert(name, input);
    });
    const before = (await agentDb().select("bi_reports", {})).length;
    await expect(duplicateReport(a, ADMIN_ID, "Copy", { ruleActor: adminActor })).rejects.toThrow(
      /connection reset/,
    );
    vi.restoreAllMocks();
    expect((await agentDb().select("bi_reports", {})).length).toBe(before);
    const copies = (await agentDb().select<RuleSetRow>("bi_rule_sets", {})).filter(
      (r) => r.copied_from_rule_set_id === aRs.id,
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ status: "archived" });
    await expect(
      createReport({
        spec: commissionSpec("Uses broken copy", copies[0]!.key),
        ownerId: ADMIN_ID,
        authorKind: "user",
      }),
    ).rejects.toThrow(/archived/);
  });

  it("refuses to archive a rule set a report uses, and to attach an archived one", async () => {
    const legacy = await legacySharedRuleSet();
    const dash = await createReport({
      spec: commissionSpec("Shared", legacy.key),
      ownerId: ADMIN_ID,
      authorKind: "user",
      ruleChoices: { attachShared: [legacy.key] },
    });
    const adm = await caller(admin);
    await expect(
      runRuleSetOperation({
        caller: adm,
        ruleSetKey: legacy.key,
        op: { type: "archive", reason: "cleanup" },
      }),
    ).rejects.toThrow(/Still used by 1 report/);
    await deleteReport(dash, { ruleActor: adminActor });
    await runRuleSetOperation({
      caller: adm,
      ruleSetKey: legacy.key,
      op: { type: "archive", reason: "No longer used" },
    });
    await expect(
      createReport({
        spec: commissionSpec("Late attach", legacy.key),
        ownerId: ADMIN_ID,
        authorKind: "user",
        ruleChoices: { attachShared: [legacy.key] },
      }),
    ).rejects.toThrow(/archived/);
  });
});

// ---------------------------------------------------------------------------
// Report-level choices
// ---------------------------------------------------------------------------

describe("start empty, copy, attach, detach on a dashboard", () => {
  it("detaches the shared legacy rule set and starts the dashboard empty (dry run first)", async () => {
    const legacy = await legacySharedRuleSet();
    await incidentRates(legacy);
    const dash = await legacyReport("Sales Commissions", legacy.key);
    const adm = await caller(admin);
    const dry = await runReportRulesOperation({
      caller: adm,
      reportId: dash.id,
      op: { type: "detach", key: legacy.key, reason: "Was shared by accident" },
      dryRun: true,
    });
    expect(dry.dryRun).toBe(true);
    expect((await getReport(dash.id))!.version).toBe(1);
    expect(dry.preview!.current).toMatchObject({
      key: legacy.key,
      attachedAs: "Not recorded (legacy)",
    });

    const res = await runReportRulesOperation({
      caller: adm,
      reportId: dash.id,
      op: { type: "detach", key: legacy.key, reason: "Was shared by accident" },
      expectedVersion: 1,
      idempotencyKey: "detach-0001",
    });
    const after = (await getReport(dash.id))!;
    expect(keyOf(after)).not.toBe(legacy.key);
    expect(res.result).toMatchObject({ reportVersion: 2 });
    expect(await listRates((await rsOf(after)).id)).toEqual([]);
    // The legacy rule set and its three rates are untouched.
    expect(await listRates(legacy.id)).toHaveLength(3);
    // Retrying with the same key replays instead of making another empty rule set.
    const again = await runReportRulesOperation({
      caller: adm,
      reportId: dash.id,
      op: { type: "detach", key: legacy.key, reason: "Was shared by accident" },
      expectedVersion: 1,
      idempotencyKey: "detach-0001",
    });
    expect(again.replayed).toBe(true);
    expect((await getReport(dash.id))!.version).toBe(2);
  });

  it("attach needs a company rule set, explicit confirmation, and edit permission on the report", async () => {
    const legacy = await legacySharedRuleSet();
    const template = await commissionTemplate();
    const dash = await duplicateReport(template, ADMIN_ID, "Mine", { ruleActor: adminActor });
    const adm = await caller(admin);
    await expect(
      runReportRulesOperation({
        caller: adm,
        reportId: dash.id,
        op: { type: "attach", key: legacy.key, confirmShared: false },
      }),
    ).rejects.toThrow(/Confirm that you want shared rules/);
    const other = await duplicateReport(template, ADMIN_ID, "Other", { ruleActor: adminActor });
    await expect(
      runReportRulesOperation({
        caller: adm,
        reportId: dash.id,
        op: { type: "attach", key: keyOf(other), confirmShared: true },
      }),
    ).rejects.toThrow(/belongs to one dashboard/);
    await runReportRulesOperation({
      caller: adm,
      reportId: dash.id,
      op: { type: "attach", key: legacy.key, confirmShared: true },
    });
    expect(keyOf((await getReport(dash.id))!)).toBe(legacy.key);

    // An editor with business-rule access but only view access to the report is refused.
    await grant(EMPLOYEE_ID, ["use_via_baxter", "financial_data", "business_rules"]);
    await agentDb().update("bi_reports", [eq("id", dash.id)], { visibility: "company" });
    const err = await runReportRulesOperation({
      caller: await caller(editor),
      reportId: dash.id,
      op: { type: "start_empty" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(RulePermissionError);
    expect(err).toMatchObject({ requiredPermission: "edit_report" });
  });

  it("rejects a stale report version (concurrent edit)", async () => {
    const template = await commissionTemplate();
    const dash = await duplicateReport(template, ADMIN_ID, "Mine", { ruleActor: adminActor });
    await saveReportVersion({
      report: dash,
      spec: { ...dash.spec, title: "Renamed meanwhile" },
      authorId: ADMIN_ID,
      authorKind: "user",
    });
    await expect(
      runReportRulesOperation({
        caller: await caller(admin),
        reportId: dash.id,
        op: { type: "start_empty" },
        expectedVersion: 1,
      }),
    ).rejects.toThrow(/changed since you opened it/);
  });
});

// ---------------------------------------------------------------------------
// Rate lifecycle
// ---------------------------------------------------------------------------

describe("rate lifecycle", () => {
  async function dashboardWithKevin() {
    const template = await commissionTemplate();
    const dash = await duplicateReport(template, ADMIN_ID, "Kevin", { ruleActor: adminActor });
    const rs = await rsOf(dash);
    await setRate({
      ruleSet: rs,
      salesperson: "Kevin",
      jobId: KORNILOV,
      ratePct: 5,
      effectiveFrom: "2026-10-01",
      actor: adminActor,
    });
    await assignProject({
      ruleSet: rs,
      jobId: KORNILOV,
      salesperson: "Kevin",
      paymentDate: "2026-10-25",
      actor: adminActor,
    });
    const [rate] = await listRates(rs.id);
    return { dash, rs, rate: rate! };
  }
  const total = async (spec: ReportSpec) =>
    (
      (await executeReport({ spec, access: await getReportsAccess(admin) })).widgets
        .total_commission as KpiResult
    ).value;

  it("dry runs change nothing and preview the exact commission impact", async () => {
    const { dash, rs, rate } = await dashboardWithKevin();
    expect(await total(dash.spec)).toBe(5000); // 100k × 5%
    const res = await runRateOperation({
      caller: await caller(admin),
      ruleSetKey: rs.key,
      op: { type: "void_rate", rateId: rate.id, reason: "Entered in error" },
      dryRun: true,
    });
    expect(res.dryRun).toBe(true);
    expect(res.preview.impact).toMatchObject({
      affectedRows: 1,
      payableAffected: 1,
      totalBefore: 5000,
      totalAfter: 0,
      rowsUsingRate: 1,
    });
    expect(res.preview.impactSummary).toMatch(/1 commission row\(s\) change/);
    expect(res.preview.warnings.join(" ")).toMatch(/already been in effect/);
    expect((await listRates(rs.id))[0]).toMatchObject({ status: "active", version: rate.version });
  });

  it("end on a date keeps history and stops the rate after that day", async () => {
    const { dash, rs, rate } = await dashboardWithKevin();
    const res = await runRateOperation({
      caller: await caller(admin),
      ruleSetKey: rs.key,
      op: {
        type: "end_rate",
        rateId: rate.id,
        endDate: "2026-10-24",
        reason: "Kevin moved teams",
        expectedVersion: rate.version,
      },
    });
    expect(res.rate).toMatchObject({ effectiveTo: "2026-10-24", status: "active" });
    expect(await total(dash.spec)).toBeNull(); // paid 10-25, no rate in effect then
    const change = await lastChange(rs.id, "ended");
    expect(change).toMatchObject({
      entity: "rate",
      action: "ended",
      reason: "Kevin moved teams",
      via: "ui",
      changed_by: ADMIN_ID,
      changed_by_label: "performed using Avery Admin, via UI",
      commissions_affected: true,
    });
    expect((change!.before as StoredRate).effective_to).toBeNull();
    expect((change!.after as StoredRate).effective_to).toBe("2026-10-24");
  });

  it("void removes a rate from calculations, keeps the row, and restore brings it back", async () => {
    const { dash, rs, rate } = await dashboardWithKevin();
    const adm = await caller(admin);
    await runRateOperation({
      caller: adm,
      ruleSetKey: rs.key,
      op: { type: "void_rate", rateId: rate.id, reason: "Wrong project" },
    });
    expect(await total(dash.spec)).toBeNull();
    const all = await listRates(rs.id, { includeInactive: true });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      status: "voided",
      void_reason: "Wrong project",
      voided_by_label: "performed using Avery Admin, via UI",
    });
    await runRateOperation({
      caller: adm,
      ruleSetKey: rs.key,
      op: { type: "restore_rate", rateId: rate.id, reason: "It was right after all" },
    });
    expect(await total(dash.spec)).toBe(5000);
  });

  it("correction supersedes the rate with a linked new version; overlaps are rejected", async () => {
    const { dash, rs, rate } = await dashboardWithKevin();
    const adm = await caller(admin);
    const res = await runRateOperation({
      caller: adm,
      ruleSetKey: rs.key,
      op: {
        type: "correct_rate",
        rateId: rate.id,
        changes: { ratePct: 6 },
        reason: "Agreed rate was 6%",
      },
    });
    const { previous, corrected } = res.rate as {
      previous: { status: string; supersededBy: string };
      corrected: { id: string; correctsRateId: string; ratePct: number };
    };
    expect(previous).toMatchObject({ status: "superseded", supersededBy: corrected.id });
    expect(corrected).toMatchObject({ correctsRateId: rate.id, ratePct: 6 });
    expect(await total(dash.spec)).toBe(6000);
    // Restoring the superseded original would overlap the correction.
    await expect(
      runRateOperation({
        caller: adm,
        ruleSetKey: rs.key,
        op: { type: "restore_rate", rateId: rate.id, reason: "undo" },
      }),
    ).rejects.toThrow(/overlap.*void the correction/);
    // Ending a rate can't extend it over a later one.
    await setRate({
      ruleSet: rs,
      salesperson: "Kevin",
      jobId: KORNILOV,
      ratePct: 7,
      effectiveFrom: "2026-12-01",
      actor: adminActor,
    });
    const current = (await listRates(rs.id)).find((r) => r.id === corrected.id)!;
    expect(current.effective_to).toBe("2026-11-30");
    await expect(
      runRateOperation({
        caller: adm,
        ruleSetKey: rs.key,
        op: { type: "end_rate", rateId: current.id, endDate: "2026-12-15", reason: "extend" },
      }),
    ).rejects.toThrow(/overlap/);
  });

  it("hard delete: administrators only, never-used rates only, explicit confirmation", async () => {
    const { rs, rate } = await dashboardWithKevin();
    const future = await setRate({
      ruleSet: rs,
      salesperson: "Connor",
      ratePct: 3,
      effectiveFrom: "2027-01-01",
      actor: adminActor,
    });
    const adm = await caller(admin);
    await grant(EMPLOYEE_ID, ["use_via_baxter", "financial_data", "business_rules"]);
    const denied = await runRateOperation({
      caller: await caller(editor),
      ruleSetKey: rs.key,
      op: { type: "delete_rate", rateId: future.id, reason: "typo", confirm: "DELETE" },
    }).catch((e) => e);
    expect(denied).toMatchObject({ requiredPermission: "admin" });

    const used = await runRateOperation({
      caller: adm,
      ruleSetKey: rs.key,
      op: { type: "delete_rate", rateId: rate.id, reason: "typo" },
      dryRun: true,
    });
    expect(used.preview).toMatchObject({ hardDeleteAllowed: false });
    expect(used.preview.hardDeleteBlockedBecause).toMatch(/has been in effect/);
    await expect(
      runRateOperation({
        caller: adm,
        ruleSetKey: rs.key,
        op: { type: "delete_rate", rateId: rate.id, reason: "typo", confirm: "DELETE" },
      }),
    ).rejects.toThrow(/Void it instead/);
    await expect(
      runRateOperation({
        caller: adm,
        ruleSetKey: rs.key,
        op: { type: "delete_rate", rateId: future.id, reason: "typo" },
      }),
    ).rejects.toThrow(/confirm "DELETE"/);
    await runRateOperation({
      caller: adm,
      ruleSetKey: rs.key,
      op: {
        type: "delete_rate",
        rateId: future.id,
        reason: "Typo, never applied",
        confirm: "DELETE",
      },
    });
    expect((await listRates(rs.id, { includeInactive: true })).map((r) => r.id)).toEqual([rate.id]);
    expect(await lastChange(rs.id, "hard_deleted")).toMatchObject({
      reason: "Typo, never applied",
    });
  });

  it("requires reasons, honors idempotency keys, and rejects stale versions", async () => {
    const { rs, rate } = await dashboardWithKevin();
    const adm = await caller(admin);
    await expect(
      runRateOperation({
        caller: adm,
        ruleSetKey: rs.key,
        op: { type: "void_rate", rateId: rate.id, reason: " " },
      }),
    ).rejects.toThrow(/needs a reason/);
    const first = await runRateOperation({
      caller: adm,
      ruleSetKey: rs.key,
      op: { type: "end_rate", rateId: rate.id, endDate: "2026-12-31", reason: "Year end" },
      idempotencyKey: "double-click-1",
    });
    const second = await runRateOperation({
      caller: adm,
      ruleSetKey: rs.key,
      op: { type: "end_rate", rateId: rate.id, endDate: "2026-12-31", reason: "Year end" },
      idempotencyKey: "double-click-1",
    });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect((await listRuleChanges(rs.id)).filter((c) => c.action === "ended")).toHaveLength(1);
    await expect(
      runRateOperation({
        caller: adm,
        ruleSetKey: rs.key,
        op: { type: "void_rate", rateId: rate.id, reason: "x-y-z" },
        idempotencyKey: "double-click-1",
      }),
    ).rejects.toThrow(/different change/);
    await expect(
      runRateOperation({
        caller: adm,
        ruleSetKey: rs.key,
        op: { type: "void_rate", rateId: rate.id, reason: "stale", expectedVersion: rate.version },
      }),
    ).rejects.toThrow(/changed since you opened it/);
  });

  it("setting a same-day rate supersedes (never deletes) the earlier row", async () => {
    const { rs, rate } = await dashboardWithKevin();
    await setRate({
      ruleSet: rs,
      salesperson: "Kevin",
      jobId: KORNILOV,
      ratePct: 5.5,
      effectiveFrom: "2026-10-01",
      actor: adminActor,
    });
    const all = await listRates(rs.id, { includeInactive: true });
    expect(all.map((r) => [r.id === rate.id, r.status, Number(r.rate_pct)])).toEqual([
      [true, "superseded", 5],
      [false, "active", 5.5],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

describe("permissions", () => {
  it("names the missing permission and the admin handoff", async () => {
    const legacy = await legacySharedRuleSet();
    await setRate({
      ruleSet: legacy,
      salesperson: "Connor",
      ratePct: 5,
      effectiveFrom: "2026-10-23",
      actor: adminActor,
    });
    const [rate] = await listRates(legacy.id);
    await grant(HR_ID, ["use_via_baxter"]);
    const noFinancial = await runRateOperation({
      caller: await caller(viewer),
      ruleSetKey: legacy.key,
      op: { type: "void_rate", rateId: rate!.id, reason: "x-y-z" },
    }).catch((e) => e);
    expect(noFinancial).toMatchObject({ requiredPermission: "view" });

    await grant(EMPLOYEE_ID, ["use_via_baxter", "financial_data"]);
    const template = await commissionTemplate();
    const dash = await duplicateReport(template, ADMIN_ID, "Private", { ruleActor: adminActor });
    const own = await rsOf(dash);
    const ownRate = await setRate({
      ruleSet: own,
      salesperson: "Connor",
      ratePct: 5,
      effectiveFrom: "2026-10-23",
      actor: adminActor,
    });
    const noRules = await runRateOperation({
      caller: await caller(editor),
      ruleSetKey: own.key,
      op: { type: "void_rate", rateId: ownRate.id, reason: "x-y-z" },
    }).catch((e) => e);
    expect(noRules).toMatchObject({ requiredPermission: "edit_rules" });
    expect(noRules.message).toMatch(/Edit business rules \(Reports\).*Access tab/);

    await grant(EMPLOYEE_ID, ["business_rules"]);
    // Company (shared) rule sets are administrator-only even with business-rule access.
    const shared = await runRateOperation({
      caller: await caller(editor),
      ruleSetKey: legacy.key,
      op: { type: "void_rate", rateId: rate!.id, reason: "x-y-z" },
    }).catch((e) => e);
    expect(shared).toMatchObject({ requiredPermission: "admin" });
    expect(shared.handoff).toMatch(/administrator/);
  });
});

// ---------------------------------------------------------------------------
// Dexter
// ---------------------------------------------------------------------------

describe("Dexter reports_rules", () => {
  it("inspects bindings, consumers, legacy and orphaned rule sets", async () => {
    const legacy = await legacySharedRuleSet();
    await incidentRates(legacy);
    const dash = await legacyReport("Sales Commissions", legacy.key);
    const template = await commissionTemplate();
    const orphanDash = await duplicateReport(template, ADMIN_ID, "Gone", { ruleActor: adminActor });
    const orphanKey = keyOf(orphanDash);
    await deleteReport(orphanDash, { ruleActor: adminActor });

    const consumers = await dexter(admin, { action: "consumers", key: legacy.key });
    expect((consumers.consumers as Array<{ title: string }>).map((c) => c.title)).toContain(
      "Sales Commissions",
    );
    const legacyList = await dexter(admin, { action: "legacy" });
    expect((legacyList.ruleSets as Array<{ key: string }>).map((r) => r.key)).toContain(legacy.key);
    const orphans = await dexter(admin, { action: "orphans" });
    expect((orphans.ruleSets as Array<{ key: string }>).map((r) => r.key)).toContain(orphanKey);
    const bindings = await dexter(admin, { action: "bindings", reportId: dash.id });
    expect(bindings.ruleSets).toEqual([
      expect.objectContaining({
        key: legacy.key,
        scope: "company",
        needsReview: true,
        attachedAs: "Not recorded (legacy)",
      }),
    ]);
    const got = await dexter(admin, { action: "get", key: legacy.key });
    expect((got.rates as Array<{ state: string }>).map((r) => r.state)).toEqual([
      "current",
      "ended",
      "current",
    ]);
  });

  it("dry-runs and applies rate lifecycle changes via Dexter, idempotently per task", async () => {
    const legacy = await legacySharedRuleSet();
    await incidentRates(legacy);
    const kevin = (await listRates(legacy.id)).filter((r) => r.salesperson === "Kevin");
    const args = {
      action: "void_rate",
      key: legacy.key,
      rateId: kevin[1]!.id,
      reason: "Duplicate row from the incident",
    };
    const dry = await dexter(admin, { ...args, dryRun: true });
    expect(dry).toMatchObject({ saved: false, dryRun: true });
    const applied = await dexter(admin, args, "00000000-0000-4000-8000-0000000000b1");
    expect(applied).toMatchObject({ saved: true, dryRun: false, replayed: false });
    const retried = await dexter(admin, args, "00000000-0000-4000-8000-0000000000b1");
    expect(retried).toMatchObject({ replayed: true });
    expect(
      (await listRuleChanges(legacy.id, 500)).filter((c) => c.action === "voided"),
    ).toHaveLength(1);
    const change = await lastChange(legacy.id, "voided");
    expect(change).toMatchObject({
      action: "voided",
      via: "dexter",
      changed_by_label: "performed using Avery Admin, via Dexter",
    });
  });

  it("returns precise permission errors with an admin handoff", async () => {
    const legacy = await legacySharedRuleSet();
    await grant(EMPLOYEE_ID, ["use_via_baxter", "financial_data"]);
    const res = await dexter(editor, { action: "archive", key: legacy.key, reason: "cleanup" });
    expect(res).toMatchObject({ saved: false, requiredPermission: "edit_rules" });
    expect(String(res.handoff)).toMatch(/administrator/);
    const preview = await dexter(editor, {
      action: "archive",
      key: legacy.key,
      reason: "cleanup",
      dryRun: true,
    });
    expect(preview).toMatchObject({ saved: false, requiredPermission: "admin" });
  });

  it("starts a new commission dashboard empty from the placeholder", async () => {
    const report = await createReport({
      spec: commissionSpec("Dexter dashboard", TEMPLATE_RULE_SET_KEY),
      ownerId: ADMIN_ID,
      authorKind: "dexter",
      ruleActor: ruleActor("Avery Admin", ADMIN_ID, "dexter"),
    });
    const rs = await rsOf(report);
    expect(rs).toMatchObject({ scope: "dashboard", owner_report_id: report.id });
    expect(ruleSetKeysIn(report.spec)).toEqual([rs.key]);
    expect((await listRuleChanges(rs.id)).map((c) => c.changed_by_label)).toContain(
      "performed using Avery Admin, via Dexter",
    );
  });
});

// ---------------------------------------------------------------------------
// Post-deploy cleanup of the incident (the admin runbook, end to end)
// ---------------------------------------------------------------------------

describe("incident cleanup runbook", () => {
  it("takes the three rows out of current use without erasing history", async () => {
    const legacy = await legacySharedRuleSet();
    await incidentRates(legacy);
    const dash = await legacyReport("Sales Commissions", legacy.key);
    const adm = await caller(admin);
    // 1. The coworker's dashboard gets its own empty rules.
    await runReportRulesOperation({
      caller: adm,
      reportId: dash.id,
      op: { type: "detach", key: legacy.key, reason: "Inherited by accident" },
    });
    // 2. End the two open rows (Connor; Kevin from 10-29) — the closed Kevin row already ended.
    for (const r of await listRates(legacy.id)) {
      if (r.effective_to) continue;
      await runRateOperation({
        caller: adm,
        ruleSetKey: legacy.key,
        op: { type: "end_rate", rateId: r.id, endDate: "2026-10-29", reason: "Rule set retired" },
      });
    }
    // 3. Archive the now-unused legacy rule set.
    await runRuleSetOperation({
      caller: adm,
      ruleSetKey: legacy.key,
      op: { type: "archive", reason: "Retired after incident" },
    });
    const after = await requireRuleSet(legacy.key);
    expect(after.status).toBe("archived");
    const rows = await listRates(legacy.id, { includeInactive: true });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.effective_to && r.effective_to <= "2026-10-29")).toBe(true);
    expect((await listRuleChanges(legacy.id, 200)).length).toBeGreaterThan(6);
    // Archived rules are read-only.
    await expect(
      setRate({
        ruleSet: after,
        salesperson: "Connor",
        ratePct: 1,
        effectiveFrom: "2026-11-01",
        actor: adminActor,
      }),
    ).rejects.toThrow(/archived/);
    await expect(copyRuleSet({ source: after, actor: adminActor })).resolves.toMatchObject({
      status: "active",
    });
  });
});
