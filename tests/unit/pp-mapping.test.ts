/**
 * PP#1–PP#10 mapping end to end: the v0 → edit → preview → save → reload workflow (the
 * original "expected string, received undefined" failure), mode-conditional field-path
 * errors, safe patterns, classification (PP#10 never read as PP#1, PP#11 and "Progress
 * Invoice" unmatched, customer invoices only), project-scoped task linking, ambiguity,
 * manual review that survives syncs and rule changes, autoAccept, percentages (amounts
 * untouched), optimistic concurrency and history, reporting fields, Dexter, backward
 * compatibility, and authorization. Synthetic JobTread fixture only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDb } from "@/lib/agents/store";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { DOCUMENTS, JOBS } from "@/lib/jobtread/fixture";
import { runFullSync } from "@/lib/jobtread/sync";
import { listMemoryJobsForTests, resetMemoryJobsForTests } from "@/lib/jobs/queue";
import { processEntitySyncJob, requestEntitySync } from "@/lib/jobtread/sync-manager";
import { resetTolerantUpsertForTests } from "@/lib/jobtread/tolerant-upsert";
import { getReportsAccess } from "@/lib/reports/access";
import { invalidateCatalogContext, loadSourceRows } from "@/lib/reports/engine";
import {
  getPpConfig,
  invalidateFinancialContext,
  PpConfigConflictError,
  savePpConfig,
} from "@/lib/reports/financial-data";
import { runFinancialAction } from "@/lib/reports/financial-http";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import type { ReportsContext } from "@/lib/reports/http";
import {
  classifyInvoice,
  DEFAULT_PP_CONFIG,
  effectiveLinks,
  matchTask,
  milestonePercent,
  normalizePpConfig,
  previewPpMatches,
  regexProblem,
  templateMatches,
  validatePpConfig,
  type PpConfig,
  type PpDocument,
  type PpLinkRow,
  type PpTask,
} from "@/lib/reports/pp-core";
import { decidePpLink, projectFinancialDrill, recordSuggestions } from "@/lib/reports/pp-mapping";
import { ADMIN_ID, EMPLOYEE_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

vi.setConfig({ testTimeout: 30_000 });

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const employee = requester(EMPLOYEE_ID, "user", "Eli Employee");
const REGEX = "PP#(10|[1-9])\\b";
const RULE = {
  classification: { mode: "name_pattern", regex: REGEX },
  link: { mode: "task_name_pattern", template: "PP#{pp}:" },
};
const valid = (raw: unknown): PpConfig => {
  const r = validatePpConfig(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.config;
};
const doc = (id: string, name: string | null, over: Partial<PpDocument> = {}): PpDocument => ({
  id,
  job_id: "job00000001",
  type: "customerInvoice",
  number: "77",
  name,
  ...over,
});

// ---------------------------------------------------------------------------
// Root cause + validation
// ---------------------------------------------------------------------------
describe("PP# config validation", () => {
  it("accepts the v0 config (all modes none) and the documented rule", () => {
    const v0 = JSON.parse(JSON.stringify(DEFAULT_PP_CONFIG));
    expect(validatePpConfig(v0).ok).toBe(true);
    expect(valid(RULE).classification).toEqual({ mode: "name_pattern", regex: REGEX });
    expect(valid({}).percentages.standard["10"]).toBe(10);
  });

  it("reports the exact path the old schema failed on, mode-aware", () => {
    const r = validatePpConfig({
      classification: { mode: "name_pattern" },
      link: { mode: "task_name_pattern" },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual(
      expect.arrayContaining([
        {
          path: "classification.regex",
          message: "Required when classification.mode is name_pattern.",
        },
        { path: "link.template", message: "Required when link.mode is task_name_pattern." },
      ]),
    );
    const bad = validatePpConfig({ classification: { mode: "guess" } });
    expect(!bad.ok && bad.errors[0]).toMatchObject({
      path: "classification.mode",
      message: expect.stringMatching(/Must be one of none, name_pattern/),
    });
    // mode "none" needs nothing else.
    expect(validatePpConfig({ classification: { mode: "none" }, link: { mode: "none" } }).ok).toBe(
      true,
    );
  });

  it("rejects unsafe or unusable patterns without running them", () => {
    expect(regexProblem("(a+)+$")).toMatch(/Nested repetition/);
    expect(regexProblem("(\\d{1,2})*x")).toMatch(/Nested repetition/);
    expect(regexProblem("(PP)#\\1")).toMatch(/Back-references/);
    expect(regexProblem("PP#\\d+")).toMatch(/capturing group/);
    expect(regexProblem("PP#(")).toMatch(/Not a valid regular expression/);
    expect(regexProblem(REGEX)).toBeNull();
    const r = validatePpConfig({ classification: { mode: "name_pattern", regex: "(a+)+" } });
    expect(!r.ok && r.errors[0]!.path).toBe("classification.regex");
  });

  it("is backward compatible with schema v1 (pattern, milestonePct)", () => {
    const { value, notes } = normalizePpConfig({
      classification: { mode: "name_pattern", pattern: REGEX },
      milestonePct: { mode: "none" },
    });
    expect(value).toMatchObject({ classification: { regex: REGEX } });
    expect(notes).toHaveLength(2);
    expect(
      valid({ classification: { mode: "name_pattern", pattern: REGEX } }).classification,
    ).toMatchObject({ regex: REGEX });
  });
});

// ---------------------------------------------------------------------------
// Classification, linking, percentages (pure)
// ---------------------------------------------------------------------------
describe("PP# classification and linking", () => {
  const config = valid(RULE);

  it("reads PP#1–PP#10 exactly and never PP#10 as 1", () => {
    const cases: Array<[string, number | null]> = [
      ["PP#1", 1],
      ["PP#2: Foundation", 2],
      ["Progress Payment PP#5", 5],
      ["PP#10 - Final Payment", 10],
      ["  pp#3   framing ", 3],
      ["PP#11", null],
      ["Progress Invoice", null],
    ];
    for (const [name, pp] of cases) {
      const c = classifyInvoice(doc("d", name), config);
      expect(c.status === "classified" ? c.pp : null, name).toBe(pp);
    }
    expect(classifyInvoice(doc("d", "pp#3"), valid({ ...RULE, caseSensitive: true })).status).toBe(
      "unclassified",
    );
  });

  it("classifies customer invoices only and never uses the document number for Progress Invoices", () => {
    expect(classifyInvoice(doc("d", "PP#2", { type: "customerOrder" }), config).status).toBe(
      "unclassified",
    );
    const progress = classifyInvoice(doc("d", "Progress Invoice", { number: "3" }), config);
    expect(progress).toMatchObject({
      status: "unclassified",
      reason: expect.stringMatching(/manually/),
    });
    const withField = valid({
      ...RULE,
      classification: { mode: "name_pattern", regex: REGEX, fallbackFieldId: "cfPPnum1" },
    });
    expect(
      classifyInvoice(doc("d", "Progress Invoice", { fields: { cfPPnum1: ["4"] } }), withField),
    ).toMatchObject({ status: "classified", pp: 4, source: "fallback field" });
    expect(classifyInvoice(doc("d", "PP#2 and PP#3"), config).status).toBe("ambiguous");
  });

  it("links within the same project only, and never PP#1 to a PP#10 task", () => {
    const tasks: PpTask[] = [
      { id: "a1", job_id: "job00000001", name: "PP#1: Deposit", is_group: false },
      { id: "a10", job_id: "job00000001", name: "PP#10: Final", is_group: false },
      { id: "b1", job_id: "job00000002", name: "PP#1: Deposit", is_group: false },
      { id: "c3", job_id: "job00000003", name: "PP#3: Framing", is_group: false },
      { id: "c3b", job_id: "job00000003", name: "PP#3: Framing (revised)", is_group: false },
    ];
    expect(templateMatches("PP#{pp}", 1, "PP#10: Final")).toBe(false);
    const byJob = new Map<string, PpTask[]>();
    for (const t of tasks) byJob.set(t.job_id!, [...(byJob.get(t.job_id!) ?? []), t]);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(matchTask(doc("d", "PP#1"), 1, config, byJob, byId)).toMatchObject({
      status: "matched",
      taskId: "a1",
    });
    expect(matchTask(doc("d", "PP#10"), 10, config, byJob, byId)).toMatchObject({
      status: "matched",
      taskId: "a10",
    });
    expect(matchTask(doc("d", "PP#3"), 3, config, byJob, byId).status).toBe("unmatched");
    expect(
      matchTask(doc("d", "PP#3", { job_id: "job00000003" }), 3, config, byJob, byId),
    ).toMatchObject({ status: "ambiguous" });
    const direct = valid({
      ...RULE,
      link: { mode: "task_name_pattern", template: "PP#{pp}:", directFieldId: "cfTaskId1" },
    });
    expect(
      matchTask(doc("d", "PP#1", { fields: { cfTaskId1: ["b1"] } }), 1, direct, byJob, byId),
    ).toMatchObject({ status: "unmatched", reason: expect.stringMatching(/different project/) });
    const p = previewPpMatches(
      [
        doc("d1", "PP#1"),
        doc("d2", "Progress Invoice"),
        doc("d3", "PP#3", { job_id: "job00000003" }),
      ],
      tasks,
      [],
      config,
    );
    expect(p).toMatchObject({ inspected: 3, classified: 2, byNumber: { "1": 1, "3": 1 } });
    expect(p.unclassified.map((i) => i.documentId)).toEqual(["d2"]);
    expect(p.ambiguous.map((i) => i.documentId)).toEqual(["d3"]);
  });

  it("validates percentages to 100% and labels project overrides", () => {
    const r = validatePpConfig({
      percentages: { standard: { ...DEFAULT_PP_CONFIG.percentages.standard, "10": 20 } },
    });
    expect(!r.ok && r.errors[0]).toMatchObject({
      path: "percentages.standard",
      message: expect.stringMatching(/total 100%/),
    });
    const split = {
      "1": 5,
      "2": 5,
      "3": 10,
      "4": 10,
      "5": 10,
      "6": 10,
      "7": 10,
      "8": 10,
      "9": 10,
      "10": 20,
    };
    const cfg = valid({
      ...RULE,
      percentages: {
        standard: DEFAULT_PP_CONFIG.percentages.standard,
        overrides: [{ jobId: "job00000002", split }],
      },
    });
    expect(milestonePercent(cfg, 10, "job00000001")).toEqual({ pct: 10, source: "standard" });
    expect(milestonePercent(cfg, 10, "job00000002")).toEqual({
      pct: 20,
      source: "project override",
    });
  });

  it("treats only approved links as verified unless autoAccept is on", () => {
    const link = (id: string, status: PpLinkRow["status"]): PpLinkRow => ({
      document_id: id,
      task_id: "a1",
      job_id: "job00000001",
      pp_number: "1",
      milestone_pct: null,
      match_method: "rule",
      status,
    });
    const links = [link("s", "suggested"), link("a", "approved"), link("r", "rejected")];
    expect([...effectiveLinks(links, valid(RULE)).keys()]).toEqual(["a"]);
    expect(
      [...effectiveLinks(links, valid({ ...RULE, autoAcceptUnique: true })).keys()].sort(),
    ).toEqual(["a", "s"]);
    expect(valid(RULE).autoAcceptUnique).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End to end over the fixture (memory store)
// ---------------------------------------------------------------------------
describe("PP# workflow end to end", () => {
  const base = DOCUMENTS[4]!;
  const invoice = (id: string, name: string, job: string, extra: Record<string, unknown> = {}) => ({
    ...base,
    id,
    name,
    number: id.slice(-2),
    status: "approved",
    job: { id: job },
    ...extra,
  });
  const DOCS = [
    ...DOCUMENTS.slice(0, 4),
    invoice("docPP00001", "PP#1", "job00000001", { price: 30_000 }),
    invoice("docPP00002", "PP#2: Foundation", "job00000001"),
    invoice("docPP00010", "PP#10 - Final Payment", "job00000001"),
    invoice("docPP00011", "PP#11", "job00000001"),
    invoice("docPP00012", "Progress Invoice", "job00000001"),
    invoice("docPP00013", "Progress Payment PP#5", "job00000002"),
    invoice("docPP00014", "PP#3", "job00000003"),
  ];
  const task = (id: string, name: string, job: string) => ({
    id,
    name,
    startDate: "2026-05-01",
    endDate: "2026-06-01",
    progress: 0,
    completed: 0,
    isGroup: false,
    isToDo: false,
    createdAt: "2026-03-01T00:00:00Z",
    job: { id: job },
    parentTask: null,
  });
  const TASKS = [
    task("tk1", "PP#1: Deposit", "job00000001"),
    task("tk2", "PP#2: Foundation", "job00000001"),
    task("tk10", "PP#10: Final", "job00000001"),
    task("tk5other", "PP#5: Drywall", "job00000003"),
    task("tk3a", "PP#3: Framing", "job00000003"),
    task("tk3b", "PP#3: Framing (B)", "job00000003"),
  ];
  const ctx = (who: Requester, isAdmin = true) =>
    ({ requester: who, access: { isAdmin } }) as unknown as ReportsContext;
  const act = (body: unknown) =>
    runFinancialAction(ctx(admin), body) as Promise<Record<string, unknown>>;

  async function sync() {
    await runFullSync("test");
    await requestEntitySync({ entities: ["tasks"], triggeredBy: "test" });
    const { claimJobById, completeJob } = await import("@/lib/jobs/queue");
    for (let i = 0; i < 20; i++) {
      const job = listMemoryJobsForTests().find(
        (j) => j.status === "queued" && j.metadata.mode === "entities",
      );
      if (!job) break;
      await claimJobById(job.id);
      await processEntitySyncJob(job.metadata, { budgetMs: 60_000 });
      await completeJob(job.id);
    }
    invalidate();
  }
  function invalidate() {
    invalidateCatalogContext();
    invalidateFieldCatalog();
    invalidateFinancialContext();
  }

  beforeEach(async () => {
    await setupAgentTestEnv();
    resetMemoryJobsForTests();
    resetTolerantUpsertForTests();
    installFakePave({ records: { documents: DOCS, tasks: TASKS } });
    await sync();
  });
  afterEach(() => uninstallFakePave());

  it("previews an edited v0 config without saving, then saves it and reloads it", async () => {
    expect((await getPpConfig()).version).toBe(0);
    const preview = await act({ action: "preview_pp", config: RULE });
    expect(preview.ok).toBe(true);
    const p = preview.preview as {
      inspected: number;
      classified: number;
      byNumber: Record<string, number>;
    };
    expect(p).toMatchObject({
      inspected: 7,
      classified: 5,
      byNumber: { "1": 1, "2": 1, "3": 1, "5": 1, "10": 1 },
    });
    expect((await getPpConfig()).version).toBe(0); // preview persists nothing
    expect(await agentDb().select("bi_pp_links", {})).toHaveLength(0);
    const saved = await act({ action: "save_pp_config", config: RULE, expectedVersion: 0 });
    expect(saved).toMatchObject({ ok: true, saved: { version: 1 } });
    invalidate();
    const reopened = await act({ action: "get_pp" });
    expect(reopened).toMatchObject({
      saved: { version: 1 },
      config: { classification: { regex: REGEX }, link: { template: "PP#{pp}:" } },
    });
  });

  it("returns field-path errors (422 body) and keeps the saved version on a bad save", async () => {
    const r = await act({
      action: "save_pp_config",
      config: { classification: { mode: "name_pattern" } },
      expectedVersion: 0,
    });
    expect(r).toMatchObject({
      ok: false,
      errors: [
        {
          path: "classification.regex",
          message: "Required when classification.mode is name_pattern.",
        },
      ],
    });
    expect(await act({ action: "save_pp_config", config: RULE })).toMatchObject({
      ok: false,
      errors: [{ path: "expectedVersion" }],
    });
    expect((await getPpConfig()).version).toBe(0);
  });

  it("refuses a stale editor (optimistic concurrency) and keeps history", async () => {
    await savePpConfig(valid(RULE), ADMIN_ID, 0);
    await expect(
      savePpConfig(valid({ ...RULE, autoAcceptUnique: true }), ADMIN_ID, 0),
    ).rejects.toBeInstanceOf(PpConfigConflictError);
    await savePpConfig(valid({ ...RULE, caseSensitive: true }), ADMIN_ID, 1);
    const history = await agentDb().select<{ version: number }>("bi_pp_config_history", {});
    expect(history.map((h) => h.version).sort()).toEqual([1, 2]);
  });

  it("suggests same-project links, needs approval, and keeps decisions through sync and rule changes", async () => {
    await savePpConfig(valid(RULE), ADMIN_ID, 0);
    invalidate();
    const s = await recordSuggestions();
    expect(s).toMatchObject({ created: 3, ambiguous: 1 }); // PP#1, PP#2, PP#10 on job 1; PP#3 ambiguous; PP#5 has no task in its project
    invalidate();
    let rows = (await loadSourceRows("documents")).rows;
    const r1 = rows.find((r) => r.id === "docPP00001")!;
    expect(r1).toMatchObject({
      "doc.ppNumber": 1,
      "doc.ppApproval": "Pending approval",
      "doc.ppVerified": false,
      "doc.milestoneTaskId": null,
    });
    expect(rows.find((r) => r.id === "docPP00011")).toMatchObject({
      "doc.ppNumber": null,
      "doc.ppApproval": "Unclassified",
    });
    await decidePpLink({ documentId: "docPP00001", decision: "approve", actor: ADMIN_ID });
    await decidePpLink({
      documentId: "docPP00012",
      decision: "manual",
      ppNumber: 4,
      actor: ADMIN_ID,
    });
    await expect(
      decidePpLink({
        documentId: "docPP00014",
        decision: "manual",
        ppNumber: 3,
        taskId: "tk1",
        actor: ADMIN_ID,
      }),
    ).rejects.toThrow(/different project/);
    await decidePpLink({
      documentId: "docPP00014",
      decision: "manual",
      ppNumber: 3,
      taskId: "tk3b",
      actor: ADMIN_ID,
    });
    // Resync, re-run the rule, and change the rule: decisions survive, nothing duplicates.
    await sync();
    await recordSuggestions();
    await savePpConfig(
      valid({ ...RULE, link: { mode: "task_name_pattern", template: "Payment {pp}:" } }),
      ADMIN_ID,
      1,
    );
    invalidate();
    const links = await agentDb().select<PpLinkRow & { decided_by: string }>("bi_pp_links", {});
    expect(links.filter((l) => l.document_id === "docPP00001")).toHaveLength(1);
    const approved = links.find((l) => l.document_id === "docPP00001")!;
    expect(approved).toMatchObject({
      status: "approved",
      task_id: "tk1",
      decided_by: ADMIN_ID,
      conflict: expect.stringMatching(/no longer matches/),
    });
    expect(links.find((l) => l.document_id === "docPP00012")).toMatchObject({
      status: "approved",
      pp_number: "4",
      classification_method: "manual",
      conflict: null,
    });
    rows = (await loadSourceRows("documents")).rows;
    expect(rows.find((r) => r.id === "docPP00001")).toMatchObject({
      "doc.milestoneTaskId": "tk1",
      "doc.milestone": "PP#1: Deposit",
      "doc.ppApproval": "Approved — needs review (conflict)",
    });
    expect(rows.find((r) => r.id === "docPP00014")).toMatchObject({
      "doc.milestoneTaskId": "tk3b",
      "doc.ppVerified": true,
      "doc.milestoneStart": "2026-05-01",
    });
  });

  it("uses suggested links in reports only when autoAccept is on", async () => {
    await savePpConfig(valid({ ...RULE, autoAcceptUnique: true }), ADMIN_ID, 0);
    invalidate();
    await recordSuggestions();
    invalidate();
    const row = (await loadSourceRows("documents")).rows.find((r) => r.id === "docPP00002")!;
    expect(row).toMatchObject({
      "doc.milestoneTaskId": "tk2",
      "doc.ppApproval": "Auto-accepted (unique match)",
      "doc.ppVerified": false,
    });
  });

  it("applies percentages without touching invoice amounts", async () => {
    await savePpConfig(valid(RULE), ADMIN_ID, 0);
    invalidate();
    const row = (await loadSourceRows("documents")).rows.find((r) => r.id === "docPP00001")!;
    expect(row).toMatchObject({
      "doc.milestonePct": 10,
      "doc.milestonePctSource": "standard",
      "doc.amount": 30_000,
      "doc.total": 30_000,
    });
  });

  it("drills Project → PP# → Invoice → Task inside one project", async () => {
    await savePpConfig(valid(RULE), ADMIN_ID, 0);
    invalidate();
    await recordSuggestions();
    await decidePpLink({ documentId: "docPP00001", decision: "approve", actor: ADMIN_ID });
    const drill = await projectFinancialDrill("job00000001");
    expect(drill.levels.filter((l) => l.enabled).map((l) => l.key)).toEqual([
      "project",
      "pp",
      "invoice",
      "task",
    ]);
    expect(drill.pp).toHaveLength(10);
    expect(drill.pp![0]).toMatchObject({
      pp: 1,
      percent: 10,
      invoices: [{ id: "docPP00001", task: { id: "tk1" } }],
    });
    expect(drill.pp![1]!.invoices[0]).toMatchObject({
      id: "docPP00002",
      task: null,
      ppApproval: "Pending approval",
    });
    const all = drill.pp!.flatMap((p) => p.invoices).map((i) => i.id);
    expect(all).not.toContain("docPP00014");
    expect(drill.invoices.map((i) => i.id)).toEqual(
      expect.arrayContaining(["docPP00011", "docPP00012"]),
    );
  });

  it("answers Dexter's PP# questions without presenting unapproved links as verified", async () => {
    await savePpConfig(valid(RULE), ADMIN_ID, 0);
    invalidate();
    await recordSuggestions();
    await decidePpLink({ documentId: "docPP00001", decision: "approve", actor: ADMIN_ID });
    const tool = getTool("reports_pp_milestones")!;
    const call = async (args: unknown, who = admin) =>
      (
        await tool.execute(
          {
            task: { id: "00000000-0000-4000-8000-0000000000f7", allowed_context: {} } as never,
            agent: { row: { id: "x" } } as never,
            requester: who,
            access: new Set<never>(),
          },
          args,
        )
      ).data as Record<string, unknown>;
    const pending = (await call({ action: "pending" })).invoices as Array<{
      invoiceId: string;
      verified: boolean;
    }>;
    expect(pending.map((p) => p.invoiceId)).toEqual(
      expect.arrayContaining(["docPP00002", "docPP00010"]),
    );
    expect(pending.every((p) => !p.verified)).toBe(true);
    const pp1 = (await call({ action: "by_number", pp: 1 })).invoices as Array<
      Record<string, unknown>
    >;
    expect(pp1[0]).toMatchObject({
      verified: true,
      milestone: "PP#1: Deposit",
      paymentStatus: expect.any(String),
      balanceVerification: "Unverified (payments not synced)",
    });
    const missing = (await call({ action: "missing_milestone" })).invoices as Array<{
      invoiceId: string;
    }>;
    expect(missing.map((m) => m.invoiceId)).not.toContain("docPP00001");
    expect((await call({ action: "schedule", jobName: JOBS[0]!.name })).pp).toHaveLength(10);
    const asEmployee = await call({ action: "by_number", pp: 1 }, employee);
    expect(JSON.stringify(asEmployee)).not.toMatch(/"amount":\d/);
  });

  it("keeps PP# administration to admins and invoices to their own project", async () => {
    expect((await getReportsAccess(employee)).isAdmin).toBe(false);
    expect((await getReportsAccess(admin)).isAdmin).toBe(true);
    await expect(
      decidePpLink({ documentId: "docOrder001", decision: "manual", ppNumber: 1, actor: ADMIN_ID }),
    ).rejects.toThrow(/Only customer invoices/);
    await expect(
      decidePpLink({ documentId: "docPP00001", decision: "manual", ppNumber: 11, actor: ADMIN_ID }),
    ).rejects.toThrow(/1 to 10/);
  });
});
