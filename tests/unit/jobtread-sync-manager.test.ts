/**
 * Sync Manager, report dependencies/freshness, region mappings, and Dexter's data-sync tools.
 * Synthetic JobTread fixture only (src/lib/jobtread/fixture.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideApproval, listApprovals } from "@/lib/agents/approvals";
import { agentDb, eq } from "@/lib/agents/store";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { orderByDependencies, SYNC_ENTITIES } from "@/lib/jobtread/entities";
import { COST_ITEMS } from "@/lib/jobtread/fixture";
import {
  advanceRun,
  classifySyncError,
  ensureEntityStates,
  getEntityRun,
  getEntityState,
  getSyncManagerOverview,
  lastScheduledInstant,
  listEntityRuns,
  maybeEnqueueScheduledEntitySync,
  processEntitySyncJob,
  requestEntitySync,
  retryEntitySync,
  setEntityEnabled,
  type EntityRunRow,
} from "@/lib/jobtread/sync-manager";
import { JobTreadError } from "@/lib/jobtread/client";
import { listMemoryJobsForTests, resetMemoryJobsForTests } from "@/lib/jobs/queue";
import { invalidateDataHealthCache, reportDataHealth } from "@/lib/reports/data-health";
import { assessFreshness, reportDependencies } from "@/lib/reports/dependencies";
import { modelRowFromCache } from "@/lib/reports/engine";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { applyValueMappings, saveValueMapping, suggestPrefixes } from "@/lib/reports/mappings";
import { reportSpecSchema } from "@/lib/reports/spec";
import { ADMIN_ID, EMPLOYEE_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

// Multi-page syncs against the fixture can exceed 5s on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const employee = requester(EMPLOYEE_ID, "user", "Eli Employee");

const toolCtx = (r: Requester, taskId = "00000000-0000-4000-8000-0000000000f1") => ({
  task: { id: taskId, allowed_context: {} } as never,
  agent: { row: { id: "00000000-0000-4000-8000-00000000d0d0" } } as never,
  requester: r,
  access: new Set<never>(),
});

/** Run every queued Sync Manager job (and its continuations) to completion. */
async function drainJobs(budgetMs = 60_000) {
  for (let i = 0; i < 20; i++) {
    const job = listMemoryJobsForTests().find(
      (j) => j.status === "queued" && j.metadata.mode === "entities",
    );
    if (!job) return;
    const { claimJobById, completeJob } = await import("@/lib/jobs/queue");
    await claimJobById(job.id);
    await processEntitySyncJob(job.metadata, { budgetMs });
    await completeJob(job.id);
  }
}

const activeCostItems = async () =>
  (
    await agentDb().select<{ id: string; removed_at: string | null; unit_price: number | null }>(
      "jt_cost_items",
      { limit: 10_000 },
    )
  ).filter((r) => !r.removed_at);

beforeEach(async () => {
  await setupAgentTestEnv();
  resetMemoryJobsForTests();
  clearJobDetailCache();
  invalidateFieldCatalog();
  invalidateDataHealthCache();
});
afterEach(() => uninstallFakePave());

describe("entity registry", () => {
  it("orders dependencies first and keeps sensitive datasets off by default", async () => {
    expect(orderByDependencies(["cost_items", "jobs", "custom_fields", "catalog_models"])).toEqual([
      "custom_fields",
      "jobs",
      "catalog_models",
      "cost_items",
    ]);
    const states = await ensureEntityStates();
    expect(states).toHaveLength(SYNC_ENTITIES.length);
    const off = states.filter((s) => !s.enabled).map((s) => s.entity);
    expect(off).toEqual(
      expect.arrayContaining(["contacts", "daily_logs", "files", "payments", "time_entries"]),
    );
    expect(off).not.toContain("cost_items");
  });

  it("never requests contact emails/phones or file URLs", () => {
    const fields = SYNC_ENTITIES.flatMap((d) => Object.keys(d.nodes ?? {}));
    for (const banned of ["emailAddress", "email", "phoneNumber", "phone", "url", "downloadUrl"])
      expect(fields).not.toContain(banned);
  });
});

