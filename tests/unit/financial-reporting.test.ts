/**
 * JobTread financial reporting: document status mapping, lifecycle vs payment status, payment
 * kinds/dedupe/refunds, balance verification and overdue, reconciliation without double
 * counting, PP# configuration/matching/approval/drill gating, weekly snapshots (timezone,
 * prospective, immutable, week-over-week), configurable alerts (validation, verification
 * gating, dedupe, delivery, retry, inbox), readiness states, Project Manager audit, tolerant
 * document sync, the documents/payments/tasks report sources, and Dexter tools.
 * Synthetic JobTread fixture only — no live JobTread, no QuickBooks, no external alerts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDb, eq } from "@/lib/agents/store";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { DEXTER_FINANCIAL_TOOLS, DEXTER_TOOLS } from "@/lib/agents/defaults";
import { newStats } from "@/lib/jobtread/client";
import { DOCUMENTS } from "@/lib/jobtread/fixture";
import { syncDocuments, runFullSync } from "@/lib/jobtread/sync";
import { listMemoryJobsForTests, resetMemoryJobsForTests } from "@/lib/jobs/queue";
import {
  processEntitySyncJob,
  requestEntitySync,
  setEntityEnabled,
} from "@/lib/jobtread/sync-manager";
import { resetTolerantUpsertForTests } from "@/lib/jobtread/tolerant-upsert";
import {
  alertConfigSchemas,
  evaluateRule,
  isFinancialRule,
  nextAttemptAt,
  planDeliveries,
  ruleProblem,
  type AlertContext,
  type AlertRule,
} from "@/lib/reports/alert-core";
import {
  alertInbox,
  evaluateAlerts,
  processDeliveries,
  saveAlertRule,
  updateAlertStatus,
} from "@/lib/reports/alerts";
import { getReportsAccess } from "@/lib/reports/access";
import { invalidateCatalogContext, loadSourceRows } from "@/lib/reports/engine";
import {
  documentTotal,
  indexPayments,
  invoiceFacts,
  mapLifecycle,
  paymentKind,
  paymentStatusOf,
  reconcileInvoices,
  signedPaymentAmount,
  statusInventory,
  type FinancialDocumentRow,
  type FinancialSettings,
  type PaymentsState,
} from "@/lib/reports/financial-core";
import { invalidateFinancialContext, saveFinancialSettings } from "@/lib/reports/financial-data";
import { financialReadiness, projectManagerAudit } from "@/lib/reports/financial-overview";
import { paymentsBackfill } from "@/lib/reports/financial-http";
import { getFieldCatalog, invalidateFieldCatalog, resolveField } from "@/lib/reports/fields";
import { auditProjectManager } from "@/lib/reports/pm-audit-core";
import { projectFinancialDrill } from "@/lib/reports/pp-mapping";
import { computeReadiness } from "@/lib/reports/readiness-core";
import { RELATIONSHIPS, ROLLUPS } from "@/lib/reports/relationships";
import {
  computeSnapshotValues,
  diffSnapshots,
  snapshotPeriod,
  type SnapshotRow,
} from "@/lib/reports/snapshot-core";
import { captureSnapshot, compareLatestWeeks, saveSnapshotSettings } from "@/lib/reports/snapshots";
import { SOURCES } from "@/lib/reports/spec";
import { ADMIN_ID, EMPLOYEE_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

vi.setConfig({ testTimeout: 30_000 });

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const employee = requester(EMPLOYEE_ID, "user", "Eli Employee");
const toolCtx = (r: Requester) => ({
  task: { id: "00000000-0000-4000-8000-0000000000f6", allowed_context: {} } as never,
  agent: { row: { id: "00000000-0000-4000-8000-00000000d0d0" } } as never,
  requester: r,
  access: new Set<never>(),
});
const run = async (key: string, args: unknown, who = admin) =>
  (await getTool(key)!.execute(toolCtx(who), args)).data as Record<string, unknown>;

const TODAY = "2026-11-02";
const settings = (over: Partial<FinancialSettings> = {}): FinancialSettings => ({
  statusMap: [
    { type: "customerInvoice", status: "draft", lifecycle: "draft" },
    { type: "customerInvoice", status: "approved", lifecycle: "issued" },
    { type: "customerInvoice", status: "denied", lifecycle: "voided" },
  ],
  balanceSource: "payments_reconciled",
  overdueGraceDays: 0,
  ...over,
});
const paymentsOn: PaymentsState = {
  enabled: true,
  lastSucceededAt: "2026-11-01T00:00:00Z",
  sourceCount: 3,
};
const paymentsOff: PaymentsState = { enabled: false, lastSucceededAt: null, sourceCount: 0 };
const inv = (over: Partial<FinancialDocumentRow> = {}): FinancialDocumentRow => ({
  id: "inv1",
  job_id: "job00000001",
  type: "customerInvoice",
  status: "approved",
  number: "101",
  name: "PP#2 - Framing 20%",
  issue_date: "2026-09-01",
  due_date: "2026-10-01",
  price: 1000,
  cost: 0,
  tax: 0,
  amount_paid: 400,
  balance: 600,
  ...over,
});

function invalidate() {
  invalidateCatalogContext();
  invalidateFieldCatalog();
  invalidateFinancialContext();
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

// ---------------------------------------------------------------------------
// 1–2. Status mapping; lifecycle separate from payment status
// ---------------------------------------------------------------------------
describe("document status mapping", () => {
  it("maps only configured statuses; everything else is unknown", () => {
    expect(
      mapLifecycle({ type: "customerInvoice", status: "Approved" }, settings().statusMap),
    ).toBe("issued");
    expect(mapLifecycle({ type: "customerInvoice", status: "pending" }, settings().statusMap)).toBe(
      "unknown",
    );
    expect(mapLifecycle({ type: "customerOrder", status: "approved" }, settings().statusMap)).toBe(
      "unknown",
    );
    const inventory = statusInventory(
      [inv(), inv({ id: "b" }), inv({ id: "c", status: "pending" })],
      settings().statusMap,
    );
    expect(inventory.find((r) => r.status === "approved")).toMatchObject({
      count: 2,
      lifecycle: "issued",
    });
    expect(inventory.find((r) => r.status === "pending")?.lifecycle).toBe("unknown");
  });

  it("keeps lifecycle and payment status separate and flags conflicts", () => {
    const paidMapped = settings({
      statusMap: [{ type: "customerInvoice", status: "approved", lifecycle: "paid" }],
    });
    const facts = invoiceFacts(inv(), [], paidMapped, paymentsOff, TODAY);
    expect(facts.lifecycle).toBe("paid");
    expect(facts.paymentStatus).toBe("partially_paid");
    expect(facts.conflict).toMatch(/Mapped as Paid/);
    expect(paymentStatusOf(inv({ amount_paid: 0, balance: 1000 }))).toBe("unpaid");
    expect(paymentStatusOf(inv({ amount_paid: 1000, balance: 0 }))).toBe("paid");
    expect(paymentStatusOf(inv({ amount_paid: null }))).toBe("unknown");
    expect(paymentStatusOf(inv({ type: "customerOrder" }))).toBe("not_applicable");
  });

  it("never treats a blank tax as zero", () => {
    expect(documentTotal({ price: 1000, tax: 80 })).toBe(1080);
    expect(documentTotal({ price: 1000, tax: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3–5. Payments: kinds, refunds, dedupe, verification
// ---------------------------------------------------------------------------
describe("payments", () => {
  const pay = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
    id,
    job_id: "job00000001",
    document_id: "inv1",
    amount,
    paid_on: "2026-09-15",
    ...extra,
  });

  it("handles partial and multiple payments, refunds, and reversals", () => {
    expect(paymentKind(pay("r", -50))).toBe("refund");
    expect(paymentKind(pay("r2", 50, { payment_type: "Refund" }))).toBe("refund");
    expect(paymentKind(pay("v", 50, { payment_type: "reversal" }))).toBe("reversal");
    expect(signedPaymentAmount(pay("r2", 50, { payment_type: "refund" }))).toBe(-50);
    const facts = invoiceFacts(
      inv({ amount_paid: 400 }),
      [pay("p1", 250), pay("p2", 200), pay("p3", 50, { payment_type: "refund" })],
      settings(),
      paymentsOn,
      TODAY,
    );
    expect(facts.paymentsTotal).toBe(400);
    expect(facts.refundTotal).toBe(50);
    expect(facts.verification).toBe("verified");
  });

  it("dedupes by JobTread id on resync and flags (keeps) look-alike payments", () => {
    const { byId, byDocument, possibleDuplicates } = indexPayments([
      pay("p1", 100),
      pay("p1", 100),
      pay("p2", 100),
    ]);
    expect(byId.size).toBe(2);
    expect(byDocument.get("inv1")).toHaveLength(2);
    expect([...possibleDuplicates].sort()).toEqual(["p1", "p2"]);
  });

  it("is unverified when payments are off, mismatched when they disagree, accepted by policy", () => {
    expect(invoiceFacts(inv(), [], settings(), paymentsOff, TODAY).verification).toBe("unverified");
    expect(invoiceFacts(inv(), [pay("p1", 100)], settings(), paymentsOn, TODAY).verification).toBe(
      "mismatch",
    );
    expect(
      invoiceFacts(inv(), [], settings({ balanceSource: "jobtread_balance" }), paymentsOff, TODAY)
        .verification,
    ).toBe("accepted");
  });
});

// ---------------------------------------------------------------------------
// 6–7. Overdue and reconciliation
// ---------------------------------------------------------------------------
describe("overdue and reconciliation", () => {
  it("requires a verified unpaid balance for overdue", () => {
    expect(invoiceFacts(inv(), [], settings(), paymentsOff, TODAY).overdue).toBeNull();
    const accepted = settings({ balanceSource: "jobtread_balance" });
    expect(invoiceFacts(inv(), [], accepted, paymentsOff, TODAY)).toMatchObject({
      overdue: true,
      daysPastDue: 32,
    });
    expect(
      invoiceFacts(inv(), [], { ...accepted, overdueGraceDays: 40 }, paymentsOff, TODAY).overdue,
    ).toBe(false);
    expect(invoiceFacts(inv({ status: "draft" }), [], accepted, paymentsOff, TODAY).overdue).toBe(
      false,
    );
    expect(
      invoiceFacts(inv({ status: "pending" }), [], accepted, paymentsOff, TODAY).overdue,
    ).toBeNull();
    expect(invoiceFacts(inv({ due_date: null }), [], accepted, paymentsOff, TODAY).overdue).toBe(
      false,
    );
  });

  it("reconciles from document amounts without adding payments on top", () => {
    const s = settings();
    const docs = [inv(), inv({ id: "inv2", price: 500, amount_paid: 500, balance: 0 })];
    const pays = indexPayments([
      { id: "p1", job_id: null, document_id: "inv1", amount: 400, paid_on: "2026-09-10" },
      { id: "p2", job_id: null, document_id: "inv2", amount: 500, paid_on: "2026-09-10" },
    ]).byDocument;
    const rows = docs.map((doc) => ({
      doc,
      facts: invoiceFacts(doc, pays.get(doc.id) ?? [], s, paymentsOn, TODAY),
    }));
    const t = reconcileInvoices(rows, paymentsOn, s);
    expect(t).toMatchObject({
      invoiced: 1500,
      paid: 900,
      outstanding: 600,
      overdue: 600,
      paymentsCollected: 900,
      completeness: "complete",
    });
  });

  it("marks totals incomplete instead of zero when payment data is missing", () => {
    const s = settings();
    const rows = [inv(), inv({ id: "x", status: "pending" })].map((doc) => ({
      doc,
      facts: invoiceFacts(doc, [], s, paymentsOff, TODAY),
    }));
    const t = reconcileInvoices(rows, paymentsOff, s);
    expect(t.overdue).toBeNull();
    expect(t.paymentsCollected).toBeNull();
    expect(t.completeness).not.toBe("complete");
    expect(t.reasons.join(" ")).toMatch(/isn't mapped/);
    expect(t.reasons.join(" ")).toMatch(/Payment sync is turned off/);
  });
});

// ---------------------------------------------------------------------------
// 11–12. Snapshots
// ---------------------------------------------------------------------------
describe("weekly snapshots (pure)", () => {
  const base = { enabled: true, weekday: 1, hourLocal: 7, timezone: "America/Los_Angeles" };

  it("computes the period in the configured timezone, Monday by default", () => {
    // 2026-11-02 14:00 UTC = Monday 06:00 in Los Angeles (PST): not due until 07:00.
    expect(snapshotPeriod(new Date("2026-11-02T14:00:00Z"), base)).toMatchObject({
      start: "2026-11-02",
      due: false,
    });
    expect(snapshotPeriod(new Date("2026-11-02T15:30:00Z"), base)).toMatchObject({
      start: "2026-11-02",
      end: "2026-11-08",
      due: true,
    });
    // Sunday evening in LA is still the previous week.
    expect(snapshotPeriod(new Date("2026-11-02T05:00:00Z"), base).start).toBe("2026-10-26");
    expect(
      snapshotPeriod(new Date("2026-11-02T15:30:00Z"), { ...base, timezone: "Asia/Tokyo" }).start,
    ).toBe("2026-11-02");
  });

  it("collects prospectively (never the period that started before snapshots were turned on)", () => {
    const p = snapshotPeriod(new Date("2026-11-04T18:00:00Z"), {
      ...base,
      enabledAt: "2026-11-03T18:00:00Z",
    });
    expect(p).toMatchObject({ start: "2026-11-02", due: false, prospective: false });
  });

  it("marks missing inputs incomplete and diffs week over week", () => {
    const values = computeSnapshotValues({
      totals: {
        invoiceCount: 1,
        countedInvoices: 1,
        invoiced: 1000,
        paid: null,
        outstanding: 600,
        overdue: null,
        overdueCount: null,
        paymentsCollected: null,
        completeness: "partial",
        reasons: ["x"],
      },
      outstandingByPm: [{ pm: "Maxx", balance: 600, verified: false }],
      jobs: [{ id: "j1", name: "Job 1", scheduleEnd: "2026-12-01", open: true }],
      milestones: null,
      today: TODAY,
    });
    expect(values.find((v) => v.metric === "overdue_total")).toMatchObject({
      value: null,
      completeness: "incomplete",
    });
    expect(values.find((v) => v.metric === "outstanding_by_pm")).toMatchObject({
      completeness: "partial",
    });
    expect(values.find((v) => v.metric === "late_milestones")?.completeness).toBe("incomplete");
    const row = (metric: string, value: number, extra: Partial<SnapshotRow> = {}): SnapshotRow => ({
      period_start: "x",
      metric,
      dimension_key: "",
      dimensions: {},
      value,
      completeness: "complete",
      calc_version: "fin-1",
      ...extra,
    });
    const changes = diffSnapshots(
      [
        row("outstanding_total", 600),
        row("invoiced_total", 1000),
        row("paid_total", 1, { calc_version: "fin-0" }),
      ],
      [row("outstanding_total", 900), row("invoiced_total", 1000), row("paid_total", 2)],
    );
    expect(changes.find((c) => c.metric === "outstanding_total")?.delta).toBe(300);
    expect(changes.find((c) => c.metric === "invoiced_total")).toBeUndefined();
    expect(changes.find((c) => c.metric === "paid_total")).toMatchObject({
      delta: null,
      caveat: expect.stringMatching(/not directly comparable/),
    });
  });
});

// ---------------------------------------------------------------------------
// 13–15. Alerts (pure)
// ---------------------------------------------------------------------------
describe("alert rules (pure)", () => {
  const rule = (over: Partial<AlertRule>): AlertRule => ({
    id: "r1",
    key: "overdue-30",
    kind: "overdue_invoice",
    name: "Overdue 30",
    enabled: true,
    config: { minDaysPastDue: 30 },
    recipients: [{ type: "role", value: "admin" }],
    channel: "in_app",
    slack_channel: null,
    ...over,
  });
  const ctx = (over: Partial<AlertContext> = {}): AlertContext => ({
    invoices: [
      {
        id: "i1",
        number: "1",
        jobId: "j1",
        jobName: "Job 1",
        dueDate: "2026-09-01",
        balance: 500,
        daysPastDue: 62,
        overdue: true,
        verified: true,
      },
      {
        id: "i2",
        number: "2",
        jobId: "j2",
        jobName: "Job 2",
        dueDate: "2026-09-01",
        balance: 500,
        daysPastDue: 62,
        overdue: null,
        verified: false,
      },
    ],
    forecastChanges: [
      {
        jobId: "j1",
        jobName: "Job 1",
        previous: "2026-12-01",
        current: "2026-12-15",
        deltaDays: 14,
        caveat: null,
      },
      {
        jobId: "j3",
        jobName: "Job 3",
        previous: "2026-12-20",
        current: "2026-12-01",
        deltaDays: -19,
        caveat: null,
      },
    ],
    jobs: [
      {
        jobId: "j1",
        jobName: "Job 1",
        financialVerified: true,
        metrics: { max_days_past_due: 62, outstanding_balance: 500 },
      },
      {
        jobId: "j2",
        jobName: "Job 2",
        financialVerified: false,
        metrics: { max_days_past_due: null },
      },
    ],
    openEvents: [],
    rules: [],
    ...over,
  });

  it("requires admin-defined settings and recipients (no built-in definitions)", () => {
    expect(ruleProblem(rule({ kind: "high_risk", config: {} }))).toMatch(/Settings incomplete/);
    expect(alertConfigSchemas.high_risk.safeParse({ conditions: [] }).success).toBe(false);
    expect(ruleProblem(rule({ recipients: [] }))).toMatch(/recipient/);
    expect(ruleProblem(rule({ channel: "slack" }))).toMatch(/Slack channel/);
    expect(isFinancialRule(rule({ kind: "forecast_slip", config: { minDays: 7 } }))).toBe(false);
  });

  it("never fires financial alerts on unverified balances", () => {
    const r = evaluateRule(rule({}), ctx());
    expect(r.candidates.map((c) => c.subjectId)).toEqual(["i1"]);
    expect(r.suppressed).toEqual([{ subjectId: "i2", reason: "Balance not verified" }]);
    expect(r.candidates[0]!.dedupeKey).toBe("overdue-30:invoice:i1:2026-09-01");
  });

  it("detects forecast slips, improvements, high risk, and full recovery", () => {
    expect(
      evaluateRule(
        rule({ kind: "forecast_slip", key: "slip", config: { minDays: 7 } }),
        ctx(),
      ).candidates.map((c) => c.subjectId),
    ).toEqual(["j1"]);
    expect(
      evaluateRule(
        rule({ kind: "forecast_improvement", key: "imp", config: { minDays: 7 } }),
        ctx(),
      ).candidates.map((c) => c.subjectId),
    ).toEqual(["j3"]);
    const risk = rule({
      id: "r2",
      kind: "high_risk",
      key: "risk",
      config: { match: "all", conditions: [{ metric: "max_days_past_due", op: "gte", value: 60 }] },
    });
    const hr = evaluateRule(risk, ctx());
    expect(hr.candidates.map((c) => c.subjectId)).toEqual(["j1"]);
    expect(hr.suppressed.map((s) => s.subjectId)).toEqual(["j2"]);
    const recovery = rule({
      id: "r3",
      kind: "full_recovery",
      key: "recovered",
      config: { watchRuleKey: "risk" },
    });
    const recovered = ctx({
      rules: [risk, recovery],
      openEvents: [{ id: "e1", ruleKey: "risk", subjectType: "job", subjectId: "j1" }],
      jobs: [
        {
          jobId: "j1",
          jobName: "Job 1",
          financialVerified: true,
          metrics: { max_days_past_due: 0 },
        },
      ],
    });
    expect(evaluateRule(recovery, recovered).candidates).toHaveLength(1);
    expect(evaluateRule(recovery, { ...recovered, jobs: ctx().jobs }).candidates).toHaveLength(0);
  });

  it("plans deliveries without Slack unless authorized, and backs off retries", () => {
    const plans = planDeliveries(rule({ channel: "slack", slack_channel: "#finance" }), false);
    expect(plans.find((p) => p.channel === "slack")).toMatchObject({ status: "skipped" });
    expect(plans.find((p) => p.channel === "in_app")?.status).toBe("sent");
    expect(
      planDeliveries(rule({ channel: "slack", slack_channel: "#finance" }), true).find(
        (p) => p.channel === "slack",
      )?.status,
    ).toBe("pending");
    const now = new Date("2026-11-02T00:00:00Z");
    expect(nextAttemptAt(1, now)).toBe("2026-11-02T00:05:00.000Z");
    expect(nextAttemptAt(10, now)).toBe("2026-11-02T06:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// 16–17. Readiness and PM audit (pure)
// ---------------------------------------------------------------------------
describe("readiness and Project Manager audit (pure)", () => {
  it("reports each readiness state with where to fix it", () => {
    const areas = computeReadiness({
      migrated: false,
      entities: {
        documents: { enabled: true, lastSuccessAt: "x", recordsCached: 906, dropped: [] },
        payments: { enabled: false, lastSuccessAt: null, recordsCached: 0, dropped: [] },
      },
      sourceCounts: { payments: 0 },
      documents: { total: 906, invoices: 10, unmappedStatuses: 2, unmappedInvoices: 10 },
      payments: {
        synced: 0,
        mismatches: 0,
        verifiedInvoices: 0,
        balanceSource: "payments_reconciled",
      },
      tasks: { total: 0, jobsWithTasks: 0, orphaned: 0 },
      pm: { completenessPct: 14, mappingDefect: null, populated: 63, total: 449 },
      pp: { configured: false, classified: 0, approved: 0, ambiguous: 0, unmatched: 0 },
      snapshots: { enabled: false, lastPeriod: null, runs: 0 },
      alerts: { rules: 0, enabled: 0, invalid: 0, open: 0 },
    });
    const state = (k: string) => areas.find((a) => a.key === k)!.state;
    expect(state("documents")).toBe("ready");
    expect(state("invoice_fields")).toBe("requires_migration");
    expect(state("payments")).toBe("sync_disabled");
    expect(state("tasks")).toBe("sync_disabled");
    expect(state("project_manager")).toBe("incomplete_source_data");
    expect(areas.every((a) => a.setting.startsWith("Reports → Data settings"))).toBe(true);
  });

  it("classifies PM gaps and never fills a value", () => {
    const field = {
      semanticKey: "project_manager",
      label: "Project Manager",
      customFieldId: "cfPM",
      fieldName: "Project Manager",
      category: "general",
      targetType: "job",
      options: ["Maxx", "Connor"],
      removed: false,
      aliasStatus: "ok",
    };
    const jobs = [
      { id: "1", name: "A", number: null, closed: false, phase: "Design", values: ["Maxx"] },
      { id: "2", name: "B", number: null, closed: false, phase: "Design", values: null },
      { id: "3", name: "C", number: null, closed: false, phase: null, values: ["Zed", "Maxx"] },
    ];
    const audit = auditProjectManager({ field, jobs });
    expect(audit).toMatchObject({
      populated: 2,
      blank: 1,
      multiPersonJobs: 1,
      completenessPct: 66.7,
    });
    expect(audit.valuesOutsideOptions).toEqual([{ value: "Zed", jobs: 1 }]);
    expect(audit.defects.map((d) => d.class)).toEqual(["source_data"]);
    expect(
      auditProjectManager({ field: { ...field, category: "excluded" }, jobs }).defects[0]!.class,
    ).toBe("exclusion");
    expect(auditProjectManager({ field: null, jobs }).completenessPct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 18–20. Integration over the synthetic JobTread fixture (memory store)
// ---------------------------------------------------------------------------
describe("financial reporting end to end (fixture)", () => {
  const invoices = [
    {
      ...DOCUMENTS[4]!,
      status: "approved",
      dueDate: "2026-09-01",
      name: "PP#1 - Deposit",
      amountPaid: 10_000,
      balance: 20_000,
      updatedAt: "2026-10-01T00:00:00Z",
    },
    {
      ...DOCUMENTS[4]!,
      id: "docInv0002",
      number: "6",
      status: "pending",
      job: { id: "job00000002" },
      name: "Progress",
    },
  ];

  beforeEach(async () => {
    await setupAgentTestEnv();
    resetMemoryJobsForTests();
    resetTolerantUpsertForTests();
    invalidate();
    installFakePave({ records: { documents: [...DOCUMENTS.slice(0, 4), ...invoices] } });
    await runFullSync("test");
    invalidate();
  });
  afterEach(() => uninstallFakePave());

  it("registers documents, payments, and tasks as report sources with stable-id joins", () => {
    expect(SOURCES).toEqual(expect.arrayContaining(["documents", "payments", "tasks"]));
    expect(RELATIONSHIPS["documents.job"].key).toBe("doc.jobId");
    expect(RELATIONSHIPS["payments.document"].key).toBe("pay.documentId");
    expect(ROLLUPS["documents.payments"].childKey).toBe("pay.documentId");
  });

  it("syncs documents tolerantly when JobTread lacks an attribute, and hides that field", async () => {
    uninstallFakePave();
    installFakePave({ records: { documents: invoices }, missingFields: ["updatedAt"] });
    await agentDb().upsert(
      "jt_sync_entities",
      { entity: "documents", enabled: true, dropped_fields: [] },
      ["entity"],
    );
    const r = await syncDocuments(newStats());
    expect(r.dropped).toEqual(["updatedAt"]);
    invalidate();
    const catalog = await getFieldCatalog();
    expect(resolveField(catalog, "doc.updatedAt")).toMatchObject({
      ok: false,
      code: "unsupported_api",
    });
    expect(resolveField(catalog, "doc.balance").ok).toBe(true);
  });

  it("exposes invoice rows with PM via the job join, unknown statuses, and unverified balances", async () => {
    const { rows, catalog } = await loadSourceRows("documents");
    const row = rows.find((r) => r.id === "docInv0001")!;
    expect(row).toMatchObject({
      "doc.number": "5",
      "doc.type": "Customer invoice",
      "doc.lifecycle": "Unknown",
      "doc.paymentStatus": "Partially paid",
      "doc.overdue": null,
      "doc.job": expect.any(String),
    });
    const pm = resolveField(catalog, "sem:project_manager");
    expect(pm.ok && row[pm.key]).toEqual(["Maxx"]);
    expect(rows.filter((r) => r["doc.type"] === "Customer invoice")).toHaveLength(2);
  });

  it("reflects the status mapping and balance policy in overdue and readiness", async () => {
    await saveFinancialSettings(
      {
        statusMap: [{ type: "customerInvoice", status: "approved", lifecycle: "issued" }],
        balanceSource: "jobtread_balance",
      },
      ADMIN_ID,
    );
    const { rows } = await loadSourceRows("documents");
    expect(rows.find((r) => r.id === "docInv0001")).toMatchObject({
      "doc.lifecycle": "Issued",
      "doc.overdue": true,
    });
    const readiness = await financialReadiness();
    expect(readiness.areas.find((a) => a.key === "status_mapping")?.state).toBe("requires_mapping");
    expect(readiness.counts).toMatchObject({
      invoices: 2,
      payments: 0,
      invoiceMilestoneLinks: 0,
      snapshots: 0,
    });
  });

  it("syncs payments only after an explicit backfill, with refunds and drill to payments", async () => {
    uninstallFakePave();
    installFakePave({
      records: {
        documents: [...DOCUMENTS.slice(0, 4), ...invoices],
        payments: [
          {
            id: "pay1",
            amount: 12_000,
            date: "2026-09-10",
            type: null,
            createdAt: "2026-09-10T00:00:00Z",
            document: { id: "docInv0001" },
            job: { id: "job00000001" },
            account: null,
          },
          {
            id: "pay2",
            amount: -2_000,
            date: "2026-09-20",
            type: null,
            createdAt: "2026-09-20T00:00:00Z",
            document: { id: "docInv0001" },
            job: { id: "job00000001" },
            account: null,
          },
        ],
      },
    });
    const plan = await paymentsBackfill(false, ADMIN_ID);
    expect(plan.dryRun).toBe(true);
    expect((await agentDb().select("jt_payments", {})).length).toBe(0);
    await paymentsBackfill(true, ADMIN_ID);
    await drainJobs();
    invalidate();
    const { rows } = await loadSourceRows("payments");
    expect(rows.map((r) => r["pay.kind"]).sort()).toEqual(["payment", "refund"]);
    const docs = (await loadSourceRows("documents")).rows;
    expect(docs.find((r) => r.id === "docInv0001")).toMatchObject({
      "doc.paymentsTotal": 10_000,
      "doc.balanceVerification": "Verified against payments",
    });
    const drill = await projectFinancialDrill("job00000001");
    expect(drill.levels.find((l) => l.key === "payments")?.enabled).toBe(true);
    expect(drill.levels.find((l) => l.key === "task")?.enabled).toBe(false);
    expect((drill.invoices[0] as { payments: unknown[] }).payments).toHaveLength(2);
  });

  it("exposes tasks with a stable job join", async () => {
    await requestEntitySync({ entities: ["tasks"], triggeredBy: "test" });
    await drainJobs();
    invalidate();
    const { rows, catalog } = await loadSourceRows("tasks");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("task.scheduleStatus");
    const phase = resolveField(catalog, "sem:phase");
    expect(
      phase.ok && rows.find((r) => r["task.jobId"] === "job00000001")?.[phase.key],
    ).toBeTruthy();
  });

  it("captures immutable weekly snapshots once per period and explains missing history", async () => {
    expect(await compareLatestWeeks()).toMatchObject({ ok: false });
    await saveSnapshotSettings({ enabled: true }, ADMIN_ID);
    const first = await captureSnapshot({
      triggeredBy: "test",
      now: new Date("2026-11-02T18:00:00Z"),
    });
    expect(first.status).toBe("captured");
    expect(
      (await captureSnapshot({ triggeredBy: "test", now: new Date("2026-11-03T18:00:00Z") }))
        .status,
    ).toBe("exists");
    expect((await compareLatestWeeks()) as { reason: string }).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Only one snapshot/),
    });
    await captureSnapshot({ triggeredBy: "test", now: new Date("2026-11-09T18:00:00Z") });
    const cmp = await compareLatestWeeks();
    expect(cmp).toMatchObject({ ok: true, previous: "2026-11-02", current: "2026-11-09" });
    const overdue = (
      await agentDb().select<{ value: unknown; completeness: string }>("bi_snapshots", {
        filters: [eq("metric", "overdue_total")],
      })
    )[0]!;
    expect(overdue).toMatchObject({ value: null, completeness: "incomplete" });
  });

  it("evaluates alerts with dedupe, in-app delivery only, and acknowledge/resolve", async () => {
    await saveFinancialSettings(
      {
        statusMap: [{ type: "customerInvoice", status: "approved", lifecycle: "issued" }],
        balanceSource: "jobtread_balance",
      },
      ADMIN_ID,
    );
    await expect(
      saveAlertRule(
        {
          key: "risk",
          kind: "high_risk",
          name: "Risk",
          enabled: true,
          config: {},
          recipients: [{ type: "role", value: "admin" }],
        },
        ADMIN_ID,
      ),
    ).rejects.toThrow(/Can't enable/);
    await saveAlertRule(
      {
        key: "overdue-30",
        kind: "overdue_invoice",
        name: "Overdue 30",
        enabled: true,
        config: { minDaysPastDue: 30 },
        recipients: [{ type: "role", value: "admin" }],
        channel: "slack",
        slackChannel: "#finance",
      },
      ADMIN_ID,
    ).catch((e: Error) => expect(e.message).toMatch(/Slack isn't authorized/));
    await saveAlertRule(
      {
        key: "overdue-30",
        kind: "overdue_invoice",
        name: "Overdue 30",
        enabled: true,
        config: { minDaysPastDue: 30 },
        recipients: [{ type: "role", value: "admin" }],
      },
      ADMIN_ID,
    );
    invalidate();
    const first = await evaluateAlerts({ triggeredBy: "test" });
    expect(first).toMatchObject({ created: 1, repeated: 0 });
    expect(await evaluateAlerts({ triggeredBy: "test" })).toMatchObject({
      created: 0,
      repeated: 1,
    });
    const send = vi.fn();
    expect(await processDeliveries(new Date(), send)).toEqual({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    const adminAccess = await getReportsAccess(admin);
    const inbox = await alertInbox(admin, adminAccess);
    expect(inbox.events).toHaveLength(1);
    expect((await alertInbox(employee, await getReportsAccess(employee))).events).toHaveLength(0);
    await updateAlertStatus({
      eventId: inbox.events[0]!.id,
      action: "resolve",
      note: "Paid by check",
      requester: admin,
      access: adminAccess,
    });
    const audit = await agentDb().select<{ action: string }>("bi_alert_audit", {});
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["rule_created", "event_created", "evaluated", "event_resolve"]),
    );
  });

  it("audits Project Manager completeness from the mapped field", async () => {
    const pm = await projectManagerAudit();
    expect(pm.totalJobs).toBeGreaterThan(0);
    expect(pm.populated).toBe(pm.totalJobs - 1);
    expect(pm.defects.map((d) => d.class)).toContain("source_data");
  });

  it("gives Dexter the financial tools with access gating and setting pointers", async () => {
    expect(DEXTER_TOOLS).toEqual(expect.arrayContaining(DEXTER_FINANCIAL_TOOLS));
    for (const key of DEXTER_FINANCIAL_TOOLS) expect(getTool(key)).toBeDefined();
    const ready = await run("reports_financial_readiness", {});
    expect(
      (ready.areas as Array<{ fixIn: string }>).every((a) => a.fixIn.includes("Data settings")),
    ).toBe(true);
    expect(await run("reports_invoices", { action: "summary" }, employee)).toMatchObject({
      ok: false,
    });
    const overdue = await run("reports_invoices", { action: "overdue" });
    // No status mapping yet: open balances can't be called overdue or current.
    expect(overdue).toMatchObject({ totalMatching: 0, unverifiedOpenInvoices: 2 });
    expect(await run("reports_week_compare", {})).toMatchObject({ ok: false });
    expect(await run("reports_project_financials", { jobName: "zzz-none" })).toMatchObject({
      status: "not_found",
    });
    await setEntityEnabled("payments", false, null);
  });
});
