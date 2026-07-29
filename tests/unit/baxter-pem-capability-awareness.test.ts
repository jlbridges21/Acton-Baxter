import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  detectPemIntent,
  detectRequestedPemFields,
  getPemField,
  parsePemEntityQuery,
  pemHelpDefinitionAnswer,
  scoreNameMatch,
} from "@/lib/baxter-data/pem-neats";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { resetBaxterConversationMemoryForTests } from "@/lib/baxter-ai/conversations";
import { resetKnowledgeMemoryForTests } from "@/lib/knowledge/store";

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
  type2?: string;
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
  if (input.type2) {
    mock.salesIntelligence.type2Pain = [
      {
        statement: input.type2,
        evidence: input.type2,
        evidenceType: "prospect_fact",
        confidence: "high",
      },
    ];
  } else {
    mock.salesIntelligence.type2Pain = [
      {
        statement: "Communication and coordination with prior contractors was unreliable.",
        evidence: "Prospect cited poor updates.",
        evidenceType: "prospect_fact",
        confidence: "high",
      },
    ];
  }
  if (input.budget) {
    mock.salesIntelligence.budget.summary = `Working budget about ${input.budget}.`;
    mock.salesIntelligence.budget.statedBudget = {
      value: input.budget,
      evidenceType: "prospect_fact",
      confidence: "high",
    };
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
  return created.id;
}

describe("PEM entity + field parsing", () => {
  it("parses Robert Vertin Test 8 case-insensitively", () => {
    const a = parsePemEntityQuery("What is Robert vertin test 8 type 1 pain?");
    expect(a.nameQuery?.toLowerCase()).toContain("robert vertin");
    expect(a.discriminator?.toLowerCase()).toMatch(/test\s*8/);
    expect(detectPemIntent("What is Robert vertin test 8 type 1 pain?").intent).toBe(
      "record_lookup",
    );
    expect(detectRequestedPemFields("What is Robert vertin test 8 type 1 pain?")).toEqual([
      "type_1_pain",
    ]);
  });

  it("keeps Type 1 vs Type 2 distinct even when both words appear", () => {
    expect(detectRequestedPemFields("That is type 2 pain. What is his type 1 pain?")).toEqual([
      "type_1_pain",
    ]);
    expect(detectRequestedPemFields("What is his Type 2 pain?")).toEqual(["type_2_pain"]);
  });

  it("never returns Type 2 when Type 1 is missing", () => {
    const mock = buildMockPemNeatResult({ prospectName: "X", advisorName: "Y" });
    mock.salesIntelligence.type1Pain = [];
    mock.salesIntelligence.type2Pain = [
      {
        statement: "Contractor communication concerns",
        evidence: "x",
        evidenceType: "prospect_fact",
        confidence: "high",
      },
    ];
    const field = getPemField(mock, "type_1_pain");
    expect(field.determinable).toBe(false);
    expect(field.lines.join(" ")).not.toMatch(/communication/i);
  });
});