describe("cost item sync", () => {
  it("syncs every page, keeps blank prices blank, and reports real ids", async () => {
    installFakePave();
    const req = await requestEntitySync({ entities: ["cost_items"], triggeredBy: "test" });
    expect(req.batchId).toBeTruthy();
    expect(req.jobId).toBe(listMemoryJobsForTests()[0]!.id);
    expect(await getEntityRun(req.runs[0]!.runId)).toMatchObject({ status: "queued" });
    await drainJobs();
    const run = (await getEntityRun(req.runs[0]!.runId))!;
    expect(run).toMatchObject({ status: "completed", pages: 3, records_seen: COST_ITEMS.length });
    const rows = await activeCostItems();
    expect(rows).toHaveLength(COST_ITEMS.length);
    // Every 7th fixture line has no price in JobTread: it must stay null, never computed.
    const unpriced = COST_ITEMS.filter((c) => c.unitPrice === null).map((c) => c.id);
    expect(unpriced.length).toBeGreaterThan(10);
    for (const id of unpriced) expect(rows.find((r) => r.id === id)!.unit_price).toBeNull();
    const state = await getEntityState("cost_items");
    expect(state).toMatchObject({ status: "completed", records_cached: COST_ITEMS.length });
    expect(state.last_success_at).toBeTruthy();
  });

  it("checkpoints per page, keeps partial data, never erases, and resumes from the cursor", async () => {
    // A row cached by an earlier sync that JobTread no longer has.
    await agentDb().insert("jt_cost_items", {
      id: "ciGone",
      scope: "catalog",
      name: "Removed in JobTread",
      synced_at: "2026-01-01T00:00:00.000Z",
      removed_at: null,
    });
    const fake = { connection: "costItems", offset: 100, status: 400, times: 1 };
    installFakePave({ failAt: fake });
    const req = await requestEntitySync({ entities: ["cost_items"], triggeredBy: "test" });
    await drainJobs();
    const failed = (await getEntityRun(req.runs[0]!.runId))!;
    expect(failed).toMatchObject({ status: "partial", pages: 1, cursor: "100" });
    expect((await getEntityState("cost_items")).last_success_at).toBeNull();
    // First page cached; the stale row is untouched because the run didn't finish.
    const mid = await activeCostItems();
    expect(mid).toHaveLength(101);
    expect(mid.some((r) => r.id === "ciGone")).toBe(true);

    const retry = await retryEntitySync("cost_items", "test");
    const resumed = (await getEntityRun(retry.runs[0]!.runId))!;
    expect(resumed).toMatchObject({ resumed_from: failed.id, cursor: "100", pages: 1 });
    expect(resumed.generation).toBe(failed.generation);
    await drainJobs();
    expect(await getEntityRun(resumed.id)).toMatchObject({
      status: "completed",
      pages: 3,
      records_seen: COST_ITEMS.length,
      records_removed: 1,
    });
    const after = await activeCostItems();
    expect(after).toHaveLength(COST_ITEMS.length);
    expect(after.some((r) => r.id === "ciGone")).toBe(false);
  });

  it("hands off to a continuation job when the time budget runs out", async () => {
    installFakePave();
    const req = await requestEntitySync({ entities: ["cost_items"], triggeredBy: "test" });
    const first = await processEntitySyncJob({ batchId: req.batchId }, { budgetMs: 0 });
    expect(first.done).toBe(false);
    expect(first.continuationJobId).toBeTruthy();
    expect((await getEntityRun(req.runs[0]!.runId))!.status).toBe("queued");
    await drainJobs();
    expect((await getEntityRun(req.runs[0]!.runId))!.status).toBe("completed");
  });

  it("refuses to mass-remove rows when JobTread suddenly returns far fewer", async () => {
    installFakePave();
    await requestEntitySync({ entities: ["cost_items"], triggeredBy: "test" });
    await drainJobs();
    uninstallFakePave();
    installFakePave({ records: { costItems: COST_ITEMS.slice(0, 10) } });
    const req = await requestEntitySync({ entities: ["cost_items"], triggeredBy: "test" });
    await drainJobs();
    expect(await getEntityRun(req.runs[0]!.runId)).toMatchObject({
      status: "completed",
      records_removed: 0,
      error_code: "SHRINK_GUARD",
    });
    expect(await activeCostItems()).toHaveLength(COST_ITEMS.length);
  });

  it("drops fields JobTread says don't exist and records them", async () => {
    installFakePave({ missingFields: ["isSelected"] });
    await requestEntitySync({ entities: ["cost_items"], triggeredBy: "test" });
    await drainJobs();
    const state = await getEntityState("cost_items");
    expect(state.status).toBe("completed");
    expect(state.dropped_fields).toEqual(["isSelected"]);
  });

  it("marks permission problems as permission_blocked", async () => {
    installFakePave({ failFirst: [403] });
    await requestEntitySync({ entities: ["tasks"], triggeredBy: "test" });
    await drainJobs();
    expect(await getEntityState("tasks")).toMatchObject({ status: "permission_blocked" });
    expect(classifySyncError(new JobTreadError("x", "TIMEOUT")).status).toBe("failed");
  });

  it("never lets two workers page the same run", async () => {
    installFakePave();
    const req = await requestEntitySync({ entities: ["tasks"], triggeredBy: "test" });
    const run = (await getEntityRun(req.runs[0]!.runId))!;
    // Simulate a live worker holding the lease.
    await agentDb().update("jt_sync_entity_runs", [eq("id", run.id)], {
      status: "running",
      lease_id: "00000000-0000-4000-8000-00000000beef",
      heartbeat_at: new Date().toISOString(),
    });
    const held = (await getEntityRun(run.id)) as EntityRunRow;
    expect(await advanceRun(held, Date.now() + 10_000)).toBe("skipped");
  });
});

