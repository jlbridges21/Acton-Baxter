import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { salesPerformanceReportFixture } from "../fixtures/sales-performance-report";

describe("structured spreadsheet parsing", () => {
  it("detects header row after title/summary and parses Lori Harris", async () => {
    const { parseWorkbookFromSheets, detectHeaderRowIndex } =
      await import("@/lib/knowledge-index/spreadsheet-parser");
    const fixture = salesPerformanceReportFixture();
    const headerIdx = detectHeaderRowIndex(fixture.sheets[0]!.grid);
    expect(headerIdx).toBe(10);

    const workbook = parseWorkbookFromSheets(fixture.title, fixture.sheets);
    expect(workbook.sheets).toHaveLength(2);
    const sales = workbook.sheets.find((s) => s.name === "Sales Report")!;
    expect(sales.tables[0]?.headers).toContain("Agreement Amount");
    expect(sales.tables[0]?.headers).not.toContain("col2");
    const lori = sales.tables[0]?.rows.find((r) =>
      r.values["Customer Name"]?.display.includes("Lori Harris"),
    );
    expect(lori?.values["Agreement Amount"]?.display).toBe("$352,933");
    expect(lori?.values["Agreement Amount"]?.numeric).toBe(352933);
    expect(lori?.values["Close Date"]?.dateIso).toBe("2025-03-27");
    expect(lori?.displayLines).toContain("Agreement Amount: $352,933");
    expect(sales.summaryMetrics[0]?.metrics["Total Agreement Value"]?.display).toBe("$13,194,967");
    expect(workbook.contentText).not.toMatch(/col2=/);
  });
});

describe("Lori Harris structured retrieval", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    const { resetKnowledgeUnitsMemoryForTests } = await import("@/lib/knowledge-index");
    resetKnowledgeUnitsMemoryForTests();
  });

  async function seedSalesReport() {
    const { createKnowledgeEntry } = await import("@/lib/knowledge/store");
    const { parseWorkbookFromSheets, unitsFromWorkbook, replaceUnitsForEntry } =
      await import("@/lib/knowledge-index");
    const fixture = salesPerformanceReportFixture();
    const workbook = parseWorkbookFromSheets(fixture.title, fixture.sheets);
    const entry = await createKnowledgeEntry(
      {
        title: fixture.title,
        content: workbook.contentText,
        summary: "Synced from Google Workspace",
        category: "Google Workspace",
        tags: ["google", "sheet"],
        source_name: "Acton ADU",
        source_type: "Google Drive",
        source_url: "https://docs.google.com/spreadsheets/d/example/edit",
        visibility: "internal",
        status: "approved",
      },
      "00000000-0000-4000-8000-000000000001",
    );
    const drafts = unitsFromWorkbook(workbook, {
      sourceUrl: entry.source_url,
      googleFileId: "sheet-file-1",
    });
    await replaceUnitsForEntry(entry.id, drafts);
    return { entry, workbook };
  }

  it("answers agreement amount $352,933", async () => {
    await seedSalesReport();
    const { searchStructuredKnowledge, draftDirectStructuredAnswer, planKnowledgeQuery } =
      await import("@/lib/knowledge-index");
    const q = "How much was the Lori Harris project agreement for?";
    const plan = planKnowledgeQuery(q);
    expect(plan.mode).toBe("structured_lookup");
    expect(plan.entities.some((e) => /lori harris/i.test(e))).toBe(true);
    const result = await searchStructuredKnowledge(q, plan);
    expect(result.lookups[0]?.directValue).toBe("$352,933");
    const answer = draftDirectStructuredAnswer(q, result);
    expect(answer).toMatch(/\$352,933/);
    expect(answer).not.toMatch(/couldn.?t find/i);
  });

  it("answers close date, size, cost, margin, and type", async () => {
    await seedSalesReport();
    const { searchStructuredKnowledge } = await import("@/lib/knowledge-index");

    const cases: Array<[string, RegExp]> = [
      ["When did Lori Harris close?", /March 27, 2025|Mar 27, 2025/],
      ["How big was the Lori Harris project?", /559/],
      ["What did we estimate Lori Harris would cost internally?", /\$258,241/],
      ["What was the estimated margin on Lori Harris?", /26\.8%|\$94,692/],
      ["Was Lori Harris Build Ready or custom?", /Custom/i],
    ];

    for (const [q, expected] of cases) {
      const result = await searchStructuredKnowledge(q);
      const blob = [
        result.lookups[0]?.directValue ?? "",
        ...Object.values(result.lookups[0]?.relatedValues ?? {}),
      ].join(" ");
      expect(blob, q).toMatch(expected);
    }
  });

  it("retrieves summary metrics", async () => {
    await seedSalesReport();
    const { searchStructuredKnowledge, planKnowledgeQuery } = await import("@/lib/knowledge-index");
    const q = "What was the total agreement value in the trailing two-year report?";
    const plan = planKnowledgeQuery(q);
    expect(plan.requestedFields).toContain("Total Agreement Value");
    const total = await searchStructuredKnowledge(q, plan);
    const totalValue =
      total.aggregates.find((a) => a.displayValue.includes("13,194,967"))?.displayValue ||
      total.aggregates[0]?.displayValue ||
      total.lookups[0]?.directValue;
    expect(totalValue).toBe("$13,194,967");

    const avg = await searchStructuredKnowledge("What was our average margin?");
    const avgValue =
      avg.aggregates.find((a) => /28\.9%/.test(a.displayValue))?.displayValue ||
      avg.aggregates[0]?.displayValue;
    expect(avgValue).toMatch(/28\.9%/);

    // Count: row aggregation over indexed spreadsheet rows (fixture has 3 sales rows)
    const { listAllSpreadsheetRowUnits } = await import("@/lib/knowledge-index");
    const rows = (await listAllSpreadsheetRowUnits()).filter((u) => u.unit_type === "spreadsheet_row");
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("prefers Sales Report over Raw Data for the same customer", async () => {
    await seedSalesReport();
    const { searchStructuredKnowledge } = await import("@/lib/knowledge-index");
    const result = await searchStructuredKnowledge(
      "How much was the Lori Harris project agreement for?",
    );
    expect(result.lookups[0]?.sheetName).toBe("Sales Report");
    expect(result.lookups.filter((l) => /lori/i.test(l.entityLabel)).length).toBeLessThanOrEqual(1);
  });

  it("does not present estimate as actual cost", async () => {
    await seedSalesReport();
    const { searchStructuredKnowledge, draftDirectStructuredAnswer } =
      await import("@/lib/knowledge-index");
    const q = "What did Lori Harris actually cost us?";
    const result = await searchStructuredKnowledge(q);
    const answer = draftDirectStructuredAnswer(q, result);
    expect(answer).toMatch(/estimated/i);
    expect(answer).toMatch(/\$258,241/);
    expect(answer).toMatch(/not identify that number as the final actual cost/i);
  });
});

describe("document chunking", () => {
  it("splits markdown by headings", async () => {
    const { chunkDocumentContent } = await import("@/lib/knowledge-index");
    const units = chunkDocumentContent({
      title: "Feasibility Package Process",
      content: `# Intro\n\nHello\n\n## What happens after payment\n\nWe schedule the visit.`,
    });
    expect(units.length).toBeGreaterThanOrEqual(2);
    expect(units.some((u) => u.title === "What happens after payment")).toBe(true);
  });
});
