/**
 * Open/Closed project status on expense_jobs — sync, picker filtering, and the
 * "existing links keep working" rule for receipts and inventory.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  clearProjectLogCacheForTests,
  setProjectRegistryLoadDepsForTests,
  type ProjectLogRow,
} from "@/lib/baxter-data/project-registry";
import {
  applyProjectLogView,
  buildProjectLogViewQuery,
  countProjectLogStatuses,
  parseProjectLogViewParams,
} from "@/lib/baxter-data/project-registry/log-view";
import {
  createCustomExpenseJob,
  createReceipt,
  listExpenseJobs,
  listExpenseJobsRaw,
  reorderExpenseJobs,
  resetReceiptLogMemoryForTests,
  updateExpenseJob,
} from "@/lib/receipts/store";
import { syncExpenseJobsFromMasterProjectLog } from "@/lib/receipts/sync-jobs";
import { splitPickerJobs, type ExpenseJob } from "@/lib/receipts/types";
import {
  assertInventoryProjectAssignable,
  createInventoryItem,
  rememberInventoryJobLabelForTests,
  resetInventoryMemoryForTests,
  updateInventoryItem,
  type InventoryItemInput,
} from "@/lib/inventory/store";

const ACTOR = "22222222-2222-4222-8222-222222222222";

function row(projectNumber: string, status: ProjectLogRow["status"], i: number): ProjectLogRow {
  return {
    projectNumber,
    shortName: `Name${i}`,
    salesperson: "Jenn Lee",
    startDate: "3/1/2026",
    customerName: `Customer ${i}`,
    street: `${i} Main St`,
    city: "San Jose",
    postalCode: "95110",
    jurisdiction: "San Jose",
    status,
    rowNumber: 7 + i,
  };
}

const SHEET: ProjectLogRow[] = [
  row("L01-26001", "open", 0),
  row("L01-26002", "closed", 1),
  row("L01-26003", "unknown", 2),
];

function byNumber<T extends { project_number: string | null }>(jobs: T[], number: string) {
  return jobs.find((j) => j.project_number === number);
}

beforeEach(() => {
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetReceiptLogMemoryForTests();
  clearProjectLogCacheForTests();
  setProjectRegistryLoadDepsForTests({ rowsOverride: SHEET });
});

afterEach(() => {
  setProjectRegistryLoadDepsForTests(null);
  clearProjectLogCacheForTests();
});

describe("syncExpenseJobsFromMasterProjectLog status", () => {
  it("stores each row's project_status and returns status counts", async () => {
    const result = await syncExpenseJobsFromMasterProjectLog();
    expect(result.statusCounts).toEqual({ open: 1, closed: 1, unknown: 1 });
    const jobs = await listExpenseJobsRaw({ includeInactive: true });
    expect(byNumber(jobs, "L01-26001")?.project_status).toBe("open");
    expect(byNumber(jobs, "L01-26002")?.project_status).toBe("closed");
    expect(byNumber(jobs, "L01-26003")?.project_status).toBe("unknown");
  });

  it("closes rows that drop off the sheet and reopens them if they return", async () => {
    await syncExpenseJobsFromMasterProjectLog();
    setProjectRegistryLoadDepsForTests({ rowsOverride: [SHEET[1]!, SHEET[2]!] });
    const second = await syncExpenseJobsFromMasterProjectLog();
    expect(second.deactivatedMissing).toBe(1);
    let jobs = await listExpenseJobsRaw({ includeInactive: true });
    expect(byNumber(jobs, "L01-26001")?.project_status).toBe("closed");

    setProjectRegistryLoadDepsForTests({ rowsOverride: SHEET });
    await syncExpenseJobsFromMasterProjectLog();
    jobs = await listExpenseJobsRaw({ includeInactive: true });
    expect(byNumber(jobs, "L01-26001")?.project_status).toBe("open");
  });

  it("does not close everything when the sheet read comes back empty", async () => {
    await syncExpenseJobsFromMasterProjectLog();
    setProjectRegistryLoadDepsForTests({ rowsOverride: [] });
    const empty = await syncExpenseJobsFromMasterProjectLog();
    expect(empty.deactivatedMissing).toBe(0);
    const jobs = await listExpenseJobsRaw({ includeInactive: true });
    expect(byNumber(jobs, "L01-26001")?.project_status).toBe("open");
  });

  it("preserves is_active and sort_order and leaves custom rows alone", async () => {
    await syncExpenseJobsFromMasterProjectLog();
    const custom = await createCustomExpenseJob({ label: "Office supplies", createdBy: ACTOR });
    const before = await listExpenseJobsRaw({ includeInactive: true });
    const open = byNumber(before, "L01-26001")!;
    await updateExpenseJob({ id: open.id, isActive: false, updatedBy: ACTOR });
    await reorderExpenseJobs([custom.id, open.id], ACTOR);
    const customBefore = before.find((j) => j.id === custom.id)!;

    setProjectRegistryLoadDepsForTests({
      rowsOverride: [{ ...SHEET[0]!, status: "closed" }, SHEET[1]!, SHEET[2]!],
    });
    await syncExpenseJobsFromMasterProjectLog();
    const after = await listExpenseJobsRaw({ includeInactive: true });
    const synced = after.find((j) => j.id === open.id)!;
    expect(synced.project_status).toBe("closed");
    expect(synced.is_active).toBe(false);
    expect(synced.sort_order).toBe(20);
    const customAfter = after.find((j) => j.id === custom.id)!;
    expect(customAfter).toMatchObject({
      label: customBefore.label,
      is_active: true,
      sort_order: 10,
      project_status: "unknown",
      source: "custom",
    });
  });
});

describe("listExpenseJobs picker filtering", () => {
  it("pickers get Open projects and active custom jobs only", async () => {
    await syncExpenseJobsFromMasterProjectLog();
    const custom = await createCustomExpenseJob({ label: "Shop", createdBy: ACTOR });
    const hiddenCustom = await createCustomExpenseJob({
      label: "Old shop",
      isActive: false,
      createdBy: ACTOR,
    });

    const picker = await listExpenseJobs({ includeInactive: false });
    expect(picker.map((j) => j.projectNumber ?? j.label).sort()).toEqual(["L01-26001", "Shop"]);
    expect(picker.some((j) => j.id === custom.id)).toBe(true);
    expect(picker.some((j) => j.id === hiddenCustom.id)).toBe(false);
    // Default options behave like a picker.
    expect((await listExpenseJobs()).map((j) => j.id).sort()).toEqual(
      picker.map((j) => j.id).sort(),
    );
  });

  it("includeInactive returns every row regardless of status", async () => {
    await syncExpenseJobsFromMasterProjectLog();
    await createCustomExpenseJob({ label: "Old shop", isActive: false, createdBy: ACTOR });
    const all = await listExpenseJobs({ includeInactive: true });
    expect(all).toHaveLength(4);
    expect(all.map((j) => j.projectStatus).sort()).toEqual([
      "closed",
      "open",
      "unknown",
      "unknown",
    ]);
  });

  it("receipts can't be logged against a Closed or Unknown project", async () => {
    await syncExpenseJobsFromMasterProjectLog();
    const all = await listExpenseJobs({ includeInactive: true });
    const base = {
      amountCents: 1000,
      vendor: "Home Depot",
      purchasedOn: "2026-10-01",
      submittedBy: ACTOR,
    };
    const closed = all.find((j) => j.projectNumber === "L01-26002")!;
    const unknown = all.find((j) => j.projectNumber === "L01-26003")!;
    const open = all.find((j) => j.projectNumber === "L01-26001")!;
    await expect(createReceipt({ ...base, jobId: closed.id })).rejects.toThrow(/Closed/);
    await expect(createReceipt({ ...base, jobId: unknown.id })).rejects.toThrow(/marked Open/);
    await expect(createReceipt({ ...base, jobId: open.id })).resolves.toMatchObject({
      jobId: open.id,
    });
  });
});

describe("splitPickerJobs", () => {
  function job(id: string, overrides: Partial<ExpenseJob>): ExpenseJob {
    return {
      id,
      label: `Job ${id}`,
      projectNumber: `L01-${id}`,
      source: "project",
      projectStatus: "open",
      isActive: true,
      sortOrder: 0,
      createdBy: null,
      updatedBy: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("offers pickable jobs and labels Closed links that records still use", () => {
    const jobs = [
      job("1", {}),
      job("2", { projectStatus: "closed" }),
      job("3", { projectStatus: "unknown" }),
    ];
    const { pickable, linkedLabels } = splitPickerJobs(jobs, ["1", "2", "3", null]);
    expect(pickable.map((j) => j.id)).toEqual(["1"]);
    expect(linkedLabels).toEqual({ "2": "Job 2 (Closed)", "3": "Job 3" });
  });
});

describe("inventory project assignment", () => {
  const JOB_ID = "11111111-1111-4111-8111-111111111111";

  function input(overrides: Partial<InventoryItemInput> = {}): InventoryItemInput {
    return {
      itemName: "Kitchen faucet",
      sku: "SKU-1",
      quantity: 1,
      unitCostCents: 1000,
      jobId: JOB_ID,
      actorId: ACTOR,
      ...overrides,
    };
  }

  beforeEach(() => {
    resetInventoryMemoryForTests();
  });

  it("rejects a new assignment to a Closed project", async () => {
    rememberInventoryJobLabelForTests(JOB_ID, "Closed ADU", { projectStatus: "closed" });
    await expect(createInventoryItem(input())).rejects.toThrow(/Closed/);
    await expect(assertInventoryProjectAssignable({ jobId: JOB_ID })).rejects.toThrow(/Closed/);
  });

  it("re-saving an item already linked to a now-Closed project still works", async () => {
    rememberInventoryJobLabelForTests(JOB_ID, "Chechetenko ADU");
    const item = await createInventoryItem(input());
    rememberInventoryJobLabelForTests(JOB_ID, "Chechetenko ADU", { projectStatus: "closed" });
    const saved = await updateInventoryItem(item.id, input({ itemName: "Bath faucet" }));
    expect(saved).toMatchObject({
      jobId: JOB_ID,
      projectLabel: "Chechetenko ADU",
      itemName: "Bath faucet",
    });
  });

  it("moving an existing item onto a different Closed project is rejected", async () => {
    const OTHER = "33333333-3333-4333-8333-333333333333";
    rememberInventoryJobLabelForTests(JOB_ID, "Open ADU");
    rememberInventoryJobLabelForTests(OTHER, "Closed ADU", { projectStatus: "closed" });
    const item = await createInventoryItem(input());
    await expect(updateInventoryItem(item.id, input({ jobId: OTHER }))).rejects.toThrow(/Closed/);
  });
});

describe("Master Project Log admin view", () => {
  it("defaults to Open, sorts by name, searches, and round-trips the URL", () => {
    const view = parseProjectLogViewParams({});
    expect(view).toEqual({ status: "open", sort: "name-asc", q: "" });
    expect(buildProjectLogViewQuery(view)).toBe("");

    const rows = [
      { ...SHEET[0]!, shortName: "Zeta" },
      { ...SHEET[1]!, shortName: "Alpha" },
      { ...SHEET[2]!, shortName: "Mid", city: "Campbell" },
      { ...SHEET[0]!, projectNumber: "L01-26010", shortName: "Beta" },
    ];
    expect(countProjectLogStatuses(rows)).toEqual({ all: 4, open: 2, closed: 1, unknown: 1 });
    expect(applyProjectLogView(rows, view).map((r) => r.shortName)).toEqual(["Beta", "Zeta"]);
    expect(
      applyProjectLogView(rows, { ...view, status: "all", sort: "name-desc" }).map(
        (r) => r.shortName,
      ),
    ).toEqual(["Zeta", "Mid", "Beta", "Alpha"]);
    expect(
      applyProjectLogView(rows, { status: "all", sort: "number-desc", q: "" }).map(
        (r) => r.projectNumber,
      ),
    ).toEqual(["L01-26010", "L01-26003", "L01-26002", "L01-26001"]);
    expect(
      applyProjectLogView(rows, { status: "all", sort: "name-asc", q: "campbell" }),
    ).toHaveLength(1);

    const shared = { status: "closed", sort: "number-asc", q: "jenn" } as const;
    const query = buildProjectLogViewQuery(shared);
    expect(query).toBe("?status=closed&sort=number-asc&q=jenn");
    expect(parseProjectLogViewParams(Object.fromEntries(new URLSearchParams(query)))).toEqual(
      shared,
    );
    expect(parseProjectLogViewParams({ status: "bogus", sort: "nope" })).toEqual(view);
  });
});
