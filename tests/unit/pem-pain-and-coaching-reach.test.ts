/**
 * Unqualified PEM field vocabulary + coaching reachability regressions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { runEvidenceRegistry } from "@/lib/baxter-ai/evidence-registry";
import { pemEvidenceSource } from "@/lib/baxter-ai/evidence-registry/sources/pem";
import type { EvidenceSource } from "@/lib/baxter-ai/evidence-registry/types";
import type { SemanticQuestionClassification } from "@/lib/baxter-ai/semantic-question-classification";
import {
  detectPemIntent,
  detectRequestedPemFields,
  parsePemEntityQuery,
  retrievePemEvidence,
} from "@/lib/baxter-data/pem-neats";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";

const SALES_ID = "00000000-0000-4000-8000-000000000099";

const REPORTED_COACHING_Q =
  "I want to show Jesse how I disqualified Sharon liu by saying I don't recommend an ADU 'what am i missing' and how that got her to share more pain about why she needs the adu";

const DISQUALIFY_TRANSCRIPT = `
38:50: Sharon: We just want to know if an ADU makes sense for us right now.
39:10: Advisor: I hear you. Before we talk floor plans, can I be honest with you?
39:31: I, I, I can't sit here and recommend you do it at this moment.
39:35: But maybe I just haven't heard, Why you would?
39:48: Sharon: Well… my mom is alone and I keep worrying about her at night. That's the pain I haven't said out loud.
40:05: Advisor: Thank you for sharing that. That why-now matters more than the square footage.
`.trim();

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.BAXTER_CHAT_ENABLED = "true";
  resetEnvCacheForTests();
  resetPemNeatMemoryStoreForTests();
  vi.restoreAllMocks();
});

async function seedSharon() {
  const store = getPemNeatStore();
  const record = await store.create({
    prospectName: "Sharon Liu",
    salespersonUserId: SALES_ID,
    salespersonDisplayName: "Alex Sales",
    meetingDate: "2026-03-12",
    transcript: `${DISQUALIFY_TRANSCRIPT}\n\n${"Advisor covered setbacks. ".repeat(30)}`,
    createdBy: SALES_ID,
  });
  const mock = buildMockPemNeatResult({
    prospectName: "Sharon Liu",
    advisorName: "Alex Sales",
    meetingDate: "2026-03-12",
  });
  mock.salesIntelligence.type1Pain = [
    {
      statement: "Mom lives alone and nights are scary.",
      surfaceReason: null,
      deeperConsequence: null,
      whyNow: null,
      evidence: "Mom lives alone and nights are scary.",
      evidenceType: "prospect_fact",
      confidence: "high",
    },
  ];
  mock.salesIntelligence.type2Pain = [
    {
      statement: "Prior contractor communication was unreliable.",
      surfaceReason: null,
      deeperConsequence: null,
      whyNow: null,
      evidence: "Prior contractor communication was unreliable.",
      evidenceType: "prospect_fact",
      confidence: "medium",
    },
  ];
  const cat = mock.assessment.categories.find((c) => c.key === "type1_pain");
  if (cat) {
    cat.whatWorked =
      "Saying 'I don't recommend an ADU / what am I missing' invited Sharon to share more pain.";
  }
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
}

describe("unqualified pain field vocabulary", () => {
  it("maps bare pain / pain points / motivation to BOTH Type 1 and Type 2", () => {
    expect(detectRequestedPemFields("what's sharon liu's pain")).toEqual([
      "type_1_pain",
      "type_2_pain",
    ]);
    expect(detectRequestedPemFields("what are their pain points")).toEqual([
      "type_1_pain",
      "type_2_pain",
    ]);
    expect(detectRequestedPemFields("what's driving this")).toEqual(["type_1_pain", "type_2_pain"]);
    expect(detectRequestedPemFields("what's her motivation")).toEqual([
      "type_1_pain",
      "type_2_pain",
    ]);
  });

  it("keeps explicit type 1 / type 2 as single-field asks", () => {
    expect(detectRequestedPemFields("her type 1 pain")).toEqual(["type_1_pain"]);
    expect(detectRequestedPemFields("What is his Type 2 pain?")).toEqual(["type_2_pain"]);
  });

  it("extracts Sharon Liu from what's-contraction possessives", () => {
    expect(parsePemEntityQuery("what's sharon liu's pain").nameQuery).toBe("Sharon Liu");
    expect(parsePemEntityQuery("What's Sharon Liu's pain").nameQuery).toBe("Sharon Liu");
    expect(detectPemIntent("what's sharon liu's pain").intent).toBe("record_lookup");
  });

  it("adds natural aliases for budget / decision / timeline / outcome", () => {
    expect(detectRequestedPemFields("what's the pricing")).toEqual(["budget"]);
    expect(detectRequestedPemFields("who is the decision maker")).toEqual(["decision_process"]);
    expect(detectRequestedPemFields("what's their timeline")).toEqual(["schedule"]);
    expect(detectRequestedPemFields("did they buy")).toEqual(["outcome"]);
    expect(detectRequestedPemFields("what's next")).toEqual(["next_steps"]);
  });

  it("answers unqualified pain with both types labeled from the NEAT", async () => {
    await seedSharon();
    const evidence = await retrievePemEvidence({
      question: "what's sharon liu's pain",
      role: "admin",
      channel: "web",
    });
    expect(evidence.answerMode).toBe("deterministic_structured");
    expect(evidence.deterministicAnswer).toMatch(/Type 1 Pain/i);
    expect(evidence.deterministicAnswer).toMatch(/Type 2 Pain/i);
    expect(evidence.deterministicAnswer).toMatch(/Mom lives alone|nights are scary/i);
    expect(evidence.deterministicAnswer).toMatch(/contractor|communication/i);
    expect(evidence.deterministicAnswer).toMatch(/Source:/);
    expect(evidence.deterministicAnswer).not.toMatch(/If you mean her Type/i);
  });
});

describe("coaching content search reachability (present-but-not-reached fix)", () => {
  it("runs content search when semantic names a PEM prospect without content_search specificity", async () => {
    await seedSharon();

    // Production often classifies this as entity_lookup + pem_prospect + generic/null,
    // not content_search — previously PEM resolve returned null.
    const semantic: SemanticQuestionClassification = {
      questionType: "entity_lookup",
      entityName: "Sharon Liu",
      entityTypeGuess: "pem_prospect",
      lookupSpecificity: "generic",
      confidence: 0.9,
      source: "llm",
      latencyMs: 1,
      model: "test",
    };

    const ghlMiss: EvidenceSource = {
      key: "ghl",
      canHandle: () => ({ plausible: true, confidence: 0.75 }),
      resolve: async () => ({
        items: [],
        softMiss: true,
        confidence: 0.1,
      }),
    };

    const result = await runEvidenceRegistry({
      question: REPORTED_COACHING_Q,
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semantic,
      sources: [ghlMiss, pemEvidenceSource],
    });

    expect(result.earlyAnswer?.winningSource).toBe("pem_neat");
    expect(result.earlyAnswer?.answer).toMatch(/39:31|recommend you do it/i);
    expect(result.earlyAnswer?.answer).toMatch(/Source:/);
    expect(result.earlyAnswer?.answer).not.toMatch(/Frame it as a consultative/i);
  });

  it("canHandle claims PEM for semantic pem_prospect even without content_search", async () => {
    const { resolveQuestionEntity } = await import("@/lib/baxter-ai/evidence-registry");
    const semantic: SemanticQuestionClassification = {
      questionType: "entity_lookup",
      entityName: "Sharon Liu",
      entityTypeGuess: "pem_prospect",
      lookupSpecificity: null,
      confidence: 0.88,
      source: "llm",
      latencyMs: 1,
      model: "test",
    };
    const entity = resolveQuestionEntity({ question: REPORTED_COACHING_Q, semantic });
    const handle = pemEvidenceSource.canHandle({
      question: REPORTED_COACHING_Q,
      history: [],
      entity,
      preferredSource: null,
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
    });
    expect(handle.plausible).toBe(true);
    expect(handle.confidence).toBeGreaterThanOrEqual(0.88);
  });
});
