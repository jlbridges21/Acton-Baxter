/**
 * Routing evaluation suite — source selection / PEM name-gating regressions.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { buildBaxterQueryPlan } from "@/lib/baxter/query-plan";
import {
  detectConceptQuestion,
  isOperationalPemMetricQuestion,
  isStructuredMetricQuestion,
} from "@/lib/baxter/concept-vocabulary";
import {
  detectPemIntent,
  parsePemEntityQuery,
  retrievePemEvidence,
} from "@/lib/baxter-data/pem-neats";
import { decideConversationContext } from "@/lib/baxter-ai/conversation-context";
import { planKnowledgeQuery } from "@/lib/knowledge-index/query-planner";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { resetBaxterConversationMemoryForTests } from "@/lib/baxter-ai/conversations";
import { createKnowledgeEntry, resetKnowledgeMemoryForTests } from "@/lib/knowledge/store";

const SALES_ID = "00000000-0000-4000-8000-000000000099";

const FEB_KPI_Q =
  "How many PEM meetings were conducted in February in the Bay Area and what was our KPI?";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.BAXTER_CHAT_ENABLED = "true";
  resetEnvCacheForTests();
  resetPemNeatMemoryStoreForTests();
  resetBaxterConversationMemoryForTests();
  resetKnowledgeMemoryForTests();
});

describe("routing eval A — PEM NEAT definition", () => {
  it("routes as concept_definition with no PEM record lookup", () => {
    const q = "What is a PEM NEAT?";
    expect(detectConceptQuestion(q).kind).toBe("definition");
    expect(detectPemIntent(q).intent).toBe("help_definition");
    expect(detectPemIntent(q).nameQuery).toBeNull();
    const plan = buildBaxterQueryPlan(q);
    expect(plan.intent).toBe("concept_definition");
    expect(plan.pemLookup).toBe("skip");
    expect(plan.prospectCandidates).toEqual([]);
  });
});

describe("routing eval B — Carter French Type 1 Pain", () => {
  it("routes as prospect_intelligence with PEM lookup", async () => {
    const q = "What is Carter French’s Type 1 Pain?";
    const pem = detectPemIntent(q);
    expect(pem.intent).toBe("record_lookup");
    expect(pem.nameQuery).toMatch(/Carter French/i);
    const plan = buildBaxterQueryPlan(q);
    expect(plan.intent).toBe("prospect_intelligence");
    expect(plan.pemLookup).toBe("run");
    expect(plan.prospectCandidates[0]).toMatch(/Carter French/i);

    const store = getPemNeatStore();
    const record = await store.create({
      prospectName: "Carter French",
      salespersonUserId: SALES_ID,
      salespersonDisplayName: "Alex Sales",
      meetingDate: "2026-01-15",
      transcript: "Advisor: Purpose today is fit. Prospect: We need an ADU. ".repeat(40),
      createdBy: SALES_ID,
    });
    const mock = buildMockPemNeatResult({
      prospectName: "Carter French",
      advisorName: "Alex Sales",
      meetingDate: "2026-01-15",
    });
    mock.salesIntelligence.type1Pain = [
      {
        statement: "Needs nearby housing for aging parents.",
        surfaceReason: null,
        deeperConsequence: null,
        whyNow: null,
        evidence: "Needs nearby housing for aging parents.",
        evidenceType: "prospect_fact",
        confidence: "high",
      },
    ];
    await store.saveGenerationSuccess(record.id, {
      structuredResult: mock,
      buildertrendFields: mock.buildertrendFields,
      analysisMetadata: mock.analysisMetadata,
      meetingOutcome: mock.salesIntelligence.meetingOutcome.classification,
      qualification: mock.salesIntelligence.qualification.classification,
      modelProvider: "mock",
      modelName: "mock-pem-neat",
      latencyMs: 5,
      neatStandardVersion: "1.0.0",
      transcriptHash: record.transcript_hash,
    });

    const evidence = await retrievePemEvidence({
      question: q,
      role: "user",
      channel: "web",
    });
    expect(evidence.answerMode).toBe("deterministic_structured");
    expect(evidence.clarification).toBeNull();
    expect(evidence.deterministicAnswer).toMatch(/aging parents|Type 1|housing/i);
  });
});

describe("routing eval C/D — PEM meeting volume / February KPI", () => {
  it("never extracts Many Meetings as a prospect", () => {
    const parsed = parsePemEntityQuery(FEB_KPI_Q);
    expect(parsed.nameQuery).toBeNull();
    expect(detectPemIntent(FEB_KPI_Q).intent).toBe("none");
    expect(detectPemIntent(FEB_KPI_Q).operationalMetric).toBe(true);
    expect(isOperationalPemMetricQuestion(FEB_KPI_Q)).toBe(true);
    expect(isStructuredMetricQuestion(FEB_KPI_Q)).toBe(true);
  });

  it("plans structured_metric and skips PEM lookup", () => {
    const plan = buildBaxterQueryPlan(FEB_KPI_Q);
    expect(plan.intent).toBe("structured_metric");
    expect(plan.pemLookup).toBe("skip");
    expect(plan.prospectCandidates).toEqual([]);
    expect(plan.geography).toMatch(/Bay Area/i);
    expect(plan.metrics.length).toBeGreaterThan(0);
    expect(plan.sourcesSkipped.some((s) => s.source === "pem_neat")).toBe(true);

    const knowledge = planKnowledgeQuery(FEB_KPI_Q);
    expect(knowledge.mode).toBe("structured_aggregate");
    expect(knowledge.aggregation).toBe("count");
    expect(knowledge.entities).not.toContain("Many Meetings");
  });

  it("retrievePemEvidence skips without Many Meetings clarification", async () => {
    const evidence = await retrievePemEvidence({
      question: FEB_KPI_Q,
      role: "user",
      channel: "web",
    });
    expect(evidence.answerMode).toBe("none");
    expect(evidence.clarification).toBeNull();
    expect(evidence.diagnostics.pemLookupSkipped).toBe(true);
    expect(evidence.diagnostics.pemSkipReason).toMatch(/metric|prospect/i);
  });

  it("answerBaxterQuestion never says Many Meetings", async () => {
    await createKnowledgeEntry(
      {
        title: "PEM NEAT",
        content: "A PEM NEAT is structured sales intelligence from a PEM transcript.",
        status: "approved",
        visibility: "internal",
        category: "Sales",
        source_type: "manual",
      },
      SALES_ID,
    );

    const answered = await answerBaxterQuestion({
      question: FEB_KPI_Q,
      userId: SALES_ID,
      channel: "web",
    });
    expect(answered.answer).not.toMatch(/Many Meetings/i);
    expect(answered.answer).not.toMatch(/couldn't find a completed PEM NEAT for/i);
    expect(answered.answerMode).not.toBe("clarification");
  });

  it("how many PEMs last month is structured metric", () => {
    const q = "How many PEMs did we run last month?";
    expect(detectPemIntent(q).intent).toBe("none");
    expect(parsePemEntityQuery(q).nameQuery).toBeNull();
    expect(buildBaxterQueryPlan(q).intent).toBe("structured_metric");
    expect(buildBaxterQueryPlan(q).pemLookup).toBe("skip");
  });
});

describe("routing eval E — Stanley Quan address → GHL-shaped plan", () => {
  it("prefers live CRM contact intent over PEM", () => {
    const q = "What is Stanley Quan’s address?";
    const plan = buildBaxterQueryPlan(q);
    expect(plan.intent).toBe("live_crm_contact");
    expect(plan.pemLookup).toBe("skip");
    expect(plan.sourcePriority[0]).toBe("ghl");
  });
});

describe("routing eval F — Slack recall", () => {
  it("routes Jess channel question to slack_recall", () => {
    const q = "What did Jess say last in #project-management?";
    const plan = buildBaxterQueryPlan(q);
    expect(plan.intent).toBe("slack_recall");
    expect(plan.pemLookup).toBe("skip");
    expect(plan.sourcePriority[0]).toBe("slack");
  });
});

describe("routing eval G — RACI latest update", () => {
  it("routes as current_status with Slack priority", () => {
    const q = "What is the latest RACI update?";
    const plan = buildBaxterQueryPlan(q);
    expect(["current_status", "slack_recall", "rulebook_process"]).toContain(plan.intent);
    expect(plan.pemLookup).toBe("skip");
    expect(plan.sourcePriority).toContain("slack");
  });
});

describe("routing eval H — PALO definition", () => {
  it("routes as concept definition without PEM lookup", () => {
    const q = "What is PALO?";
    expect(detectConceptQuestion(q).isConcept).toBe(true);
    expect(detectPemIntent(q).intent).toBe("help_definition");
    expect(buildBaxterQueryPlan(q).pemLookup).toBe("skip");
  });
});

describe("routing eval I/J — context inheritance vs reset", () => {
  it("inherits Carter for his budget follow-up", () => {
    const history = [
      { role: "user" as const, content: "What is Carter French’s Type 1 Pain?" },
      { role: "assistant" as const, content: "Type 1 pain was nearby housing." },
    ];
    const decision = decideConversationContext("What was his budget?", history);
    expect(decision.inheritPriorEntities).toBe(true);
    expect(detectPemIntent("What was his budget?").intent).toBe("record_lookup");
  });

  it("resets prospect context for sold-this-year after Carter", () => {
    const history = [
      { role: "user" as const, content: "What is Carter French’s Type 1 Pain?" },
      { role: "assistant" as const, content: "Type 1 pain was nearby housing." },
    ];
    const q = "How much have we sold this year?";
    const decision = decideConversationContext(q, history);
    expect(decision.inheritPriorEntities).toBe(false);
    expect(buildBaxterQueryPlan(q).intent).toBe("structured_metric");
    expect(buildBaxterQueryPlan(q).pemLookup).toBe("skip");
  });
});
