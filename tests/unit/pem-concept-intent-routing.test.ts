import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  detectPemIntent,
  parsePemEntityQuery,
} from "@/lib/baxter-data/pem-neats";
import {
  detectConceptQuestion,
  isReservedConceptName,
  resolveConceptFollowUp,
  resolveRetryQuestion,
} from "@/lib/baxter/concept-vocabulary";
import { describeConceptRoutingDiagnostics } from "@/lib/baxter/capability-registry";
import { scoreKnowledgeMatch } from "@/lib/knowledge/retrieval";
import { createKnowledgeEntry, resetKnowledgeMemoryForTests } from "@/lib/knowledge/store";
import { searchApprovedKnowledge } from "@/lib/knowledge/queries";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { resetBaxterConversationMemoryForTests } from "@/lib/baxter-ai/conversations";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";

const SALES_ID = "00000000-0000-4000-8000-000000000099";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.BAXTER_CHAT_ENABLED = "true";
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.OPENAI_API_KEY = "";
  process.env.ENABLE_GHL_INTEGRATION = "false";
  process.env.BAXTER_CHAT_MODEL = "gpt-5.6-terra";
  resetEnvCacheForTests();
  resetPemNeatMemoryStoreForTests();
  resetBaxterConversationMemoryForTests();
  resetKnowledgeMemoryForTests();
});

async function seedCompletedPem(input: {
  prospectName: string;
  meetingDate: string;
  type1?: string;
  budget?: string;
}) {
  const store = getPemNeatStore();
  const created = await store.create({
    prospectName: input.prospectName,
    salespersonUserId: SALES_ID,
    salespersonDisplayName: "Jesse",
    meetingDate: input.meetingDate,
    transcript: "Advisor: Purpose today is fit. Prospect: We need an ADU. ".repeat(40),
    createdBy: SALES_ID,
  });
  const mock = buildMockPemNeatResult({
    prospectName: input.prospectName,
    advisorName: "Jesse",
    meetingDate: input.meetingDate,
  });
  if (input.type1) {
    mock.salesIntelligence.type1Pain = [
      {
        statement: input.type1,
        surfaceReason: null,
        deeperConsequence: null,
        whyNow: null,
        evidence: input.type1,
        evidenceType: "prospect_fact",
        confidence: "high",
      },
    ];
  }
  if (input.budget) {
    mock.salesIntelligence.budget.target = {
      value: input.budget,
      evidenceType: "prospect_fact",
      confidence: "high",
    };
    mock.salesIntelligence.budget.range = null;
  }
  await store.saveGenerationSuccess(created.id, {
    structuredResult: mock,
    buildertrendFields: mock.buildertrendFields,
    analysisMetadata: mock.analysisMetadata,
    meetingOutcome: mock.salesIntelligence.meetingOutcome.classification,
    qualification: mock.salesIntelligence.qualification.classification,
    modelProvider: "mock",
    modelName: "mock-pem-neat",
    latencyMs: 5,
    neatStandardVersion: "1.0.0",
    transcriptHash: created.transcript_hash,
  });
  return created;
}

