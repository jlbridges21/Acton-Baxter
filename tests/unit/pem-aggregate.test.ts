/**
 * PEM NEAT cross-record aggregation — deterministic counts/lists for reporting questions.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  formatPemAggregateAnswer,
  matchSalespersonName,
  resolveAggregateDateRange,
  resolveAndAggregatePemNeats,
  resolveCalendarMonthRange,
  type PemAggregateQueryParams,
} from "@/lib/baxter-data/pem-neats/aggregate";
import {
  hasMultipleInformationNeeds,
  isPemAggregateSemantic,
  runEvidenceRegistry,
  type EvidenceSource,
  type SemanticQuestionClassification,
} from "@/lib/baxter-ai/evidence-registry";
import { pemAggregateEvidenceSource } from "@/lib/baxter-ai/evidence-registry/sources/pem-aggregate";
import { parseSemanticQuestionClassificationJson } from "@/lib/baxter-ai/schemas";
import { getZonedYmd, resolveFeedbackDateRange } from "@/lib/baxter-ai/feedback-date-ranges";

function kevinAugustSemantic(): SemanticQuestionClassification {
  return {
    questionType: "pem_aggregate",
    entityName: null,
    entityTypeGuess: null,
    lookupSpecificity: null,
    informationNeeds: [],
    aggregateQuery: {
      intent: "count",
      salespersonName: "Kevin Lee",
      datePreset: null,
      customStart: null,
      customEnd: null,
      calendarMonth: 8,
      calendarYear: null,
      outcome: null,
      qualification: null,
      includeOutcomeBreakdown: true,
      highlightOutcomes: ["YES"],
    },
    confidence: 0.95,
    source: "llm",
    latencyMs: 10,
    model: "injected",
  };
}

describe("schema: pem_aggregate", () => {
  it("parses aggregateQuery for the reported Kevin/August compound", () => {
    const parsed = parseSemanticQuestionClassificationJson(
      JSON.stringify({
        questionType: "pem_aggregate",
        entityName: null,
        entityTypeGuess: null,
        lookupSpecificity: null,
        informationNeeds: [],
        aggregateQuery: {
          intent: "count",
          salespersonName: "Kevin Lee",
          calendarMonth: 8,
          includeOutcomeBreakdown: true,
          highlightOutcomes: ["YES"],
        },
        confidence: 0.96,
      }),
    );
    expect(parsed.questionType).toBe("pem_aggregate");
    expect(parsed.aggregateQuery?.salespersonName).toBe("Kevin Lee");
    expect(parsed.aggregateQuery?.calendarMonth).toBe(8);
    expect(parsed.aggregateQuery?.highlightOutcomes).toEqual(["YES"]);
    expect(parsed.informationNeeds).toEqual([]);
  });
});

describe("date range helpers (Pacific)", () => {
  it("resolves August via calendar month using Pacific bounds", () => {
    const now = new Date("2026-08-10T17:00:00.000Z");
    const { range, label } = resolveAggregateDateRange(
      {
        datePreset: null,
        customStart: null,
        customEnd: null,
        calendarMonth: 8,
        calendarYear: null,
      },
      now,
    );
    expect(label).toBe("August 2026");
    const start = getZonedYmd(new Date(range.start!));
    const end = getZonedYmd(new Date(range.end!));
    expect(start).toMatchObject({ year: 2026, month: 8, day: 1 });
    expect(end).toMatchObject({ year: 2026, month: 8, day: 31 });
  });

  it("last_month matches resolveFeedbackDateRange", () => {
    const now = new Date("2026-08-10T17:00:00.000Z");
    const expected = resolveFeedbackDateRange({ preset: "last_month", now });
    const { range, label } = resolveAggregateDateRange(
      {
        datePreset: "last_month",
        customStart: null,
        customEnd: null,
        calendarMonth: null,
        calendarYear: null,
      },
      now,
    );
    expect(label).toBe("last month");
    expect(range).toEqual(expected);
  });

  it("resolveCalendarMonthRange for future month uses prior year", () => {
    const now = new Date("2026-03-10T17:00:00.000Z");
    const range = resolveCalendarMonthRange({ month: 8, now });
    const start = getZonedYmd(new Date(range.start!));
    expect(start.year).toBe(2025);
    expect(start.month).toBe(8);
  });
});

describe("salesperson matching", () => {
  it("matches Kevin and Kevin Lee", () => {
    const people = [
      { id: "1", displayName: "Kevin Lee", role: "user" },
      { id: "2", displayName: "Katie Liniger", role: "user" },
    ];
    expect(matchSalespersonName("Kevin Lee", people).match?.id).toBe("1");
    expect(matchSalespersonName("Kevin", people).match?.id).toBe("1");
  });

  it("marks unknown names unrecognized", () => {
    expect(matchSalespersonName("Not A Person", [{ id: "1", displayName: "Kevin Lee" }])).toEqual(
      expect.objectContaining({ unrecognized: true, match: null }),
    );
  });
});

describe("format + resolve (mocked aggregate)", () => {
  it("formats total + YES highlight without editorializing", async () => {
    const params: PemAggregateQueryParams = {
      intent: "count",
      salespersonName: "Kevin Lee",
      datePreset: null,
      customStart: null,
      customEnd: null,
      calendarMonth: 8,
      calendarYear: 2026,
      outcome: null,
      qualification: null,
      includeOutcomeBreakdown: true,
      highlightOutcomes: ["YES"],
    };
    const resolved = await resolveAndAggregatePemNeats({
      params,
      listSalespeopleImpl: async () => [{ id: "kl", displayName: "Kevin Lee", role: "user" }],
      aggregateImpl: async () => ({
        total: 3,
        byOutcome: {
          YES: 1,
          NO: 1,
          DECISION_DATE: 1,
          DECISION_DATE_NOT_SECURED: 0,
          UNSET: 0,
        },
        byQualification: {
          STRONGLY_QUALIFIED: 0,
          QUALIFIED_WITH_RISKS: 0,
          EARLY_EXPLORATORY: 0,
          WEAKLY_QUALIFIED: 0,
          DISQUALIFIED: 0,
          UNSET: 3,
        },
        bySalesperson: [{ name: "Kevin Lee", userId: "kl", count: 3 }],
        matching: [
          {
            id: "a",
            prospect_name: "Ada",
            salesperson_user_id: "kl",
            salesperson_display_name: "Kevin Lee",
            meeting_date: "2026-08-02",
            meeting_outcome: "YES",
            qualification: null,
            status: "completed",
          },
          {
            id: "b",
            prospect_name: "Bea",
            salesperson_user_id: "kl",
            salesperson_display_name: "Kevin Lee",
            meeting_date: "2026-08-05",
            meeting_outcome: "NO",
            qualification: null,
            status: "completed",
          },
          {
            id: "c",
            prospect_name: "Cal",
            salesperson_user_id: "kl",
            salesperson_display_name: "Kevin Lee",
            meeting_date: "2026-08-09",
            meeting_outcome: "DECISION_DATE",
            qualification: null,
            status: "completed",
          },
        ],
        countedStatuses: ["completed", "needs_regeneration"],
        filtersApplied: {
          salesperson: "Kevin Lee",
          dateLabel: "August 2026",
          outcome: null,
          qualification: null,
        },
      }),
    });
    expect(resolved.kind).toBe("ok");
    if (resolved.kind !== "ok") return;
    const answer = formatPemAggregateAnswer({ resolved });
    expect(answer).toMatch(/Kevin Lee ran 3 completed PEMs in August 2026/);
    expect(answer).toMatch(/1 resulted in YES/);
    expect(answer).not.toMatch(/best|worst|strong|weak performance|underperform/i);
    expect(answer).toMatch(/Prospects: Ada; Bea; Cal/);
    expect(answer).toMatch(/completed \/ needs regeneration only/);
  });

  it("honest unrecognized salesperson", async () => {
    const resolved = await resolveAndAggregatePemNeats({
      params: {
        intent: "count",
        salespersonName: "Definitely Not Sales",
        datePreset: "this_month",
        customStart: null,
        customEnd: null,
        calendarMonth: null,
        calendarYear: null,
        outcome: null,
        qualification: null,
        includeOutcomeBreakdown: false,
        highlightOutcomes: [],
      },
      listSalespeopleImpl: async () => [{ id: "kl", displayName: "Kevin Lee" }],
    });
    expect(resolved.kind).toBe("unrecognized_salesperson");
  });

  it("zero results formats none-found honestly", async () => {
    const resolved = await resolveAndAggregatePemNeats({
      params: {
        intent: "count",
        salespersonName: "Kevin Lee",
        datePreset: null,
        customStart: null,
        customEnd: null,
        calendarMonth: 1,
        calendarYear: 2020,
        outcome: null,
        qualification: null,
        includeOutcomeBreakdown: false,
        highlightOutcomes: [],
      },
      listSalespeopleImpl: async () => [{ id: "kl", displayName: "Kevin Lee" }],
      aggregateImpl: async () => ({
        total: 0,
        byOutcome: {
          YES: 0,
          NO: 0,
          DECISION_DATE: 0,
          DECISION_DATE_NOT_SECURED: 0,
          UNSET: 0,
        },
        byQualification: {
          STRONGLY_QUALIFIED: 0,
          QUALIFIED_WITH_RISKS: 0,
          EARLY_EXPLORATORY: 0,
          WEAKLY_QUALIFIED: 0,
          DISQUALIFIED: 0,
          UNSET: 0,
        },
        bySalesperson: [],
        matching: [],
        countedStatuses: ["completed", "needs_regeneration"],
        filtersApplied: {
          salesperson: "Kevin Lee",
          dateLabel: "January 2020",
          outcome: null,
          qualification: null,
        },
      }),
    });
    expect(resolved.kind).toBe("ok");
    if (resolved.kind !== "ok") return;
    const answer = formatPemAggregateAnswer({ resolved });
    expect(answer).toMatch(/ran 0 completed PEM/);
    expect(answer).not.toMatch(/undefined|NaN/);
  });
});

describe("evidence registry: pem_aggregate vs entity PEM", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    process.env.BAXTER_CHAT_ENABLED = "true";
    resetEnvCacheForTests();
  });
  afterEach(() => resetEnvCacheForTests());

  it("aggregate semantic is detected and not multi-need", () => {
    const semantic = kevinAugustSemantic();
    expect(isPemAggregateSemantic(semantic)).toBe(true);
    expect(hasMultipleInformationNeeds(semantic)).toBe(false);
  });

  it("pem_aggregate source answers compound count+YES in one resolve", async () => {
    const aggregate: EvidenceSource = {
      ...pemAggregateEvidenceSource,
      resolve: async () => ({
        items: [],
        deterministicAnswer:
          "Kevin Lee ran 2 completed PEMs in August 2026.\n1 resulted in YES.\n\nSource: PEM NEAT records.",
        confidence: 0.98,
      }),
    };
    let entityPemCalls = 0;
    const entityPem: EvidenceSource = {
      key: "pem_neat",
      canHandle: () => ({ plausible: true, confidence: 0.9 }),
      resolve: async () => {
        entityPemCalls += 1;
        return {
          items: [],
          deterministicAnswer: "should not run for aggregate",
          confidence: 0.95,
        };
      },
    };

    const result = await runEvidenceRegistry({
      question: "How many PEMs did Kevin Lee run in August, and how many resulted in a YES?",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: false,
      semantic: kevinAugustSemantic(),
      sources: [aggregate, entityPem],
    });

    expect(result.earlyAnswer?.modelName).toBe("deterministic-aggregate");
    expect(result.earlyAnswer?.answer).toMatch(/Kevin Lee ran 2/);
    expect(result.earlyAnswer?.answer).toMatch(/YES/);
    expect(entityPemCalls).toBe(0);
  });

  it("single-entity budget still uses pem_neat, not pem_aggregate", async () => {
    let aggCalls = 0;
    let pemCalls = 0;
    const aggregate: EvidenceSource = {
      key: "pem_aggregate",
      canHandle: () => ({ plausible: false, confidence: 0 }),
      resolve: async () => {
        aggCalls += 1;
        return { items: [], deterministicAnswer: "agg", confidence: 0.98 };
      },
    };
    const pem: EvidenceSource = {
      key: "pem_neat",
      canHandle: () => ({ plausible: true, confidence: 0.92 }),
      resolve: async () => {
        pemCalls += 1;
        return {
          items: [
            {
              number: 1,
              id: "pem-1",
              title: "Razel",
              summary: "budget",
              contentExcerpt: "$100k",
              category: "PEM NEAT",
              tags: [],
              sourceName: "PEM NEAT",
              sourceUrl: null,
              sourceType: "pem",
              mimeType: null,
              updatedAt: new Date().toISOString(),
              citationLabel: "Razel — PEM NEAT",
              relevanceScore: 100,
            },
          ],
          deterministicAnswer: "Razel Talle’s budget is $100k.",
          confidence: 0.95,
        };
      },
    };

    const result = await runEvidenceRegistry({
      question: "what is Razel Talle's budget",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: false,
      semantic: {
        questionType: "entity_lookup",
        entityName: "Razel Talle",
        entityTypeGuess: "pem_prospect",
        lookupSpecificity: "specific",
        informationNeeds: [],
        aggregateQuery: null,
        confidence: 0.93,
        source: "llm",
        latencyMs: 5,
        model: "injected",
      },
      sources: [aggregate, pem],
    });

    expect(result.earlyAnswer?.winningSource).toBe("pem_neat");
    expect(result.earlyAnswer?.answer).toMatch(/budget/);
    expect(aggCalls).toBe(0);
    expect(pemCalls).toBe(1);
  });

  it("entity PEM canHandle refuses when semantic is pem_aggregate", async () => {
    const { pemEvidenceSource } = await import("@/lib/baxter-ai/evidence-registry/sources/pem");
    const { resolveQuestionEntity } = await import("@/lib/baxter-ai/evidence-registry");
    const semantic = kevinAugustSemantic();
    const entity = resolveQuestionEntity({
      question: "How many PEMs did Kevin Lee run in August?",
      semantic,
    });
    const handle = pemEvidenceSource.canHandle({
      question: "How many PEMs did Kevin Lee run in August?",
      history: [],
      entity,
      preferredSource: null,
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: false,
    });
    expect(handle.plausible).toBe(false);
  });
});
