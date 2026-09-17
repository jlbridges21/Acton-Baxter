/**
 * My Receipts — ownership, filters, photo access, CSV (no UI fork of admin log).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCacheForTests } from "@/lib/env";
import { buildReceiptLogCsv } from "@/lib/receipts/csv";
import { getMyReceiptLogDashboard, loadMyReceiptLogCorpus } from "@/lib/receipts/log-dashboard";
import {
  DEFAULT_RECEIPT_LOG_FILTERS,
  MY_RECEIPTS_EXPORT_PATH,
  MY_RECEIPTS_PATH,
  buildReceiptLogHref,
  countActiveReceiptLogFilters,
  parseReceiptLogFiltersFromParams,
} from "@/lib/receipts/log-filter-url";
import {
  createCustomExpenseJob,
  createReceipt,
  filterReceiptVisibleToViewer,
  getReceiptById,
  resetReceiptLogMemoryForTests,
  softDeleteReceipt,
} from "@/lib/receipts/store";

describe("My Receipts ownership (server-side)", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
  });

  it("lists only the owner's receipts in corpus, totals, and CSV", async () => {
    const job = await createCustomExpenseJob({ label: "Office", createdBy: "admin" });
    await createReceipt({
      jobId: job.id,
      amountCents: 1000,
      vendor: "Owner Store",
      purchasedOn: "2026-09-01",
      submittedBy: "user-owner",
    });
    await createReceipt({
      jobId: job.id,
      amountCents: 5000,
      vendor: "Other Store",
      purchasedOn: "2026-09-02",
      submittedBy: "user-other",
    });

    const corpus = await loadMyReceiptLogCorpus("user-owner");
    expect(corpus).toHaveLength(1);
    expect(corpus[0]?.vendor).toBe("Owner Store");
    expect(corpus.every((r) => r.submittedBy === "user-owner")).toBe(true);

    const dashboard = await getMyReceiptLogDashboard({
      ownerUserId: "user-owner",
      filters: { ...DEFAULT_RECEIPT_LOG_FILTERS, range: "all_time" },
    });
    expect(dashboard.totalMatching).toBe(1);
    expect(dashboard.totalAmountCents).toBe(1000);
    expect(dashboard.rows.every((r) => r.submittedBy === "user-owner")).toBe(true);

    const csv = buildReceiptLogCsv(dashboard.rows, "https://example.com", {
      includeSubmitter: false,
    });
    expect(csv).toContain("Owner Store");
    expect(csv).not.toContain("Other Store");
    expect(csv).not.toContain("Submitter");
  });

  it("ignores crafted user= filter params and never returns another user's rows", async () => {
    const job = await createCustomExpenseJob({ label: "Office", createdBy: "admin" });
    await createReceipt({
      jobId: job.id,
      amountCents: 1100,
      vendor: "Mine",
      purchasedOn: "2026-09-01",
      submittedBy: "user-a",
    });
    await createReceipt({
      jobId: job.id,
      amountCents: 9900,
      vendor: "Theirs",
      purchasedOn: "2026-09-01",
      submittedBy: "user-b",
    });

    // Attacker tries to pass user=user-b (and omit themselves).
    const filters = {
      ...DEFAULT_RECEIPT_LOG_FILTERS,
      range: "all_time" as const,
      userIds: ["user-b"],
    };
    const dashboard = await getMyReceiptLogDashboard({
      ownerUserId: "user-a",
      filters,
    });
    expect(dashboard.rows).toHaveLength(1);
    expect(dashboard.rows[0]?.submittedBy).toBe("user-a");
    expect(dashboard.rows[0]?.vendor).toBe("Mine");
    expect(dashboard.totalAmountCents).toBe(1100);
  });

  it("hides soft-deleted receipts from my list and totals", async () => {
    const job = await createCustomExpenseJob({ label: "Office", createdBy: "admin" });
    const kept = await createReceipt({
      jobId: job.id,
      amountCents: 2000,
      vendor: "Keep",
      purchasedOn: "2026-09-01",
      submittedBy: "user-a",
    });
    const doomed = await createReceipt({
      jobId: job.id,
      amountCents: 3000,
      vendor: "Gone",
      purchasedOn: "2026-09-02",
      submittedBy: "user-a",
    });
    await softDeleteReceipt(doomed.id);

    const dashboard = await getMyReceiptLogDashboard({
      ownerUserId: "user-a",
      filters: { ...DEFAULT_RECEIPT_LOG_FILTERS, range: "all_time" },
    });
    expect(dashboard.rows.map((r) => r.id)).toEqual([kept.id]);
    expect(dashboard.totalAmountCents).toBe(2000);
  });

  it("filterReceiptVisibleToViewer allows owner and admin, refuses peer", async () => {
    const job = await createCustomExpenseJob({ label: "Office", createdBy: "admin" });
    const receipt = await createReceipt({
      jobId: job.id,
      amountCents: 1500,
      vendor: "Photo Shop",
      purchasedOn: "2026-09-01",
      submittedBy: "user-owner",
      photoStoragePath: "user-owner/photo.jpg",
    });
    const loaded = await getReceiptById(receipt.id);
    expect(loaded).not.toBeNull();

    expect(filterReceiptVisibleToViewer(loaded!, { id: "user-owner", isAdmin: false })?.id).toBe(
      receipt.id,
    );
    expect(filterReceiptVisibleToViewer(loaded!, { id: "user-other", isAdmin: false })).toBeNull();
    expect(filterReceiptVisibleToViewer(loaded!, { id: "admin-1", isAdmin: true })?.id).toBe(
      receipt.id,
    );
  });
});

describe("My Receipts defaults + URL helpers", () => {
  it("defaults to date logged newest-first with no active filters", () => {
    expect(DEFAULT_RECEIPT_LOG_FILTERS.sort).toBe("logged");
    expect(DEFAULT_RECEIPT_LOG_FILTERS.dir).toBe("desc");
    expect(
      countActiveReceiptLogFilters(DEFAULT_RECEIPT_LOG_FILTERS, { ignoreUserFilter: true }),
    ).toBe(0);
  });

  it("builds mine hrefs and round-trips filter params without requiring user filter", () => {
    const href = buildReceiptLogHref(
      {
        ...DEFAULT_RECEIPT_LOG_FILTERS,
        range: "all_time",
        vendors: ["Home Depot"],
        q: "screws",
      },
      MY_RECEIPTS_PATH,
    );
    expect(href.startsWith(`${MY_RECEIPTS_PATH}?`)).toBe(true);
    expect(href).toContain("vendor=Home+Depot");
    expect(href).toContain("q=screws");
    expect(href).not.toContain("user=");

    const exportHref = buildReceiptLogHref(
      { ...DEFAULT_RECEIPT_LOG_FILTERS, amountMin: "10" },
      MY_RECEIPTS_EXPORT_PATH,
    );
    expect(exportHref.startsWith(MY_RECEIPTS_EXPORT_PATH)).toBe(true);

    const url = new URL(`https://app.test${href}`);
    const parsed = parseReceiptLogFiltersFromParams(
      (k) => url.searchParams.get(k),
      (k) => url.searchParams.getAll(k),
    );
    expect(parsed.range).toBe("all_time");
    expect(parsed.vendors).toEqual(["Home Depot"]);
    expect(parsed.q).toBe("screws");
    expect(parsed.sort).toBe("logged");
    expect(parsed.dir).toBe("desc");
  });

  it("photo route authorizes owners as well as admins", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/receipts/[id]/photo/route.ts"),
      "utf8",
    );
    expect(source).toContain("filterReceiptVisibleToViewer");
    expect(source).not.toMatch(/if \(!isAdminRole[\s\S]*Admin access required/);
  });

  it("mine export route scopes by signed-in owner", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/receipts/mine/export/route.ts"),
      "utf8",
    );
    expect(source).toContain("getMyReceiptLogDashboard");
    expect(source).toContain("ownerUserId: user.id");
    expect(source).toContain("row.submittedBy !== user.id");
  });
});