describe("Robert Vertin Test 8 / Test 2 production regressions", () => {
  it("1) clarifies when multiple Vertin PEMs exist", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "Independent housing for his adult son near family.",
    });
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 2",
      meetingDate: "2026-07-10",
      type1: "Older meeting Type 1 about parking.",
    });

    const first = await answerBaxterQuestion({
      question: "What is Robert Vertin’s type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    expect(first.answerMode).toBe("clarification");
    expect(first.answer).toMatch(/Test 8/);
    expect(first.answer).toMatch(/Test 2/);
  });

  it("2) Test 8 resolves pending question to exact Type 1", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "Independent housing for his adult son near family.",
      type2: "Communication and coordination challenges with team members.",
      budget: "450000",
    });
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 2",
      meetingDate: "2026-07-10",
      type1: "Older meeting Type 1 about parking.",
      budget: "300000",
    });

    const first = await answerBaxterQuestion({
      question: "What is Robert Vertin's type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    const second = await answerBaxterQuestion({
      question: "Test 8",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    expect(second.answerMode).toBe("grounded");
    expect(second.answer).toMatch(/Independent housing for his adult son/i);
    expect(second.answer).not.toMatch(/Communication and coordination/i);
    expect(second.answer).not.toMatch(/consult with the project lead|refer to the specific PEM/i);
    expect(second.sources[0]?.sourceKind).toBe("pem_neat");
  });

  it("3) follow-up keeps Test 8 after correction prompt", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "Independent housing for his adult son near family.",
      type2: "Communication and coordination challenges with team members.",
    });
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 2",
      meetingDate: "2026-07-10",
      type1: "Older Type 1",
    });

    const first = await answerBaxterQuestion({
      question: "What is Robert Vertin's type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    await answerBaxterQuestion({
      question: "Test 8",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    const follow = await answerBaxterQuestion({
      question: "That is type 2 pain. What is his type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    expect(follow.answerMode).not.toBe("clarification");
    expect(follow.answer).toMatch(/Independent housing for his adult son/i);
    expect(follow.answer).not.toMatch(/Communication and coordination/i);
  });

  it("4) explicit lowercase query resolves without clarification", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "Independent housing for his adult son near family.",
    });
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 2",
      meetingDate: "2026-07-10",
      type1: "Older Type 1",
    });

    const answered = await answerBaxterQuestion({
      question: "What is Robert vertin test 8 type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    expect(answered.answerMode).toBe("grounded");
    expect(answered.answer).toMatch(/Independent housing for his adult son/i);
    expect(answered.answer).not.toMatch(/Which prospect/i);
  });

  it("5) Type 2 is exact Type 2 field", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "Independent housing for his adult son near family.",
      type2: "Fear of surprise costs and poor contractor communication.",
    });
    const answered = await answerBaxterQuestion({
      question: "What is Robert Vertin Test 8 type 2 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    expect(answered.answer).toMatch(/surprise costs|poor contractor communication/i);
    expect(answered.answer).not.toMatch(/Independent housing for his adult son/i);
  });

  it("6) budget follow-up inherits Test 8", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "Independent housing for his adult son near family.",
      budget: "450000",
    });
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 2",
      meetingDate: "2026-07-10",
      budget: "300000",
    });
    const first = await answerBaxterQuestion({
      question: "What is Robert Vertin's type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    await answerBaxterQuestion({
      question: "Test 8",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    const budget = await answerBaxterQuestion({
      question: "What is his budget?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    expect(budget.answer).toMatch(/450000/);
    expect(budget.answer).not.toMatch(/300000/);
  });

  it("7) Use Test 2 switches active PEM for budget", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      budget: "450000",
      type1: "T1-8",
    });
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 2",
      meetingDate: "2026-07-10",
      budget: "300000",
      type1: "T1-2",
    });
    const first = await answerBaxterQuestion({
      question: "What is Robert Vertin's type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    await answerBaxterQuestion({
      question: "Test 8",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    const switched = await answerBaxterQuestion({
      question: "Use Test 2. What was his budget?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    expect(switched.answer).toMatch(/300000/);
    expect(switched.answer).not.toMatch(/450000/);
  });

  it("8) What is Type 1 pain? without prospect is concept help", async () => {
    const answered = await answerBaxterQuestion({
      question: "What is Type 1 pain?",
      userId: SALES_ID,
      channel: "web",
    });
    expect(answered.answer).toMatch(/why the homeowner is considering an ADU/i);
    expect(answered.answer).not.toMatch(/Do you mean/i);
  });

  it("9-10) PEM / PEM NEAT definitions", () => {
    expect(pemHelpDefinitionAnswer("What is a PEM?")).toMatch(/Partnership Evaluation Meeting/i);
    expect(pemHelpDefinitionAnswer("What is a PEM NEAT?")).toMatch(/N\*\*otes|Notes/i);
  });

  it("11) What is Robert Vertin's PEM? clarifies when multiple", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "T1-8",
    });
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 2",
      meetingDate: "2026-07-10",
      type1: "T1-2",
    });
    const answered = await answerBaxterQuestion({
      question: "What is Robert Vertin's PEM?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    expect(answered.answerMode).toBe("clarification");
  });

  it("12) explicit Test 8 overrides remembered Test 2", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "T1 from Test 8",
      budget: "450000",
    });
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 2",
      meetingDate: "2026-07-10",
      type1: "T1 from Test 2",
      budget: "300000",
    });
    const first = await answerBaxterQuestion({
      question: "What is Robert Vertin's type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    await answerBaxterQuestion({
      question: "Test 2",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    const override = await answerBaxterQuestion({
      question: "What is Robert Vertin Test 8 type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    expect(override.answer).toMatch(/T1 from Test 8/);
    expect(override.answer).not.toMatch(/T1 from Test 2/);
  });

  it("13) /clear removes inherited PEM state", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "Independent housing for his adult son near family.",
    });
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 2",
      meetingDate: "2026-07-10",
      type1: "Older",
    });
    const first = await answerBaxterQuestion({
      question: "What is Robert Vertin's type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    await answerBaxterQuestion({
      question: "Test 8",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    await answerBaxterQuestion({
      question: "/clear",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    const after = await answerBaxterQuestion({
      question: "What was his Type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    expect(after.answerMode).toBe("clarification");
  });

  it("14) null Type 1 never falls back to Type 2", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "",
      type2: "Communication and coordination challenges with team members.",
    });
    // Force empty type1
    const store = getPemNeatStore();
    const listed = await store.list({ query: "Robert Vertin Test 8", status: "completed" });
    const full = await store.get(listed[0]!.id);
    const structured = full!.structured_result as ReturnType<typeof buildMockPemNeatResult>;
    structured.salesIntelligence.type1Pain = [];
    await store.saveGenerationSuccess(full!.id, {
      structuredResult: structured,
      buildertrendFields: structured.buildertrendFields,
      analysisMetadata: structured.analysisMetadata,
      meetingOutcome: structured.salesIntelligence.meetingOutcome.classification,
      qualification: structured.salesIntelligence.qualification.classification,
      modelProvider: "mock",
      modelName: "mock",
      latencyMs: 1,
      neatStandardVersion: "1.0.0",
      transcriptHash: full!.transcript_hash!,
    });

    const answered = await answerBaxterQuestion({
      question: "What is Robert Vertin Test 8 type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    expect(answered.answer).toMatch(/does not contain a determinable Type 1 Pain/i);
    expect(answered.answer).not.toMatch(/Communication and coordination/i);
  });

  it("15) web and Slack return the same Type 1 fact", async () => {
    await seedCompletedPem({
      prospectName: "Robert Vertin Test 8",
      meetingDate: "2026-07-28",
      type1: "Independent housing for his adult son near family.",
    });
    const slack = await answerBaxterQuestion({
      question: "What is Robert Vertin Test 8 type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    const web = await answerBaxterQuestion({
      question: "What is Robert Vertin Test 8 type 1 pain?",
      userId: SALES_ID,
      channel: "web",
    });
    expect(slack.answer).toMatch(/Independent housing for his adult son/i);
    expect(web.answer).toMatch(/Independent housing for his adult son/i);
  });
});

describe("retrievePemEvidence scoring helpers", () => {
  it("scores full and partial names", () => {
    expect(scoreNameMatch("Robert Vertin Test 8", "robert vertin test 8")).toBeGreaterThanOrEqual(
      100,
    );
    expect(scoreNameMatch("Robert Vertin Test 8", "Robert Vertin")).toBeGreaterThanOrEqual(75);
  });
});