describe("requests, enable/disable, and core datasets", () => {
  it("skips disabled datasets and reuses an active run", async () => {
    installFakePave();
    const r = await requestEntitySync({ entities: ["contacts", "tasks"], triggeredBy: "test" });
    expect(r.skipped).toEqual([expect.objectContaining({ entity: "contacts" })]);
    const again = await requestEntitySync({ entities: ["tasks"], triggeredBy: "test" });
    expect(again.runs[0]).toMatchObject({ reused: true, runId: r.runs[0]!.runId });
    await setEntityEnabled("tasks", false, ADMIN_ID);
    expect((await getEntityRun(r.runs[0]!.runId))!.status).toBe("cancelled");
  });

  it("syncs core datasets through the existing functions and keeps legacy freshness", async () => {
    installFakePave();
    await requestEntitySync({ entities: ["jobs", "custom_fields"], triggeredBy: "test" });
    await drainJobs();
    const jobs = await agentDb().select("jt_jobs", {});
    expect(jobs).toHaveLength(6);
    const legacy = await agentDb().select<{ kind: string; status: string }>("jt_sync_runs", {});
    expect(legacy.map((r) => r.kind).sort()).toEqual(["jobs", "metadata"]);
    const overview = await getSyncManagerOverview();
    expect(overview.entities.find((e) => e.key === "jobs")).toMatchObject({
      status: "completed",
      recordsCached: 6,
    });
  });

  it("reports not_configured without a grant key", async () => {
    const overview = await getSyncManagerOverview();
    expect(overview.configured).toBe(false);
    expect(overview.entities.every((e) => e.status === "not_configured")).toBe(true);
    const r = await requestEntitySync({ entities: ["jobs"], triggeredBy: "test" });
    expect(r.batchId).toBeNull();
  });
});