describe("concept vs PEM record intent", () => {
  it("never treats PEM NEAT as a prospect name", () => {
    expect(isReservedConceptName("PEM NEAT")).toBe(true);
    expect(isReservedConceptName("Pem Neat")).toBe(true);
    expect(parsePemEntityQuery("What is a PEM NEAT?").nameQuery).toBeNull();
    expect(detectPemIntent("What is a PEM NEAT?").intent).toBe("help_definition");
    expect(detectConceptQuestion("What is a PEM NEAT?").kind).toBe("definition");
  });

  it("routes definition phrasings to concept help, not record lookup", () => {
    for (const q of [
      "What is a PEM NEAT?",
      "Explain what a PEM NEAT is.",
      "What does PEM NEAT mean?",
      "What is a PEM NEAT for?",
      "Explain what a PEM NEAT is for those who don’t know.",
      "What is a PEM?",
      "What is Type 1 Pain?",
      "What is PALO?",
    ]) {
      expect(detectPemIntent(q).intent, q).toBe("help_definition");
      expect(detectPemIntent(q).nameQuery, q).toBeNull();
    }
  });

  it("keeps prospect-specific PEM lookups as record_lookup", () => {
    expect(detectPemIntent("What is Carter French’s Type 1 Pain?").intent).toBe("record_lookup");
    expect(detectPemIntent("What is Carter French’s Type 1 Pain?").nameQuery).toBe("Carter French");
    expect(detectPemIntent("Show me Robert Vertin’s PEM NEAT.").intent).toBe("record_lookup");
    expect(detectPemIntent("Show me Robert Vertin’s PEM NEAT.").nameQuery).toBe("Robert Vertin");
  });

  it("asks for a prospect when PEM NEAT is requested without a person", () => {
    expect(detectPemIntent("Show me the PEM NEAT.").intent).toBe("record_lookup");
    expect(detectPemIntent("Show me the PEM NEAT.").nameQuery).toBeNull();
  });

  it("does not treat Try again as a PEM selection reply", () => {
    expect(detectPemIntent("Try again").intent).not.toBe("pem_selection_reply");
    expect(detectPemIntent("Try again. Explain what a PEM NEAT is.").intent).toBe(
      "help_definition",
    );
  });
});

describe("Knowledge exact title ranking for PEM NEAT", () => {
  it("ranks exact title PEM NEAT first", async () => {
    await createKnowledgeEntry(
      {
        title: "Unrelated ADU overview",
        content: "General ADU notes without neat details.",
        status: "approved",
        visibility: "internal",
        category: "General",
        source_type: "manual",
      },
      SALES_ID,
    );
    await createKnowledgeEntry(
      {
        title: "PEM NEAT",
        content:
          "A PEM NEAT is the structured sales intelligence Baxter generates from a Partnership Evaluation Meeting transcript. It includes Notes, Email, Assessment, Transcript, Type 1 and Type 2 Pain, budget, and BuilderTrend handoff fields.",
        status: "approved",
        visibility: "internal",
        category: "Sales",
        source_type: "manual",
      },
      SALES_ID,
    );

    const results = await searchApprovedKnowledge({
      query: "What is a PEM NEAT?",
      limit: 5,
      visibility: "internal",
    });
    expect(results[0]?.title).toBe("PEM NEAT");
    expect(
      scoreKnowledgeMatch(
        {
          id: "1",
          title: "PEM NEAT",
          content: "structured sales intelligence",
          summary: null,
          category: "Sales",
          tags: [],
          source_name: "Manual",
          source_type: "manual",
          source_url: null,
          source_external_id: null,
          status: "approved",
          visibility: "internal",
          version: 1,
          created_by: SALES_ID,
          updated_by: SALES_ID,
          approved_by: SALES_ID,
          approved_at: new Date().toISOString(),
          archived_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: {},
        },
        "What is a PEM NEAT?",
      ),
    ).toBeGreaterThan(50);
  });
});

