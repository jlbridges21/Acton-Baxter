/**
 * Diagnosis + fixes for Receipt Log perf, ordering, and custom job labels.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { setProjectRegistryLoadDepsForTests } from "@/lib/baxter-data/project-registry";
import { clearProjectLogCacheForTests } from "@/lib/baxter-data/project-registry";
import type { ProjectLogRow } from "@/lib/baxter-data/project-registry";
import {
  compareProjectNumberDesc,
  createCustomExpenseJob,
  createReceipt,
  customJobFilterId,
  listExpenseJobs,
  listAllReceipts,
  queryReceiptLogRows,
  receiptSubmitSchema,
  resetReceiptLogMemoryForTests,
  syncExpenseJobsFromMasterProjectLog,
  DEFAULT_RECEIPT_LOG_FILTERS,
  type ReceiptLogRow,
} from "@/lib/receipts";
import { buildReceiptLogCsv } from "@/lib/receipts/csv";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const FIXTURE_ROWS: ProjectLogRow[] = [
  {
    projectNumber: "L01-26007",
    shortName: "Old",
    salesperson: "A",
    startDate: "1/1/2026",
    customerName: "Old",
    street: "1 Old St",
    city: "Town",
    postalCode: "90000",
    jurisdiction: "Town",
    rowNumber: 1,
  },
  {
    projectNumber: "L01-26018",
    shortName: "Mid",
    salesperson: "B",
    startDate: "2/1/2026",
    customerName: "Mid",
    street: "2 Mid St",
    city: "Town",
    postalCode: "90000",
    jurisdiction: "Town",
    rowNumber: 2,
  },
  {
    projectNumber: "L01-26019",
    shortName: "Liniger",
    salesperson: "C",
    startDate: "3/1/2026",
    customerName: "Liniger",
    street: "25 N Avalon",
    city: "Los Altos",
    postalCode: "94022",
    jurisdiction: "Los Altos",
    rowNumber: 3,
  },
];

describe("Part A — /receipts load diagnosis + fix", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
    clearProjectLogCacheForTests();
    setProjectRegistryLoadDepsForTests({ rowsOverride: FIXTURE_ROWS });
  });

  it("measures sync stages: Google load vs sequential-style upserts vs list", async () => {
    // Simulate cold Master Project Log fetch latency (Google OAuth + Sheets).
    setProjectRegistryLoadDepsForTests({
      rowsOverride: null,
      getSettings: async () =>
        ({
          masterCharterSpreadsheetId: "sheet",
          masterLogTabName: "Master Project Log",
        }) as never,
      readSheet: async () => {
        await sleep(80);
        return [
          [
            "Project #",
            "Short Name",
            "Salesperson",
            "Start",
            "Customer",
            "Street",
            "City",
            "ZIP",
            "Jurisdiction",
          ],
          ...FIXTURE_ROWS.map((r) => [
            r.projectNumber,
            r.shortName,
            r.salesperson,
            r.startDate,
            r.customerName,
            r.street,
            r.city,
            r.postalCode,
            r.jurisdiction,
          ]),
        ];
      },
    });

    // Inflate to ~60 projects to expose sequential upsert cost (was one-by-one on render).
    const many: ProjectLogRow[] = Array.from({ length: 60 }, (_, i) => ({
      ...FIXTURE_ROWS[0]!,
      projectNumber: `L01-${26000 + i}`,
      shortName: `P${i}`,
      rowNumber: i + 1,
    }));
    setProjectRegistryLoadDepsForTests({
      rowsOverride: null,
      getSettings: async () =>
        ({
          masterCharterSpreadsheetId: "sheet",
          masterLogTabName: "Master Project Log",
        }) as never,
      readSheet: async () => {
        await sleep(120); // simulated cold Sheets round-trip
        return [
          [
            "Project #",
            "Short Name",
            "Salesperson",
            "Start",
            "Customer",
            "Street",
            "City",
            "ZIP",
            "Jurisdiction",
          ],
          ...many.map((r) => [
            r.projectNumber,
            r.shortName,
            r.salesperson,
            r.startDate,
            r.customerName,
            r.street,
            r.city,
            r.postalCode,
            r.jurisdiction,
          ]),
        ];
      },
    });

    const sync = await syncExpenseJobsFromMasterProjectLog();
    expect(sync.timings.loadMasterProjectLogMs).toBeGreaterThanOrEqual(100);
    expect(sync.timings.upsertCount).toBe(60);
    expect(sync.timings.totalMs).toBeGreaterThan(sync.timings.loadMasterProjectLogMs);

    const afterListStart = Date.now();
    const jobs = await listExpenseJobs({ includeInactive: false });
    const listMs = Date.now() - afterListStart;
    expect(jobs.length).toBe(60);
    expect(listMs).toBeLessThan(50);

    // Confirm page + jobs API no longer call sync on read.
    const page = readFileSync(join(process.cwd(), "src/app/receipts/page.tsx"), "utf8");
    expect(page).not.toContain("syncExpenseJobsFromMasterProjectLog");
    const jobsRoute = readFileSync(
      join(process.cwd(), "src/app/api/receipts/jobs/route.ts"),
      "utf8",
    );
    expect(jobsRoute).not.toContain("syncExpenseJobsFromMasterProjectLog");

    // eslint-disable-next-line no-console -- diagnostic timing for Part A report
    console.info(
      "[receipts-timing]",
      JSON.stringify({
        simulated_cold_sheets_ms: sync.timings.loadMasterProjectLogMs,
        upsert_loop_ms: sync.timings.upsertLoopMs,
        upsert_count: sync.timings.upsertCount,
        sync_total_ms: sync.timings.totalMs,
        after_list_only_ms: listMs,
        note: "Production cold Sheets+OAuth often 30–120s; 60 sequential round-trips compound that on the old render path.",
      }),
    );
  });

  it("does not schedule expense_jobs_sync on process-jobs cron; sync is event-triggered only", () => {
    const processJobsRoute = readFileSync(
      join(process.cwd(), "src/app/api/internal/process-jobs/route.ts"),
      "utf8",
    );
    expect(processJobsRoute).not.toContain("maybeEnqueueScheduledExpenseJobsSync");
    expect(processJobsRoute).not.toContain("expenseJobs");

    const receiptsPage = readFileSync(join(process.cwd(), "src/app/receipts/page.tsx"), "utf8");
    expect(receiptsPage).not.toContain("syncExpenseJobsFromMasterProjectLog");
    expect(receiptsPage).toContain("listExpenseJobs");

    const runner = readFileSync(join(process.cwd(), "src/lib/project-setup/runner.ts"), "utf8");
    expect(runner).toContain("syncExpenseJobsAfterProjectSetup");
    expect(runner).toContain("!run.dryRun");
  });

  it("reports added vs updated counts from Master Project Log sync", async () => {
    const first = await syncExpenseJobsFromMasterProjectLog();
    expect(first.added).toBe(3);
    expect(first.updated).toBe(0);

    const second = await syncExpenseJobsFromMasterProjectLog();
    expect(second.added).toBe(0);
    expect(second.updated).toBe(3);
  });

  it("syncExpenseJobsAfterProjectSetup swallows Master Project Log failures", async () => {
    const { syncExpenseJobsAfterProjectSetup } = await import("@/lib/receipts/sync-jobs");
    setProjectRegistryLoadDepsForTests({
      rowsOverride: null,
      getSettings: async () =>
        ({
          masterCharterSpreadsheetId: "sheet",
          masterLogTabName: "Master Project Log",
        }) as never,
      readSheet: async () => {
        throw new Error("simulated sheets failure");
      },
    });
    await expect(syncExpenseJobsAfterProjectSetup("run-test")).resolves.toBeUndefined();
  });
});

describe("Part B — job ordering", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
    clearProjectLogCacheForTests();
    setProjectRegistryLoadDepsForTests({ rowsOverride: FIXTURE_ROWS });
  });

  it("lists projects newest-first and customs before the project band", async () => {
    expect(compareProjectNumberDesc("L01-26019", "L01-26018")).toBeLessThan(0);
    expect(compareProjectNumberDesc("L01-26018", "L01-26007")).toBeLessThan(0);

    await syncExpenseJobsFromMasterProjectLog();
    await createCustomExpenseJob({ label: "Office", createdBy: "admin" });
    await createCustomExpenseJob({ label: "Shop", createdBy: "admin" });

    const jobs = await listExpenseJobs({ includeInactive: false });
    const labels = jobs.map((j) => j.projectNumber ?? j.label);
    // Customs first (low sort_order band), then projects by descending number
    expect(labels.slice(0, 2).sort()).toEqual(["Office", "Shop"]);
    const projects = jobs.filter((j) => j.source === "project").map((j) => j.projectNumber);
    expect(projects).toEqual(["L01-26019", "L01-26018", "L01-26007"]);
  });

  it("respects explicit admin sort_order override", async () => {
    await syncExpenseJobsFromMasterProjectLog();
    const jobs = await listExpenseJobs({ includeInactive: false });
    const oldest = jobs.find((j) => j.projectNumber === "L01-26007")!;
    const { updateExpenseJob } = await import("@/lib/receipts/store");
    await updateExpenseJob({ id: oldest.id, sortOrder: 1, updatedBy: "admin" });

    const ordered = await listExpenseJobs({ includeInactive: false });
    expect(ordered[0]?.projectNumber).toBe("L01-26007");
  });
});

describe("Part C — free-text custom job labels", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
  });

  it("stores custom_job_label with null job_id and does not create expense_jobs", async () => {
    const before = await listExpenseJobs({ includeInactive: true });
    const receipt = await createReceipt({
      customJobLabel: "Trailer repair",
      amountCents: 4500,
      vendor: "U-Haul",
      purchasedOn: "2026-03-01",
      submittedBy: "user-1",
    });
    expect(receipt.jobId).toBeNull();
    expect(receipt.customJobLabel).toBe("Trailer repair");
    const after = await listExpenseJobs({ includeInactive: true });
    expect(after.length).toBe(before.length);
  });

  it("rejects both-set and neither-set via schema + store", async () => {
    expect(() =>
      receiptSubmitSchema.parse({
        jobId: "00000000-0000-4000-8000-000000000001",
        customJobLabel: "Both",
        amount: "10",
        vendor: "X",
        purchasedOn: "2026-01-01",
      }),
    ).toThrow();

    expect(() =>
      receiptSubmitSchema.parse({
        amount: "10",
        vendor: "X",
        purchasedOn: "2026-01-01",
      }),
    ).toThrow();

    await expect(
      createReceipt({
        amountCents: 100,
        vendor: "X",
        purchasedOn: "2026-01-01",
        submittedBy: "user-1",
      }),
    ).rejects.toThrow(/job|label/i);
  });

  it("admin log displays, filters, and exports custom labels", async () => {
    const job = await createCustomExpenseJob({ label: "Vehicle", createdBy: "admin" });
    await createReceipt({
      jobId: job.id,
      amountCents: 1000,
      vendor: "Shell",
      purchasedOn: "2026-03-01",
      submittedBy: "user-1",
    });
    await createReceipt({
      customJobLabel: "Temp staging",
      amountCents: 2000,
      vendor: "Home Depot",
      purchasedOn: "2026-03-02",
      submittedBy: "user-1",
      items: "Plywood",
    });

    const all = await listAllReceipts();
    const rows: ReceiptLogRow[] = all.map((r) => ({
      id: r.id,
      submittedBy: r.submittedBy,
      submitterName: "User",
      submitterEmail: null,
      submitterLabel: "User",
      jobId: r.jobId,
      customJobLabel: r.customJobLabel,
      jobLabel: r.customJobLabel ?? "Vehicle",
      isCustomJob: Boolean(r.customJobLabel),
      amountCents: r.amountCents,
      vendor: r.vendor,
      purchasedOn: r.purchasedOn,
      items: r.items,
      description: r.description,
      photoStoragePath: r.photoStoragePath,
      photoSignedUrl: null,
      photoPermalink: `/receipts/${r.id}/photo`,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    const filtered = queryReceiptLogRows(rows, {
      filters: {
        ...DEFAULT_RECEIPT_LOG_FILTERS,
        range: "all_time",
        jobIds: [customJobFilterId("Temp staging")],
      },
    });
    expect(filtered.totalMatching).toBe(1);
    expect(filtered.rows[0]?.isCustomJob).toBe(true);

    const csv = buildReceiptLogCsv(filtered.rows);
    expect(csv).toContain("Temp staging");
    expect(csv).toContain("custom");
  });
});
