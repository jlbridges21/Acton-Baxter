import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  detectPemIntent,
  extractNameQuery,
  pemHelpDefinitionAnswer,
} from "@/lib/baxter-data/pem-neats/intent";
import {
  canAccessPemEvidence,
  formatFocusedExcerpt,
  retrievePemEvidence,
  scoreNameMatch,
} from "@/lib/baxter-data/pem-neats/evidence";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";
import { parsePemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import {
  buildBaxterCapabilityCatalog,
  findCapabilityByTopic,
  listCapabilitiesForRole,
} from "@/lib/baxter/capability-registry";
import { BAXTER_TOOLS } from "@/lib/baxter/tools";
import { contextItemToSourceReference, isSafeHttpUrl } from "@/lib/baxter-ai/citations";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { resetBaxterConversationMemoryForTests } from "@/lib/baxter-ai/conversations";
import { resetKnowledgeMemoryForTests } from "@/lib/knowledge/store";
import { sanitizeSourceUrl, formatSlackSourceLine } from "@/lib/slack/format";

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
  resetEnvCacheForTests();
  resetPemNeatMemoryStoreForTests();
  resetBaxterConversationMemoryForTests();
  resetKnowledgeMemoryForTests();
});

async function seedCompletedPem(input: {
  prospectName: string;
  meetingDate: string;
  advisorName?: string;
  type1?: string;
  budget?: string;
}) {
  const store = getPemNeatStore();
  const created = await store.create({
    prospectName: input.prospectName,
    salespersonUserId: SALES_ID,
    salespersonDisplayName: input.advisorName ?? "Jesse",
    meetingDate: input.meetingDate,
    transcript: "Advisor: Purpose today is fit. Prospect: We need an ADU. ".repeat(40),
    createdBy: SALES_ID,
  });
  const mock = buildMockPemNeatResult({
    prospectName: input.prospectName,
    advisorName: input.advisorName ?? "Jesse",
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
    mock.salesIntelligence.budget.summary = `Working budget about ${input.budget}.`;
    mock.salesIntelligence.budget.statedBudget = {
      value: input.budget,
      evidenceType: "prospect_fact",
      confidence: "high",
    };
  }
  mock.buildertrendFields.notesForInternalUsers = `Handoff notes for ${input.prospectName}`;
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

describe("PEM intent detection", () => {
  it("treats definitions as help, not record lookup", () => {
    expect(detectPemIntent("What is a PEM?").intent).toBe("help_definition");
    expect(detectPemIntent("What is a PEM NEAT?").intent).toBe("help_definition");
    expect(detectPemIntent("How do I generate a PEM NEAT?").intent).toBe("help_definition");
  });

  it("detects record lookup for Type 1 / budget with names", () => {
    const r = detectPemIntent("Tell me about Robert Vertin's Type 1 pain.");
    expect(r.intent).toBe("record_lookup");
    expect(r.fields).toContain("type1_pain");
    expect(r.nameQuery).toBe("Robert Vertin");
  });

  it("does not treat BuilderTrend capability questions as PEM lookup", () => {
    expect(detectPemIntent("Can you update BuilderTrend?").intent).toBe("none");
  });

  it("extracts surnames from the Vertin meeting", () => {
    expect(extractNameQuery("Tell me about the Vertin meeting.")).toBe("Vertin");
  });
});

describe("PEM help definitions", () => {
  it("defines PEM and NEAT from Acton terminology", () => {
    expect(pemHelpDefinitionAnswer("What is a PEM?")).toMatch(/Partnership Evaluation Meeting/i);
    expect(pemHelpDefinitionAnswer("What is a PEM NEAT?")).toMatch(/N\*\*otes|Notes/i);
    expect(pemHelpDefinitionAnswer("What is a PEM NEAT?")).toMatch(/E\*\*mail|Email/i);
    expect(pemHelpDefinitionAnswer("How do I generate a PEM NEAT?")).toMatch(/pem-neats\/new/);
  });
});

describe("PEM entity resolution and evidence", () => {
  it("scores name matches without requiring exact casing", () => {
    expect(scoreNameMatch("Robert Vertin", "robert vertin")).toBeGreaterThanOrEqual(100);
    expect(scoreNameMatch("Robert Vertin", "Vertin")).toBeGreaterThanOrEqual(60);
  });

  it("retrieves Type 1 only for field-aware questions", async () => {
    await seedCompletedPem({
      prospectName: "Alex Morgan",
      meetingDate: "2026-07-15",
      type1: "Independent housing for an adult child near family.",
      budget: "425000",
    });
    const result = await retrievePemEvidence({
      question: "Tell me Alex Morgan's Type 1 pain.",
      role: "user",
      channel: "web",
    });
    expect(result.clarification).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.contentExcerpt).toMatch(/Independent housing for an adult child/i);
    expect(result.items[0]!.contentExcerpt).not.toMatch(/BuilderTrend custom fields/i);
    expect(result.items[0]!.sourceType).toBe("pem_neat");
    expect(result.items[0]!.sourceUrl).toMatch(/\/pem-neats\//);
  });

  it("retrieves budget for budget questions", async () => {
    await seedCompletedPem({
      prospectName: "Alex Morgan",
      meetingDate: "2026-07-15",
      budget: "425000",
    });
    const result = await retrievePemEvidence({
      question: "What was Alex Morgan's budget?",
      role: "user",
    });
    expect(result.items[0]!.contentExcerpt).toMatch(/425000|425,000|Working budget/i);
  });

  it("clarifies ambiguous first names", async () => {
    await seedCompletedPem({ prospectName: "Alex Morgan", meetingDate: "2026-07-01" });
    await seedCompletedPem({ prospectName: "Alex Martinez", meetingDate: "2026-07-10" });
    const result = await retrievePemEvidence({
      question: "Tell me about Alex.",
      role: "user",
    });
    expect(result.items).toHaveLength(0);
    expect(result.clarification).toMatch(/Alex Morgan/i);
    expect(result.clarification).toMatch(/Alex Martinez/i);
  });

  it("prefers latest PEM for the same prospect", async () => {
    await seedCompletedPem({
      prospectName: "Alex Morgan",
      meetingDate: "2026-06-01",
      type1: "First meeting pain about parking.",
    });
    await seedCompletedPem({
      prospectName: "Alex Morgan",
      meetingDate: "2026-07-15",
      type1: "Second meeting pain about independence.",
    });
    const result = await retrievePemEvidence({
      question: "Tell me about Alex Morgan's Type 1 pain.",
      role: "user",
    });
    expect(result.items[0]!.contentExcerpt).toMatch(/independence/i);
    expect(result.staleWarning ?? result.items[0]!.contentExcerpt).toMatch(/most recent|Jul/i);
  });

  it("inherits prospect from conversation history", async () => {
    await seedCompletedPem({
      prospectName: "Alex Morgan",
      meetingDate: "2026-07-15",
      budget: "410000",
    });
    const result = await retrievePemEvidence({
      question: "What was his budget?",
      history: [
        { role: "user", content: "Tell me about Alex Morgan's PEM." },
        { role: "assistant", content: "Alex Morgan — PEM NEAT — Jul 15, 2026 summary..." },
      ],
      role: "user",
    });
    expect(result.items[0]!.contentExcerpt).toMatch(/410000|Working budget/i);
  });

  it("excludes deleted PEMs", async () => {
    const id = await seedCompletedPem({
      prospectName: "Alex Morgan",
      meetingDate: "2026-07-15",
    });
    await getPemNeatStore().softDelete(id, SALES_ID);
    const result = await retrievePemEvidence({
      question: "What was Alex Morgan's Type 1 pain?",
      role: "user",
    });
    expect(result.items).toHaveLength(0);
    expect(result.clarification).toMatch(/couldn't find/i);
  });

  it("warns on stale / needs regeneration", async () => {
    const id = await seedCompletedPem({
      prospectName: "Alex Morgan",
      meetingDate: "2026-07-15",
      type1: "Stale type 1 about independence.",
    });
    const store = getPemNeatStore();
    const existing = await store.get(id);
    await store.updateSource(id, {
      prospectName: existing!.prospect_name,
      salespersonUserId: existing!.salesperson_user_id ?? SALES_ID,
      salespersonDisplayName: existing!.salesperson_display_name,
      meetingDate: existing!.meeting_date,
      transcript: `${existing!.transcript}\nExtra line after edit.`,
      updatedBy: SALES_ID,
    });
    const result = await retrievePemEvidence({
      question: "What was Alex Morgan's Type 1 pain?",
      role: "user",
    });
    expect(result.items[0]?.contentExcerpt ?? result.clarification ?? "").toMatch(/stale/i);
  });

  it("denies new_user PEM access", async () => {
    await seedCompletedPem({ prospectName: "Alex Morgan", meetingDate: "2026-07-15" });
    expect(canAccessPemEvidence("new_user")).toBe(false);
    const result = await retrievePemEvidence({
      question: "What was Alex Morgan's Type 1 pain?",
      role: "new_user",
      channel: "web",
    });
    expect(result.items).toHaveLength(0);
  });

  it("allows Slack without profile role", () => {
    expect(canAccessPemEvidence(null, { channel: "slack" })).toBe(true);
  });

  it("formats assessment vs type1 without dumping BuilderTrend by default", () => {
    const mock = parsePemNeatStructuredResult(
      buildMockPemNeatResult({ prospectName: "Alex", advisorName: "Jesse" }),
    );
    const record = {
      prospect_name: "Alex",
      salesperson_display_name: "Jesse",
      meeting_date: "2026-07-15",
      analysis_stale: false,
      status: "completed",
      buildertrend_fields: mock.buildertrendFields,
    } as Parameters<typeof formatFocusedExcerpt>[0];
    const type1 = formatFocusedExcerpt(record, mock, ["type1_pain"]);
    expect(type1).toMatch(/Type 1 Pain/i);
    expect(type1).not.toMatch(/Sales assessment/i);
    const assessment = formatFocusedExcerpt(record, mock, ["assessment"]);
    expect(assessment).toMatch(/Sales assessment/i);
  });
});

describe("PEM citations", () => {
  it("maps pem_neat sources to Open NEAT links", () => {
    const ref = contextItemToSourceReference({
      number: 1,
      id: "pem-1",
      title: "Alex Morgan — PEM NEAT — Jul 15, 2026",
      summary: null,
      contentExcerpt: "Type 1...",
      category: "PEM NEAT",
      tags: ["pem_neat"],
      sourceName: "Partnership Evaluation Meeting NEAT",
      sourceUrl: "https://acton-baxter.vercel.app/pem-neats/pem-1",
      sourceType: "pem_neat",
      mimeType: null,
      updatedAt: "2026-07-15T00:00:00.000Z",
      citationLabel: "Alex Morgan — PEM NEAT — Jul 15, 2026",
      relevanceScore: 95,
    });
    expect(ref.sourceKind).toBe("pem_neat");
    expect(ref.openLabel).toBe("Open NEAT");
    expect(isSafeHttpUrl("/pem-neats/pem-1")).toBe(true);
    const slackUrl = sanitizeSourceUrl("/pem-neats/pem-1");
    expect(slackUrl).toBe("https://acton-baxter.vercel.app/pem-neats/pem-1");
    expect(formatSlackSourceLine(ref)).toMatch(/PEM NEAT/);
  });
});

describe("Capability registry", () => {
  it("includes PEM and Property Research routes from BAXTER_TOOLS", () => {
    const catalog = buildBaxterCapabilityCatalog({
      googleConfigured: false,
      ghlConfigured: false,
      ghlEnabled: false,
      rulebookKnown: false,
      monitoringKnown: false,
      monitoringUiEnabled: false,
    });
    const pem = catalog.find((c) => c.key === "pem_neat");
    const property = catalog.find((c) => c.key === "property_research");
    expect(pem?.webRoute).toBe(BAXTER_TOOLS.find((t) => t.key === "pem-neat")?.href);
    expect(pem?.createRoute).toBe("/pem-neats/new");
    expect(property?.webRoute).toBe("/dashboard");
    expect(property?.createRoute).toBe("/reports/new");
    expect(pem?.limitations.some((l) => /BuilderTrend/i.test(l))).toBe(true);
  });

  it("hides admin-only capabilities from standard users", () => {
    const userCaps = listCapabilitiesForRole("user", {
      googleConfigured: true,
      ghlConfigured: true,
      ghlEnabled: true,
      rulebookKnown: true,
      monitoringKnown: false,
      monitoringUiEnabled: false,
    });
    expect(userCaps.some((c) => c.key === "users_admin")).toBe(false);
    expect(userCaps.some((c) => c.key === "pem_neat")).toBe(true);
  });

  it("resolves knowledge / integrations topics", () => {
    expect(findCapabilityByTopic("Where do I add knowledge?", "admin")?.key).toBe(
      "knowledge_center",
    );
    expect(findCapabilityByTopic("How do I connect Google Drive?", "admin")?.key).toBe(
      "integrations_admin",
    );
  });
});

describe("answerBaxterQuestion PEM + capability parity", () => {
  it("answers PEM Type 1 from structured evidence without OpenAI", async () => {
    const id = await seedCompletedPem({
      prospectName: "Alex Morgan",
      meetingDate: "2026-07-15",
      type1: "Independent housing for an adult child near family.",
    });
    const answered = await answerBaxterQuestion({
      question: "What is Alex Morgan's Type 1 pain?",
      userId: null,
      userName: "Jesse",
      channel: "slack",
      externalUserId: "U_TEST",
    });
    expect(answered.answer).toMatch(/Independent housing for an adult child/i);
    expect(answered.sources.some((s) => s.sourceKind === "pem_neat")).toBe(true);
    expect(answered.sources[0]?.sourceUrl).toContain(`/pem-neats/${id}`);
  });

  it("inherits PEM entity across turns until clear", async () => {
    await seedCompletedPem({
      prospectName: "Alex Morgan",
      meetingDate: "2026-07-15",
      budget: "399000",
    });
    const first = await answerBaxterQuestion({
      question: "Tell me about Alex Morgan's PEM.",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    const second = await answerBaxterQuestion({
      question: "What was his budget?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: first.conversationId,
    });
    expect(second.answer).toMatch(/399000|Working budget/i);

    await answerBaxterQuestion({
      question: "/clear",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
      conversationId: second.conversationId,
    });
    const afterClear = await answerBaxterQuestion({
      question: "What was his Type 1 pain?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    expect(afterClear.answerMode).toBe("clarification");
  });

  it("answers capability questions without inventing BuilderTrend API", async () => {
    const answered = await answerBaxterQuestion({
      question: "What can you do?",
      userId: SALES_ID,
      channel: "web",
    });
    expect(answered.answerMode).toBe("identity");
    expect(answered.answer).toMatch(/PEM NEAT/i);
    expect(answered.answer.toLowerCase()).toMatch(
      /don't have a direct buildertrend|no direct buildertrend/i,
    );

    const bt = await answerBaxterQuestion({
      question: "Can you update BuilderTrend?",
      userId: null,
      channel: "slack",
      externalUserId: "U_TEST",
    });
    expect(bt.answer).toMatch(/not directly connected to BuilderTrend/i);
    expect(bt.answer).toMatch(/copy\/paste/i);

    const how = await answerBaxterQuestion({
      question: "How do I generate a PEM NEAT?",
      userId: SALES_ID,
      channel: "web",
    });
    expect(how.answer).toMatch(/Add PEM NEAT|Generate/i);
    expect(how.sources.some((s) => s.sourceUrl === "/pem-neats/new")).toBe(true);
  });
});