describe("answerBaxterQuestion concept routing", () => {
  it("answers What is a PEM NEAT? without prospect clarification", async () => {
    await createKnowledgeEntry(
      {
        title: "PEM NEAT",
        content:
          "A PEM NEAT is the structured, usable sales intelligence Baxter generates from a completed Partnership Evaluation Meeting transcript. It turns the raw conversation into the customer story, Type 1 and Type 2 Pain, budget, decision process, schedule, meeting outcome, sales assessment/coaching, follow-up email, project intelligence, and BuilderTrend handoff fields.",
        status: "approved",
        visibility: "internal",
        category: "Sales",
        source_type: "manual",
      },
      SALES_ID,
    );

    const answered = await answerBaxterQuestion({
      question: "What is a PEM NEAT?",
      userId: SALES_ID,
      channel: "web",
    });
    expect(answered.answer).not.toMatch(/couldn't find a completed PEM NEAT for Pem Neat/i);
    expect(answered.answer).not.toMatch(/Which prospect/i);
    expect(answered.answerMode).not.toBe("clarification");
    expect(answered.answer).toMatch(/PEM NEAT|Partnership Evaluation|sales intelligence|NEAT/i);
  });

  it("answers how to generate with workflow + PEM route", async () => {
    const answered = await answerBaxterQuestion({
      question: "How do I generate a PEM NEAT?",
      userId: SALES_ID,
      channel: "web",
    });
    expect(answered.answer).toMatch(/Add PEM NEAT|paste|Generate/i);
    expect(answered.answer).toMatch(/pem-neats/);
    expect(answered.answer).not.toMatch(/Which prospect/i);
  });

  it("retry after bad clarification re-routes to definition", async () => {
    const first = await answerBaxterQuestion({
      question: "What is a PEM NEAT?",
      userId: SALES_ID,
      channel: "web",
    });
    // Simulate a prior wrong clarification already stored — user retries
    const retry = await answerBaxterQuestion({
      question: "Try again. Explain what a PEM NEAT is for those who don’t know.",
      userId: SALES_ID,
      channel: "web",
      conversationId: first.conversationId,
    });
    expect(retry.answer).not.toMatch(/Which prospect/i);
    expect(retry.answer).not.toMatch(/couldn't find a completed PEM NEAT for Pem Neat/i);
    expect(retry.answerMode).not.toBe("clarification");
    expect(retry.answer).toMatch(/PEM NEAT|Notes|Assessment|Transcript/i);
  });

  it("resolveRetryQuestion recovers prior definition ask", () => {
    expect(
      resolveRetryQuestion("Try again", [
        { role: "user", content: "What is a PEM NEAT?" },
        { role: "assistant", content: "Which prospect's PEM NEAT should I use?" },
      ]),
    ).toBe("What is a PEM NEAT?");
  });

  it("follow-up how do I make one resolves to PEM NEAT how-to", () => {
    expect(
      resolveConceptFollowUp("How do I make one?", [
        { role: "user", content: "What is a PEM NEAT?" },
      ]),
    ).toMatch(/generate a PEM NEAT/i);
  });

  it("Carter French Type 1 still uses saved PEM record", async () => {
    await seedCompletedPem({
      prospectName: "Carter French",
      meetingDate: "2026-07-20",
      type1: "Independent housing for aging parents nearby",
    });
    const answered = await answerBaxterQuestion({
      question: "What is Carter French’s Type 1 Pain?",
      userId: SALES_ID,
      channel: "web",
    });
    expect(answered.answer).toMatch(/Independent housing for aging parents nearby/i);
    expect(answered.answer).not.toMatch(/why the homeowner is considering an ADU/i);
  });

  it("Robert Vertin PEM NEAT record lookup still works", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin",
      meetingDate: "2026-07-18",
      type1: "Robert wants backyard privacy",
      budget: "425000",
    });
    const answered = await answerBaxterQuestion({
      question: "Show me Robert Vertin’s PEM NEAT.",
      userId: SALES_ID,
      channel: "web",
    });
    expect(answered.answer).toMatch(/Robert/i);
    expect(answered.answerMode).not.toBe("clarification");
  });

  it("Show me the PEM NEAT clarifies when prospect unspecified", async () => {
    const answered = await answerBaxterQuestion({
      question: "Show me the PEM NEAT.",
      userId: SALES_ID,
      channel: "web",
    });
    expect(answered.answer).toMatch(/Which prospect/i);
    expect(answered.answerMode).toBe("clarification");
  });

  it("What can you do uses capability metadata", async () => {
    const answered = await answerBaxterQuestion({
      question: "What can you do?",
      userId: SALES_ID,
      channel: "web",
    });
    expect(answered.answer).toMatch(/PEM|Knowledge|Property Research|Slack|GoHighLevel|GHL/i);
    expect(answered.answerMode).not.toBe("clarification");
  });
});

describe("routing diagnostics", () => {
  it("exposes concept_definition for What is a PEM NEAT?", () => {
    const d = describeConceptRoutingDiagnostics("What is a PEM NEAT?");
    expect(d.intent).toBe("concept_definition");
    expect(d.concept).toBe("pem_neat");
    expect(d.entityLookup).toBe("skipped");
    expect(d.knowledgeSearchTerms).toContain("PEM NEAT");
  });
});
