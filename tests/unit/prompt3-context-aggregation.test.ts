import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  decideConversationContext,
  needsEntityClarification,
} from "@/lib/baxter-ai/conversation-context";
import { buildRetrievalQuery, retrievalQueryFromHistory } from "@/lib/baxter-ai/memory";
import { parseChatCommand, baxterHelpText } from "@/lib/baxter-ai/commands";
import { parseTimeRangeFromQuestion } from "@/lib/knowledge-index/temporal";
import { salesPerformanceReportFixture } from "../fixtures/sales-performance-report";
import { expectedSoldAgreementForYear } from "@/lib/knowledge-index/sales-expectations";

export { expectedSoldAgreementForYear };

describe("Prompt 3 — conversation context policy", () => {
  const loriHistory = [
    { role: "user" as const, content: "How much was the Lori Harris project agreement for?" },
    { role: "assistant" as const, content: "The Lori Harris agreement amount was $352,933." },
  ];

  it("does not treat 'this year' as a pronoun follow-up", () => {
    const decision = decideConversationContext("How much have we sold this year?", loriHistory);
    expect(decision.inheritPriorEntities).toBe(false);
  });

  it("inherits entity for true pronoun follow-ups", () => {
    const decision = decideConversationContext("When did she close?", loriHistory);
    expect(decision.inheritPriorEntities).toBe(true);
  });

  it("retrieval query does not append Lori Harris for year sales", () => {
    expect(retrievalQueryFromHistory("How much have we sold this year?", loriHistory)).not.toMatch(
      /Lori/i,
    );
    const q = buildRetrievalQuery("How much have we sold this year?", loriHistory);
    expect(q.inheritEntities).toEqual([]);
  });

  it("retrieval query inherits Lori for 'when did she close'", () => {
    const q = buildRetrievalQuery("When did she close?", loriHistory);
    expect(q.inheritEntities.some((e) => /Lori/i.test(e))).toBe(true);
  });
  it("asks for clarification after clear on underspecified margin question", () => {
    expect(needsEntityClarification("What was the margin?", [])).toBe(true);
    expect(needsEntityClarification("What was the margin?", ["Lori Harris"])).toBe(false);
    expect(needsEntityClarification("What was Lori Harris’s margin?", [])).toBe(false);
  });
});

describe("Prompt 3 — chat commands", () => {
  it("parses /clear and /help", () => {
    expect(parseChatCommand("/clear").type).toBe("clear");
    expect(parseChatCommand("/help").type).toBe("help");
    expect(parseChatCommand("How much sold?").type).toBe("none");
  });

  it("includes Slack Search guidance in /help", () => {
    expect(baxterHelpText("web")).toMatch(/Slack Search/i);
    expect(baxterHelpText("slack")).toMatch(/RACI/i);
  });
});

describe("Prompt 3 — temporal + current-year aggregation", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
  });

  async function seedSalesReport() {
    const { resetKnowledgeUnitsMemoryForTests } = await import("@/lib/knowledge-index");
    resetKnowledgeUnitsMemoryForTests();
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
    await replaceUnitsForEntry(
      entry.id,
      unitsFromWorkbook(workbook, { sourceUrl: entry.source_url, googleFileId: "sheet-file-1" }),
    );
    return entry;
  }

  it("computes expected 2026 sum from fixture programmatically", () => {
    const expected = expectedSoldAgreementForYear(2026);
    expect(expected.count).toBe(3);
    expect(expected.sum).toBe(401_200 + 318_500 + 365_000);
  });

  it("plans and answers current-year sold as aggregate, not Lori Harris", async () => {
    await seedSalesReport();
    const { planKnowledgeQuery, searchStructuredKnowledge, draftDirectStructuredAnswer } =
      await import("@/lib/knowledge-index");
    const now = new Date("2026-07-23T12:00:00Z");
    const q = "How much have we sold this year?";
    const plan = planKnowledgeQuery(q, now);
    expect(plan.mode).toBe("structured_aggregate");
    expect(plan.entities).toEqual([]);
    expect(plan.timeRange?.year).toBe(2026);

    const result = await searchStructuredKnowledge(q, plan);
    const expected = expectedSoldAgreementForYear(2026);
    expect(result.aggregates[0]?.numericValue).toBe(expected.sum);
    expect(result.aggregates[0]?.matchedRowCount).toBe(expected.count);
    expect(result.lookups.every((l) => !/Lori/i.test(l.entityLabel))).toBe(true);

    const answer = draftDirectStructuredAnswer(q, result);
    expect(answer).toMatch(/1,084,700/);
    expect(answer).not.toMatch(/352,933/);
    expect(answer).toMatch(/agreement value/i);
  });

  it("answers 2025 sold and project counts", async () => {
    await seedSalesReport();
    const { planKnowledgeQuery, searchStructuredKnowledge } = await import("@/lib/knowledge-index");
    const now = new Date("2026-07-23T12:00:00Z");

    const sold2025 = await searchStructuredKnowledge(
      "How much did we sell in 2025?",
      planKnowledgeQuery("How much did we sell in 2025?", now),
    );
    expect(sold2025.aggregates[0]?.numericValue).toBe(expectedSoldAgreementForYear(2025).sum);

    const count2026 = await searchStructuredKnowledge(
      "How many projects have we sold this year?",
      planKnowledgeQuery("How many projects have we sold this year?", now),
    );
    expect(count2026.aggregates[0]?.numericValue).toBe(expectedSoldAgreementForYear(2026).count);
  });

  it("does not double-count Raw Data rows", async () => {
    await seedSalesReport();
    const { planKnowledgeQuery, searchStructuredKnowledge } = await import("@/lib/knowledge-index");
    const now = new Date("2026-07-23T12:00:00Z");
    const result = await searchStructuredKnowledge(
      "How much have we sold this year?",
      planKnowledgeQuery("How much have we sold this year?", now),
    );
    // Raw Data also has Sam Patel + Jordan Lee for 2026 — must still equal Sales Report only
    expect(result.aggregates[0]?.matchedRowCount).toBe(expectedSoldAgreementForYear(2026).count);
  });

  it("parses temporal phrases", () => {
    const now = new Date("2026-07-23T12:00:00Z");
    expect(parseTimeRangeFromQuestion("this year", now)?.year).toBe(2026);
    expect(parseTimeRangeFromQuestion("last year", now)?.year).toBe(2025);
    expect(parseTimeRangeFromQuestion("in 2025", now)?.year).toBe(2025);
  });
});
