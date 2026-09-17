/**
 * Receipt Log foundation — amounts, jobs sync, RLS policy text, manual entry.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCacheForTests } from "@/lib/env";
import { formatProjectExpenseJobLabel } from "@/lib/receipts/job-label";
import { parseAmountToCents, formatCentsAsUsd } from "@/lib/receipts/amount";
import { receiptSubmitSchema } from "@/lib/receipts/schemas";
import {
  createCustomExpenseJob,
  createReceipt,
  filterReceiptVisibleToViewer,
  listExpenseJobs,
  reorderExpenseJobs,
  resetReceiptLogMemoryForTests,
  updateExpenseJob,
  upsertProjectExpenseJob,
} from "@/lib/receipts/store";
import { syncExpenseJobsFromMasterProjectLog } from "@/lib/receipts/sync-jobs";
import { setProjectRegistryLoadDepsForTests } from "@/lib/baxter-data/project-registry";
import { clearProjectLogCacheForTests } from "@/lib/baxter-data/project-registry";
import type { ProjectLogRow } from "@/lib/baxter-data/project-registry";
import { getEnabledBaxterTools } from "@/lib/baxter/tools";
import { ValidationError } from "@/lib/errors";

const FIXTURE_ROWS: ProjectLogRow[] = [
  {
    projectNumber: "L01-26019",
    shortName: "Liniger",
    salesperson: "Kevin Lee",
    startDate: "7/10/2026",
    customerName: "Katie Liniger",
    street: "25 N Avalon Dr",
    city: "Los Altos",
    postalCode: "94022",
    jurisdiction: "Los Altos",
    rowNumber: 15,
  },
  {
    projectNumber: "L01-26016",
    shortName: "Yeh",
    salesperson: "Jesse Soares",
    startDate: "6/15/2026",
    customerName: "Alvin Yeh",
    street: "2212 Culver Creek",
    city: "Walnut Creek",
    postalCode: "94598",
    jurisdiction: "Walnut Creek",
    rowNumber: 12,
  },
];

describe("parseAmountToCents", () => {
  it("parses dollars with and without currency symbol", () => {
    expect(parseAmountToCents("42.50")).toBe(4250);
    expect(parseAmountToCents("$42.50")).toBe(4250);
    expect(parseAmountToCents("1,234.56")).toBe(123456);
    expect(parseAmountToCents("$10")).toBe(1000);
  });

  it("rejects empty / zero / invalid", () => {
    expect(() => parseAmountToCents("")).toThrow(ValidationError);
    expect(() => parseAmountToCents("0")).toThrow(ValidationError);
    expect(() => parseAmountToCents("-5")).toThrow(ValidationError);
    expect(() => parseAmountToCents("abc")).toThrow(ValidationError);
  });

  it("formats cents as USD", () => {
    expect(formatCentsAsUsd(4250)).toBe("$42.50");
    expect(formatCentsAsUsd(5)).toBe("$0.05");
  });
});

describe("job labels + Master Project Log sync", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
    clearProjectLogCacheForTests();
    setProjectRegistryLoadDepsForTests({ rowsOverride: FIXTURE_ROWS });
  });

  it("formats project labels readably", () => {
    expect(formatProjectExpenseJobLabel(FIXTURE_ROWS[0]!)).toBe(
      "L01-26019 Liniger — 25 N Avalon Dr, Los Altos",
    );
  });

  it("syncs project jobs and preserves hide/order across refresh", async () => {
    await syncExpenseJobsFromMasterProjectLog();
    let jobs = await listExpenseJobs({ includeInactive: true });
    expect(jobs.some((j) => j.projectNumber === "L01-26019")).toBe(true);
    expect(jobs.some((j) => j.projectNumber === "L01-26016")).toBe(true);

    const custom = await createCustomExpenseJob({
      label: "Office supplies",
      createdBy: "user-1",
    });
    expect(custom.source).toBe("custom");

    const liniger = jobs.find((j) => j.projectNumber === "L01-26019")!;
    await updateExpenseJob({ id: liniger.id, isActive: false, updatedBy: "admin-1" });
    await reorderExpenseJobs(
      [custom.id, jobs.find((j) => j.projectNumber === "L01-26016")!.id, liniger.id],
      "admin-1",
    );

    // Refresh again — hide + order must stick; label may update
    await upsertProjectExpenseJob({
      projectNumber: "L01-26019",
      label: "L01-26019 Liniger — 25 N Avalon Dr, Los Altos",
    });
    await syncExpenseJobsFromMasterProjectLog();

    jobs = await listExpenseJobs({ includeInactive: true });
    const refreshed = jobs.find((j) => j.projectNumber === "L01-26019")!;
    expect(refreshed.isActive).toBe(false);
    expect(refreshed.id).toBe(liniger.id);

    const activeOnly = await listExpenseJobs({ includeInactive: false });
    expect(activeOnly.some((j) => j.projectNumber === "L01-26019")).toBe(false);
    expect(activeOnly.some((j) => j.label === "Office supplies")).toBe(true);
  });
});

describe("manual receipt entry", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
  });

  it("stores amount as integer cents; blanks become null", async () => {
    const job = await createCustomExpenseJob({
      label: "Misc job",
      createdBy: "admin",
    });
    const receipt = await createReceipt({
      jobId: job.id,
      amountCents: parseAmountToCents("$19.99"),
      vendor: "Home Depot",
      purchasedOn: "2026-09-17",
      items: "  ",
      description: "",
      submittedBy: "user-a",
    });
    expect(receipt.amountCents).toBe(1999);
    expect(Number.isInteger(receipt.amountCents)).toBe(true);
    expect(receipt.items).toBeNull();
    expect(receipt.description).toBeNull();
    expect(receipt.photoStoragePath).toBeNull();
  });

  it("rejects missing required fields via schema", () => {
    expect(receiptSubmitSchema.safeParse({}).success).toBe(false);
    expect(
      receiptSubmitSchema.safeParse({
        jobId: "11111111-1111-4111-8111-111111111111",
        amount: "",
        vendor: "X",
        purchasedOn: "2026-09-17",
      }).success,
    ).toBe(false);
    expect(
      receiptSubmitSchema.safeParse({
        jobId: "11111111-1111-4111-8111-111111111111",
        amount: "10",
        vendor: "",
        purchasedOn: "2026-09-17",
      }).success,
    ).toBe(false);
    expect(
      receiptSubmitSchema.safeParse({
        jobId: "11111111-1111-4111-8111-111111111111",
        amount: "10",
        vendor: "Ace",
        purchasedOn: "",
      }).success,
    ).toBe(false);
  });

  it("enforces ownership visibility (RLS mirror)", async () => {
    const job = await createCustomExpenseJob({ label: "Job", createdBy: "admin" });
    const mine = await createReceipt({
      jobId: job.id,
      amountCents: 100,
      vendor: "A",
      purchasedOn: "2026-09-17",
      submittedBy: "user-a",
    });
    const theirs = await createReceipt({
      jobId: job.id,
      amountCents: 200,
      vendor: "B",
      purchasedOn: "2026-09-17",
      submittedBy: "user-b",
    });

    expect(filterReceiptVisibleToViewer(mine, { id: "user-a", isAdmin: false })?.id).toBe(mine.id);
    expect(filterReceiptVisibleToViewer(theirs, { id: "user-a", isAdmin: false })).toBeNull();
    expect(filterReceiptVisibleToViewer(theirs, { id: "admin", isAdmin: true })?.id).toBe(
      theirs.id,
    );
  });
});

describe("migration 044 RLS + bucket", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/044_receipt_log.sql"), "utf8");

  it("defines user-own + admin read policies and blocks client writes", () => {
    expect(sql).toContain("Users can read own receipts");
    expect(sql).toContain("submitted_by = auth.uid()");
    expect(sql).toContain("public.is_admin()");
    expect(sql).toContain("No client insert receipts");
    expect(sql).toContain("No client update receipts");
    expect(sql).toContain("No client insert expense jobs");
    expect(sql).toContain("Authenticated users can read expense jobs");
    expect(sql).toContain("amount_cents integer not null");
    expect(sql).toContain("receipt-photos");
    expect(sql).toContain("public = false");
  });
});

describe("dashboard card", () => {
  it("exposes Receipt Log for app-access users", () => {
    const tools = getEnabledBaxterTools({ isAdmin: false });
    const card = tools.find((t) => t.key === "receipt-log");
    expect(card?.href).toBe("/receipts");
    expect(card?.name).toBe("Receipt Log");
  });
});
