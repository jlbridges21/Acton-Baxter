/**
 * Admin Receipt Log — filters, sort, totals, CSV, soft-delete, access.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCacheForTests } from "@/lib/env";
import { formatCentsAsDecimalDollars, formatCentsAsUsd } from "@/lib/receipts/amount";
import { buildReceiptLogCsv } from "@/lib/receipts/csv";
import {
  buildReceiptLogHref,
  countActiveReceiptLogFilters,
  DEFAULT_RECEIPT_LOG_FILTERS,
  type ReceiptLogFiltersState,
} from "@/lib/receipts/log-filter-url";
import { queryReceiptLogRows, type ReceiptLogRow } from "@/lib/receipts/log-query";
import {
  createCustomExpenseJob,
  createReceipt,
  getReceiptById,
  listAllReceipts,
  resetReceiptLogMemoryForTests,
  softDeleteReceipt,
} from "@/lib/receipts/store";
import { getAdminNavLinks } from "@/lib/baxter/admin-nav";

function row(partial: Partial<ReceiptLogRow> & Pick<ReceiptLogRow, "id">): ReceiptLogRow {
  return {
    submittedBy: "user-a",
    submitterName: "Alice",
    jobId: "job-1",
    jobLabel: "L01 Liniger",
    amountCents: 2500,
    vendor: "Home Depot",
    purchasedOn: "2026-03-10",
    items: "Screws",
    description: "Deck hardware",
    photoStoragePath: null,
    photoSignedUrl: null,
    photoPermalink: `/receipts/${partial.id}/photo`,
    createdAt: "2026-03-11T18:00:00.000Z",
    updatedAt: "2026-03-11T18:00:00.000Z",
    ...partial,
  };
}

const CORPUS: ReceiptLogRow[] = [
  row({
    id: "r1",
    amountCents: 2500,
    vendor: "Home Depot",
    purchasedOn: "2026-03-10",
    createdAt: "2026-03-11T18:00:00.000Z",
    photoStoragePath: "user-a/photo1.jpg",
    photoSignedUrl: "https://signed.example/1",
  }),
  row({
    id: "r2",
    submittedBy: "user-b",
    submitterName: "Bob",
    jobId: "job-2",
    jobLabel: "L01 Yeh",
    amountCents: 8000,
    vendor: "Ace Hardware",
    purchasedOn: "2026-02-05",
    createdAt: "2026-02-06T12:00:00.000Z",
    items: null,
    description: null,
    photoStoragePath: null,
  }),
  row({
    id: "r3",
    amountCents: 12000,
    vendor: "Home Depot",
    purchasedOn: "2026-03-15",
    createdAt: "2026-03-16T10:00:00.000Z",
    jobId: "job-1",
    jobLabel: "L01 Liniger",
    items: "Lumber",
    description: "Framing materials",
    photoStoragePath: "user-a/photo3.jpg",
  }),
];

describe("receipt log filter URL helpers", () => {
  it("round-trips filter state into a shareable URL", () => {
    const state: ReceiptLogFiltersState = {
      ...DEFAULT_RECEIPT_LOG_FILTERS,
      range: "last_month",
      dateField: "purchased",
      userIds: ["user-a"],
      jobIds: ["job-1"],
      vendors: ["Home Depot"],
      amountMin: "10",
      amountMax: "100",
      entryType: "photo",
      q: "screws",
      sort: "amount",
      dir: "asc",
    };
    const href = buildReceiptLogHref(state);
    expect(href).toContain("/receipts/log?");
    expect(href).toContain("range=last_month");
    expect(href).toContain("dateField=purchased");
    expect(href).toContain("user=user-a");
    expect(href).toContain("job=job-1");
    expect(href).toContain("vendor=Home+Depot");
    expect(href).toContain("amountMin=10");
    expect(href).toContain("entryType=photo");
    expect(href).toContain("q=screws");
    expect(href).toContain("sort=amount");
    expect(href).toContain("dir=asc");
    expect(countActiveReceiptLogFilters(state)).toBeGreaterThan(3);
  });
});

describe("receipt log query", () => {
  it("filters by vendor, job, amount range, entry type, and search in combination", () => {
    const result = queryReceiptLogRows(CORPUS, {
      filters: {
        ...DEFAULT_RECEIPT_LOG_FILTERS,
        range: "all_time",
        vendors: ["Home Depot"],
        jobIds: ["job-1"],
        amountMin: "20",
        amountMax: "150",
        entryType: "photo",
        q: "deck",
      },
    });
    expect(result.rows.map((r) => r.id)).toEqual(["r1"]);
    expect(result.totalMatching).toBe(1);
    expect(result.totalAmountCents).toBe(2500);
  });

  it("applies date range to purchased vs logged distinctly", () => {
    const purchased = queryReceiptLogRows(CORPUS, {
      filters: {
        ...DEFAULT_RECEIPT_LOG_FILTERS,
        range: "custom",
        dateField: "purchased",
        customStart: "2026-03-01",
        customEnd: "2026-03-31",
      },
    });
    expect(purchased.rows.map((r) => r.id).sort()).toEqual(["r1", "r3"]);

    const logged = queryReceiptLogRows(CORPUS, {
      filters: {
        ...DEFAULT_RECEIPT_LOG_FILTERS,
        range: "custom",
        dateField: "logged",
        customStart: "2026-02-01",
        customEnd: "2026-02-28",
      },
    });
    expect(logged.rows.map((r) => r.id)).toEqual(["r2"]);
  });

  it("sorts by amount both directions and keeps filtered total accurate", () => {
    const asc = queryReceiptLogRows(CORPUS, {
      filters: {
        ...DEFAULT_RECEIPT_LOG_FILTERS,
        range: "all_time",
        sort: "amount",
        dir: "asc",
      },
    });
    expect(asc.rows.map((r) => r.amountCents)).toEqual([2500, 8000, 12000]);
    expect(asc.totalAmountCents).toBe(2500 + 8000 + 12000);

    const desc = queryReceiptLogRows(CORPUS, {
      filters: {
        ...DEFAULT_RECEIPT_LOG_FILTERS,
        range: "all_time",
        amountMin: "50",
        sort: "amount",
        dir: "desc",
      },
    });
    expect(desc.rows.map((r) => r.amountCents)).toEqual([12000, 8000]);
    expect(desc.totalAmountCents).toBe(20000);
  });

  it("sorts user / job / vendor / purchased columns", () => {
    const byVendor = queryReceiptLogRows(CORPUS, {
      filters: {
        ...DEFAULT_RECEIPT_LOG_FILTERS,
        range: "all_time",
        sort: "vendor",
        dir: "asc",
      },
    });
    expect(byVendor.rows[0]?.vendor).toBe("Ace Hardware");

    const byUser = queryReceiptLogRows(CORPUS, {
      filters: {
        ...DEFAULT_RECEIPT_LOG_FILTERS,
        range: "all_time",
        sort: "user",
        dir: "asc",
      },
    });
    expect(byUser.rows[0]?.submitterName).toBe("Alice");
  });
});

describe("CSV export", () => {
  it("exports decimal dollars and durable photo permalinks (not signed URLs)", () => {
    const csv = buildReceiptLogCsv([CORPUS[0]!, CORPUS[1]!], "https://acton-baxter.vercel.app");
    expect(csv).toContain("25.00");
    expect(csv).toContain("80.00");
    expect(csv).not.toContain("2500");
    expect(csv).toContain("https://acton-baxter.vercel.app/receipts/r1/photo");
    expect(csv).not.toContain("signed.example");
    // Manual entry: empty photo cell
    const lines = csv.trim().split("\n");
    expect(lines[2]).toContain("Ace Hardware");
    expect(lines[2]).not.toContain("/photo");
  });

  it("formats cents as decimal dollars for Excel", () => {
    expect(formatCentsAsDecimalDollars(123456)).toBe("1234.56");
    expect(formatCentsAsUsd(123456)).toBe("$1234.56");
  });
});

describe("soft-delete + store", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
  });

  it("excludes soft-deleted receipts from list and get still returns deleted row", async () => {
    const job = await createCustomExpenseJob({ label: "Office", createdBy: "admin" });
    const receipt = await createReceipt({
      jobId: job.id,
      amountCents: 999,
      vendor: "Staples",
      purchasedOn: "2026-03-01",
      submittedBy: "user-1",
    });
    expect((await listAllReceipts()).some((r) => r.id === receipt.id)).toBe(true);

    await softDeleteReceipt(receipt.id);
    expect((await listAllReceipts()).some((r) => r.id === receipt.id)).toBe(false);

    const found = await getReceiptById(receipt.id);
    expect(found?.deletedAt).toBeTruthy();
  });
});

describe("admin access surface", () => {
  it("registers Receipt Log under /receipts/log in admin nav (PWA scope)", () => {
    const link = getAdminNavLinks().find((l) => l.label === "Receipt Log");
    expect(link?.href).toBe("/receipts/log");
    expect(link?.href.startsWith("/receipts")).toBe(true);
  });

  it("photo permalink and export routes require admin (source)", () => {
    const photo = readFileSync(join(process.cwd(), "src/app/receipts/[id]/photo/route.ts"), "utf8");
    expect(photo).toContain("isAdminRole");
    expect(photo).toContain("AuthorizationError");
    expect(photo).toContain("createReceiptPhotoSignedUrl");

    const exportRoute = readFileSync(
      join(process.cwd(), "src/app/receipts/log/export/route.ts"),
      "utf8",
    );
    expect(exportRoute).toContain("isAdminRole");
    expect(exportRoute).toContain("buildReceiptLogCsv");

    const page = readFileSync(join(process.cwd(), "src/app/receipts/log/page.tsx"), "utf8");
    expect(page).toContain("isAdminRole");
    expect(page).toContain('redirect("/receipts")');
  });

  it("delete API uses requireAdmin", () => {
    const source = readFileSync(join(process.cwd(), "src/app/api/receipts/[id]/route.ts"), "utf8");
    expect(source).toContain("requireAdmin");
    expect(source).toContain("softDeleteReceipt");
  });
});