describe("daily schedule", () => {
  it("computes the due instant and queues once per day", async () => {
    expect(lastScheduledInstant(new Date("2026-10-26T09:00:00Z"), 10).toISOString()).toBe(
      "2026-10-25T10:00:00.000Z",
    );
    expect(lastScheduledInstant(new Date("2026-10-26T10:30:00Z"), 10).toISOString()).toBe(
      "2026-10-26T10:00:00.000Z",
    );
    installFakePave();
    const now = new Date("2026-10-26T10:05:00Z");
    const first = await maybeEnqueueScheduledEntitySync(now);
    expect(first).toMatchObject({ enqueued: true, reason: "daily" });
    const runs = await listEntityRuns({ batchId: first.batchId! });
    expect(runs.map((r) => r.entity).sort()).toEqual(
      [
        "accounts",
        "catalog_models",
        "cost_groups",
        "cost_items",
        "custom_fields",
        "documents",
        "jobs",
        "tasks",
        "users",
      ].sort(),
    );
    const second = await maybeEnqueueScheduledEntitySync(new Date("2026-10-26T12:00:00Z"));
    expect(second).toMatchObject({ enqueued: false, reason: "Already queued for today" });
    process.env.JOBTREAD_DAILY_SYNC = "off";
    expect((await maybeEnqueueScheduledEntitySync(new Date("2026-10-28T12:00:00Z"))).reason).toBe(
      "JOBTREAD_DAILY_SYNC=off",
    );
    delete process.env.JOBTREAD_DAILY_SYNC;
  });
});

