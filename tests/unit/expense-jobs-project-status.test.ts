/**
 * Open/Closed project status on expense_jobs — sync, the per-tool selection rule
 * (inspections Open-only; receipts and inventory Open or Closed), and existing links.
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
import { isSelectableExpenseJob, splitPickerJobs, type ExpenseJob } from "@/lib/receipts/types";
import {
  createSiteInspection,
  listTemplates,
  resetSiteInspectionMemoryForTests,
  updateSiteInspectionDetails,
} from "@/lib/inspections";
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

function byNumberJob(jobs: ExpenseJob[], number: string): ExpenseJob {
  const job = jobs.find((j) => j.projectNumber === number);
  if (!job) throw new Error(`missing ${number}`);
  return job;
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

  it("allowClosed adds Closed projects but never Unknown or hidden ones", async () => {
    await syncExpenseJobsFromMasterProjectLog();
    await createCustomExpenseJob({ label: "Shop", createdBy: ACTOR });
    const before = await listExpenseJobs({ includeInactive: true });
    await updateExpenseJob({
      id: byNumberJob(before, "L01-26001").id,
      isActive: false,
      updatedBy: ACTOR,
    });
    const picker = await listExpenseJobs({ includeInactive: false, allowClosed: true });
    expect(picker.map((j) => j.projectNumber ?? j.label).sort()).toEqual(["L01-26002", "Shop"]);
  });

  it("receipts accept Open and Closed projects but not Unknown or hidden ones", async () => {
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
    await expect(createReceipt({ ...base, jobId: closed.id })).resolves.toMatchObject({
      jobId: closed.id,
    });
    await expect(createReceipt({ ...base, jobId: unknown.id })).rejects.toThrow(
      "That project isn't marked Open or Closed on the Master Project Log. Choose another project.",
    );
    await expect(createReceipt({ ...base, jobId: open.id })).resolves.toMatchObject({
      jobId: open.id,
    });
    await updateExpenseJob({ id: closed.id, isActive: false, updatedBy: ACTOR });
    await expect(createReceipt({ ...base, jobId: closed.id })).rejects.toThrow(/hidden/);
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

  it("Open-only (inspections) offers Open jobs and labels Closed links records still use", () => {
    const jobs = [
      job("1", {}),
      job("2", { projectStatus: "closed" }),
      job("3", { projectStatus: "unknown" }),
    ];
    const { pickable, linkedLabels } = splitPickerJobs(jobs, ["1", "2", "3", null], {
      allowClosed: false,
    });
    expect(pickable.map((j) => j.id)).toEqual(["1"]);
    expect(linkedLabels).toEqual({ "2": "Job 2 (Closed)", "3": "Job 3" });
  });

  it("allowClosed (receipts, inventory) offers Open and Closed jobs", () => {
    const jobs = [
      job("1", {}),
      job("2", { projectStatus: "closed" }),
      job("3", { projectStatus: "unknown" }),
      job("4", { projectStatus: "closed", isActive: false }),
    ];
    const { pickable, linkedLabels } = splitPickerJobs(jobs, ["2", "3", "4"], {
      allowClosed: true,
    });
    expect(pickable.map((j) => j.id)).toEqual(["1", "2"]);
    expect(linkedLabels).toEqual({ "3": "Job 3", "4": "Job 4 (Closed)" });
  });
});

describe("isSelectableExpenseJob", () => {
  const base = { isActive: true, source: "project" as const };
  const cases = [
    {
      name: "Open project",
      job: { ...base, projectStatus: "open" as const },
      open: true,
      any: true,
    },
    {
      name: "Closed project",
      job: { ...base, projectStatus: "closed" as const },
      open: false,
      any: true,
    },
    {
      name: "Unknown project",
      job: { ...base, projectStatus: "unknown" as const },
      open: false,
      any: false,
    },
    {
      name: "hidden Open project",
      job: { ...base, projectStatus: "open" as const, isActive: false },
      open: false,
      any: false,
    },
    {
      name: "active custom job",
      job: { isActive: true, source: "custom" as const, projectStatus: "unknown" as const },
      open: true,
      any: true,
    },
    {
      name: "hidden custom job",
      job: { isActive: false, source: "custom" as const, projectStatus: "unknown" as const },
      open: false,
      any: false,
    },
  ];
  it.each(cases)("$name", ({ job, open, any }) => {
    expect(isSelectableExpenseJob(job, { allowClosed: false })).toBe(open);
    expect(isSelectableExpenseJob(job, { allowClosed: true })).toBe(any);
  });
});

describe("site inspection project links", () => {
  beforeEach(() => {
    resetSiteInspectionMemoryForTests();
  });

  async function setup() {
    await syncExpenseJobsFromMasterProjectLog();
    const all = await listExpenseJobs({ includeInactive: true });
    const [template] = await listTemplates();
    return {
      templateId: template!.id,
      open: byNumberJob(all, "L01-26001"),
      closed: byNumberJob(all, "L01-26002"),
      unknown: byNumberJob(all, "L01-26003"),
    };
  }

  it("rejects Closed and Unknown projects for new inspections", async () => {
    const { templateId, closed, unknown } = await setup();
    const base = { projectName: "Test", address: "1 Main St", templateId, createdBy: ACTOR };
    await expect(createSiteInspection({ ...base, jobId: closed.id })).rejects.toThrow(
      "That project is Closed. Site inspections can only use Open projects.",
    );
    await expect(createSiteInspection({ ...base, jobId: unknown.id })).rejects.toThrow(
      /isn't marked Open or Closed on the Master Project Log/,
    );
  });

  it("keeps an existing link to a project that has since Closed", async () => {
    const { templateId, open, closed } = await setup();
    const inspection = await createSiteInspection({
      projectName: "Test",
      address: "1 Main St",
      templateId,
      createdBy: ACTOR,
      jobId: open.id,
    });
    setProjectRegistryLoadDepsForTests({
      rowsOverride: [{ ...SHEET[0]!, status: "closed" }, SHEET[1]!, SHEET[2]!],
    });
    clearProjectLogCacheForTests();
    await syncExpenseJobsFromMasterProjectLog();
    const kept = await updateSiteInspectionDetails({
      inspectionId: inspection.id,
      projectName: "Test renamed",
      address: "1 Main St",
      jobId: open.id,
      actorId: ACTOR,
    });
    expect(kept.jobId).toBe(open.id);
    await expect(
      updateSiteInspectionDetails({
        inspectionId: inspection.id,
        projectName: "Test renamed",
        address: "1 Main St",
        jobId: closed.id,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/Site inspections can only use Open projects/);
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

  it("creates an item on a Closed project", async () => {
    rememberInventoryJobLabelForTests(JOB_ID, "Closed ADU", { projectStatus: "closed" });
    await expect(assertInventoryProjectAssignable({ jobId: JOB_ID })).resolves.toBeUndefined();
    await expect(createInventoryItem(input())).resolves.toMatchObject({
      jobId: JOB_ID,
      projectLabel: "Closed ADU",
    });
  });

  it("rejects Unknown-status and hidden projects", async () => {
    rememberInventoryJobLabelForTests(JOB_ID, "Mystery ADU", { projectStatus: "unknown" });
    await expect(createInventoryItem(input())).rejects.toThrow(/marked Open or Closed/);
    rememberInventoryJobLabelForTests(JOB_ID, "Hidden ADU", { isActive: false });
    await expect(assertInventoryProjectAssignable({ jobId: JOB_ID })).rejects.toThrow(/hidden/);
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

  it("moving an existing item onto a different Closed project works", async () => {
    const OTHER = "33333333-3333-4333-8333-333333333333";
    rememberInventoryJobLabelForTests(JOB_ID, "Open ADU");
    rememberInventoryJobLabelForTests(OTHER, "Closed ADU", { projectStatus: "closed" });
    const item = await createInventoryItem(input());
    await expect(updateInventoryItem(item.id, input({ jobId: OTHER }))).resolves.toMatchObject({
      jobId: OTHER,
      projectLabel: "Closed ADU",
    });
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