describe("report dependencies and freshness", () => {
  const spec = reportSpecSchema.parse({
    title: "Profit",
    datasets: [
      { id: "jobs", source: "jobs" },
      { id: "models", source: "catalog_models" },
    ],
    widgets: [
      {
        id: "gp",
        type: "kpi",
        dataset: "jobs",
        metric: { op: "sum", field: "job.orderGrossProfit" },
      },
      { id: "phase", type: "chart", dataset: "jobs", chart: "bar", groupBy: "sem:phase" },
      { id: "region", type: "chart", dataset: "models", chart: "bar", groupBy: "model.region" },
    ],
  });

  it("maps fields and sources to datasets per widget", () => {
    const deps = reportDependencies(spec);
    const by = Object.fromEntries(deps.datasets.map((d) => [d.entity, d.widgets]));
    expect(by.documents).toEqual(["gp"]);
    expect(by.custom_fields).toEqual(["phase"]);
    expect(by.catalog_models).toEqual(["region"]);
    expect(by.jobs).toEqual(expect.arrayContaining(["gp", "phase"]));
    expect(deps.mappingWidgets).toEqual(["region"]);
  });

  it("classifies freshness honestly", () => {
    const base = { key: "jobs" as const, label: "Jobs", enabled: true, lastError: null };
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(
      assessFreshness({ ...base, status: "completed", lastSuccessAt: "2026-10-26T10:00:00Z" }, now)
        .level,
    ).toBe("fresh");
    expect(
      assessFreshness({ ...base, status: "completed", lastSuccessAt: "2026-10-20T10:00:00Z" }, now)
        .level,
    ).toBe("stale");
    expect(assessFreshness({ ...base, status: "ready", lastSuccessAt: null }, now).level).toBe(
      "never",
    );
    const failed = assessFreshness(
      { ...base, status: "partial", lastSuccessAt: "2026-10-25T12:00:00Z" },
      now,
    );
    expect(failed).toMatchObject({ level: "failed" });
    expect(failed.message).toMatch(/stopped partway.*24 hours ago/);
  });

  it("warns per widget when a dependency was never synced", async () => {
    installFakePave();
    await requestEntitySync({
      entities: ["jobs", "custom_fields", "catalog_models"],
      triggeredBy: "test",
    });
    await drainJobs();
    invalidateDataHealthCache();
    const health = await reportDataHealth(spec);
    expect(health.status).toBe("warning");
    expect(health.widgetWarnings.gp?.[0]).toMatch(/Financial documents hasn't been synced/);
    expect(health.widgetWarnings.phase).toBeUndefined();
  });
});

describe("region mappings", () => {
  it("applies admin rules and only suggests prefixes", async () => {
    const rules = [
      { match_type: "prefix" as const, pattern: "LA -", value: "Los Angeles", priority: 100 },
      { match_type: "exact" as const, pattern: "SD - i 398", value: "San Diego", priority: 10 },
    ];
    expect(applyValueMappings("LA - i 498", rules)).toBe("Los Angeles");
    expect(applyValueMappings("SD - i 398", rules)).toBe("San Diego");
    expect(applyValueMappings("i 398", rules)).toBeNull();
    expect(suggestPrefixes(["LA - i 498", "LA - i 698", "i 398"])).toEqual([
      { pattern: "LA -", count: 2, examples: ["LA - i 498", "LA - i 698"] },
    ]);
    const row = {
      id: "m",
      name: "LA - i 498",
      description: "Product Library",
      item_count: 1,
      total_cost: 1,
      total_price: 2,
      synced_at: "",
    };
    expect(modelRowFromCache(row)["model.region"]).toBeNull();
    const saved = await saveValueMapping(
      {
        kind: "region",
        sourceField: "model.name",
        matchType: "prefix",
        pattern: "LA -",
        value: "Los Angeles",
      },
      ADMIN_ID,
    );
    expect(modelRowFromCache(row, [saved])["model.region"]).toBe("Los Angeles");
  });
});

describe("Dexter data sync tools", () => {
  const run = async (key: string, args: unknown, who: Requester, task?: string) =>
    (await getTool(key)!.execute(toolCtx(who, task), args)).data as Record<string, unknown>;

  it("reads overview, schedule, and freshness", async () => {
    installFakePave();
    const o = await run("reports_sync_overview", {}, employee);
    expect((o.datasets as unknown[]).length).toBe(SYNC_ENTITIES.length);
    expect(await run("reports_sync_schedule", {}, employee)).toMatchObject({ dailyEnabled: true });
    const f = await run("reports_data_freshness", { entities: ["jobs"] }, employee);
    expect(f.datasets).toEqual([expect.objectContaining({ entity: "jobs", level: "never" })]);
  });

  it("sends non-admin requests to approval and runs them only on an admin's approval", async () => {
    installFakePave();
    const r = await run("reports_sync_request", { entities: ["tasks"] }, employee);
    expect(r).toMatchObject({ status: "approval_requested" });
    expect(await listEntityRuns({})).toHaveLength(0);
    const [approval] = await listApprovals({ status: "pending" });
    await expect(
      decideApproval({ id: approval!.id, decision: "approved", userId: EMPLOYEE_ID, note: null }),
    ).rejects.toThrow(/Only an administrator/);
    await decideApproval({ id: approval!.id, decision: "approved", userId: ADMIN_ID, note: null });
    expect((await listEntityRuns({})).map((x) => x.entity)).toEqual(["tasks"]);
  });

  it("makes admins confirm in a later turn and returns the real run ids", async () => {
    installFakePave();
    const turn1 = "00000000-0000-4000-8000-0000000000a1";
    const turn2 = "00000000-0000-4000-8000-0000000000a2";
    const preview = await run("reports_sync_request", { entities: ["tasks"] }, admin, turn1);
    expect(preview.status).toBe("needs_confirmation");
    const token = preview.confirmToken as string;
    expect(
      await run("reports_sync_request", { entities: ["tasks"], confirmToken: token }, admin, turn1),
    ).toMatchObject({ ok: false });
    expect(
      await run(
        "reports_sync_request",
        { entities: ["cost_items"], confirmToken: token },
        admin,
        turn2,
      ),
    ).toMatchObject({ ok: false });
    const done = await run(
      "reports_sync_request",
      { entities: ["tasks"], confirmToken: token },
      admin,
      turn2,
    );
    expect(done.status).toBe("done");
    const [dbRun] = await listEntityRuns({ entity: "tasks" });
    expect(done.runs).toEqual([expect.objectContaining({ runId: dbRun!.id, entity: "tasks" })]);
    expect(done.jobId).toBe(dbRun!.job_id);
    const audit = await agentDb().select<{ action: string }>("ai_audit_log", {});
    expect(audit.map((a) => a.action)).toContain("jobtread.sync_manager.sync");
  });

  it("enables a dataset only after confirmation", async () => {
    const p = await run("reports_sync_enable", { entity: "contacts", enabled: true }, admin);
    expect(p).toMatchObject({ status: "needs_confirmation", preview: { sensitivity: "customer" } });
    expect((await getEntityState("contacts")).enabled).toBe(false);
    await run(
      "reports_sync_enable",
      { entity: "contacts", enabled: true, confirmToken: p.confirmToken },
      admin,
      "00000000-0000-4000-8000-0000000000a9",
    );
    expect((await getEntityState("contacts")).enabled).toBe(true);
  });
});
