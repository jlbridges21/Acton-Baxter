/**
 * PEM NEAT entity-scoped content search + routing priority regressions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { runEvidenceRegistry } from "@/lib/baxter-ai/evidence-registry";
import { pemEvidenceSource } from "@/lib/baxter-ai/evidence-registry/sources/pem";
import type { EvidenceSource } from "@/lib/baxter-ai/evidence-registry/types";
import type { SemanticQuestionClassification } from "@/lib/baxter-ai/semantic-question-classification";
import {
  formatPemContentSearchAnswer,
  retrievePemEvidence,
  searchPemNeatContent,
  splitTranscriptIntoPassages,
} from "@/lib/baxter-data/pem-neats";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";
import type { PemNeatRecord } from "@/lib/pem-neat/types";

const SALES_ID = "00000000-0000-4000-8000-000000000099";

const REPORTED_Q =
  "I want to show Jesse how I disqualified Sharon liu by saying I don't recommend an ADU 'what am i missing' and how that got her to share more pain about why she needs the adu";

const REPORTED_Q_A =
  "Look in Sharon Liu neat and find the part of the transcript where Kevin disqualified her by saying that he didn't recommend an ADU and this caused her to open up more about her pain";

const REPORTED_Q_A_PAREN =
  "Look in Sharon Liu neat and find the part of the transcript where Kevin disqualified her by saying that he didn't recommend an ADU and this caused her to open up more about her pain (reason for building an ADU).";

const REPORTED_Q_B =
  "@Baxter I want to show Jesse how I disqualified Sharon liu by saying I don't recommend an ADU 'what am i missing' and how that got her to share more pain about why she needs the adu";

const DISQUALIFY_TRANSCRIPT = `
36:50: Advisor: On payment, some families prefer cash.
36:58: Sharon: We could do a cash payment if that helps move things along faster.
37:10: Advisor: Understood — we can talk financing options later.
38:50: Sharon: We just want to know if an ADU makes sense for us right now.
39:10: Advisor: I hear you. Before we talk floor plans, can I be honest with you?
39:31: I, I, I can't sit here and recommend you do it at this moment.
39:35: But maybe I just haven't heard, Why you would?
39:42: Well, I think partly I feel like eventually we would want to do something, so I'm like why not do it now and then if we can rent it out, because we have renters now and that helps a lot, and I think we know enough people that we would rent to we wouldn't necessarily rent to strangers because it's like in our backyard so we would want to trust the people who live there and I think, so I think that's part of it.
40:10: I know it's like a huge investment at this time, but I'm like, if we just keep putting it off, but if we're eventually going to do it, trying to figure out like when, I don't know if there is a best time.
40:22: And like you said, we, we, you know, we'll have to talk to our parents about it because eventually they'll be, you know, if they want to move in with us, so.
40:35: Advisor: Thank you for sharing that. That why-now matters more than the square footage.
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

function contentSearchSemantic(name: string): SemanticQuestionClassification {
  return {
    questionType: "entity_lookup",
    entityName: name,
    entityTypeGuess: "pem_prospect",
    lookupSpecificity: "content_search",
    confidence: 0.93,
    source: "llm",
    latencyMs: 1,
    model: "test",
  };
}

async function seedSharonLiuNeat(opts?: {
  prospectName?: string;
  prospectNames?: string[];
  transcript?: string;
  emptyAssessmentExtras?: boolean;
}): Promise<PemNeatRecord> {
  const store = getPemNeatStore();
  const prospectName = opts?.prospectName ?? "Sharon Liu";
  const transcript =
    opts?.transcript ??
    `${DISQUALIFY_TRANSCRIPT}\n\n${"Advisor: We also briefly covered site access and setbacks. ".repeat(20)}`;
  const record = await store.create({
    prospectName,
    prospectNames: opts?.prospectNames,
    salespersonUserId: SALES_ID,
    salespersonDisplayName: "Alex Sales",
    meetingDate: "2026-03-12",
    transcript,
    createdBy: SALES_ID,
  });
  const mock = buildMockPemNeatResult({
    prospectName,
    advisorName: "Alex Sales",
    meetingDate: "2026-03-12",
  });
  if (!opts?.emptyAssessmentExtras) {
    const cat = mock.assessment.categories.find((c) => c.key === "type1_pain");
    if (cat) {
      cat.evidence =
        "Advisor used a temporary disqualification — saying they could not recommend an ADU yet — which unlocked deeper Type 1 pain about why the homeowner needs the ADU.";
      cat.whatWorked =
        "Saying 'I don't recommend an ADU / what am I missing' invited Sharon to share more pain about why she needs the ADU.";
      cat.coachingOpportunity =
        "Keep reporting the assessment technique with timestamps; do not editorialize about the salesperson.";
    }
    mock.assessment.oneThing =
      "When you temporarily disqualify by saying you don't recommend an ADU yet, listen for the pain that surfaces next.";
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
  const full = await store.get(record.id);
  if (!full) throw new Error("failed to seed Sharon Liu NEAT");
  return full;
}

describe("splitTranscriptIntoPassages", () => {
  it("preserves timestamp markers", () => {
    const passages = splitTranscriptIntoPassages(DISQUALIFY_TRANSCRIPT);
    expect(passages.some((p) => p.timestamp === "39:31")).toBe(true);
    expect(passages.find((p) => p.timestamp === "39:31")?.text).toMatch(/recommend you do it/i);
  });
});

describe("searchPemNeatContent", () => {
  it("returns transcript quote with timestamp for the reported coaching question", async () => {
    const full = await seedSharonLiuNeat();
    const result = searchPemNeatContent(full, REPORTED_Q, { limit: 4 });
    expect(result.passages.length).toBeGreaterThan(0);
    // Prefer the recommend line when present; otherwise any timestamped transcript hit.
    const transcriptHit =
      result.passages.find(
        (p) => p.kind === "transcript" && /recommend you do it/i.test(p.excerpt),
      ) ?? result.passages.find((p) => p.kind === "transcript");
    expect(transcriptHit?.timestamp).toMatch(/39:3[15]/);
    expect(transcriptHit?.excerpt).toMatch(/recommend you do it|haven.?t heard/i);
    // Must rank the disqualification exchange above the cash-payment distractor.
    expect(result.passages[0]?.kind).toBe("transcript");
    expect(result.passages[0]?.timestamp).toMatch(/39:3[15]/);
    expect(result.passages.some((p) => p.timestamp === "36:58")).toBe(false);

    const answer = formatPemContentSearchAnswer({
      prospectName: full.prospect_name,
      meetingDate: full.meeting_date,
      citationLabel: `${full.prospect_name} PEM NEAT (${full.meeting_date})`,
      passages: result.passages,
      question: REPORTED_Q,
    });
    expect(answer).toMatch(/Transcript quote \(39:/);
    expect(answer).toMatch(/exact wording from the NEAT transcript/i);
    expect(answer).toMatch(/Sharon Liu/);
    expect(answer).toMatch(/can'?t sit here and recommend|recommend you do it/i);
    expect(answer).not.toMatch(/Customer Story/i);
    expect(answer).not.toMatch(/Bonding/i);
    // Surface for the report.
    console.log("\n--- REPORTED QUESTION SAMPLE ANSWER ---\n" + answer + "\n---\n");
  });

  it("ranks 39:31 above 36:58 cash for both reported Slack phrasings", async () => {
    const full = await seedSharonLiuNeat({
      prospectName: "Sharon Liu & Jeff Liu",
      prospectNames: ["Sharon Liu", "Jeff Liu"],
    });
    for (const q of [REPORTED_Q_A, REPORTED_Q_B]) {
      const result = searchPemNeatContent(full, q, { limit: 4 });
      expect(result.passages[0]?.kind, q).toBe("transcript");
      expect(result.passages[0]?.timestamp, q).toMatch(/39:3[15]/);
      expect(result.passages[0]?.excerpt, q).toMatch(/recommend you do it|haven.?t heard/i);
      const answer = formatPemContentSearchAnswer({
        prospectName: full.prospect_name,
        meetingDate: full.meeting_date,
        citationLabel: `${full.prospect_name} PEM NEAT`,
        passages: result.passages,
        question: q,
      });
      expect(answer, q).toMatch(/39:3[15]/);
      expect(answer, q).not.toMatch(/cash payment/i);
    }
  });

  it("parenthetical reason-for-building does not steal Type 1 Pain field path", async () => {
    const { detectRequestedPemFields, isPemTranscriptContentAsk } =
      await import("@/lib/baxter-data/pem-neats");
    expect(isPemTranscriptContentAsk(REPORTED_Q_A_PAREN)).toBe(true);
    expect(detectRequestedPemFields(REPORTED_Q_A_PAREN)).toEqual([]);
    expect(detectRequestedPemFields("What is Sharon Liu's Type 1 Pain?")).toEqual(["type_1_pain"]);
    expect(
      detectRequestedPemFields(
        "Look in Sharon Liu neat and find the part of the transcript where they discussed budget concerns",
      ),
    ).toEqual([]);
    expect(detectRequestedPemFields("What is Sharon Liu's budget?")).toEqual(["budget"]);
  });

  it("exact reported parenthetical question returns transcript 39:31, not Type 1 Pain bullets", async () => {
    await seedSharonLiuNeat({
      prospectName: "Sharon Liu & Jeff Liu",
      prospectNames: ["Sharon Liu", "Jeff Liu"],
    });
    const ghlMiss: EvidenceSource = {
      key: "ghl",
      canHandle: () => ({ plausible: true, confidence: 0.7 }),
      resolve: async () => ({ items: [], softMiss: true, confidence: 0.1 }),
    };
    const result = await runEvidenceRegistry({
      question: REPORTED_Q_A_PAREN,
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "slack",
      ghlConfigured: true,
      semantic: {
        questionType: "entity_lookup",
        entityName: "Sharon Liu",
        entityTypeGuess: "pem_prospect",
        lookupSpecificity: "generic",
        confidence: 0.9,
        source: "llm",
        latencyMs: 1,
        model: "test",
      },
      sources: [ghlMiss, pemEvidenceSource],
    });
    expect(result.earlyAnswer?.winningSource).toBe("pem_neat");
    expect(result.earlyAnswer?.answer).toMatch(/39:31/);
    expect(result.earlyAnswer?.answer).toMatch(/can'?t sit here and recommend/i);
    expect(result.earlyAnswer?.answer).not.toMatch(/Type 1 Pain — Why Build/i);
    expect(result.earlyAnswer?.answer).not.toMatch(/'s Type 1 Pain was:/i);
    console.log("\n--- AFTER REPORTED PAREN ---\n" + result.earlyAnswer?.answer + "\n---\n");
  });

  it("honest fallback lists NEAT-specific examples when content search misses", async () => {
    await seedSharonLiuNeat({
      transcript: "10:00: Hello there. ".repeat(40),
      emptyAssessmentExtras: true,
    });
    const evidence = await retrievePemEvidence({
      question: "Tell me about Sharon Liu's PEM",
      contentSearchQuestion:
        "find the part where they discussed commercial zoning variance appeals in downtown Oakland",
      contentSeeking: true,
      role: "admin",
      channel: "web",
    });
    expect(evidence.answerMode).toBe("not_determinable");
    expect(evidence.deterministicAnswer).toMatch(
      /couldn'?t find that specific part of the transcript/i,
    );
    expect(evidence.deterministicAnswer).toMatch(/I can answer questions like/i);
    expect(evidence.deterministicAnswer).toMatch(/Type 1 Pain|budget|Customer Story|Who ran/i);
    console.log("\n--- HONEST FALLBACK ---\n" + evidence.deterministicAnswer + "\n---\n");
  });

  it("gates KB combine: Culture Guide out; technique playbook in", async () => {
    const { isKnowledgeBaseRelevantToPemContentQuestion } =
      await import("@/lib/baxter-data/pem-neats");
    expect(
      isKnowledgeBaseRelevantToPemContentQuestion(REPORTED_Q_B, {
        title: "Culture Guide",
        summary: "Our values and brand voice for Acton.",
        contentExcerpt: "Be helpful and on-brand in every customer conversation.",
        category: "Culture",
        relevanceScore: 55,
        sourceType: "knowledge",
      }),
    ).toBe(false);
    expect(
      isKnowledgeBaseRelevantToPemContentQuestion(
        "Show me how I disqualified Sharon Liu — and what does the sales playbook say about temporary disqualification?",
        {
          title: "Sales Playbook — Temporary Disqualification",
          summary: "Use temporary disqualification carefully; listen for pain.",
          contentExcerpt:
            "When you don't recommend an ADU yet, ask what you are missing so pain can surface.",
          category: "Sales",
          relevanceScore: 70,
          sourceType: "knowledge",
        },
      ),
    ).toBe(true);
  });

  it("finds budget / timeline / pricing-objection shapes", async () => {
    const full = await seedSharonLiuNeat({
      transcript: `
10:00: Advisor: Let's talk about budget and pricing.
10:12: Sharon: Our budget is tight around one fifty.
10:20: Advisor: I hear the pricing objection — let's separate competitor quotes from Acton.
11:05: Advisor: On timeline, when do you need this ready?
11:12: Sharon: We discussed the timeline for spring move-in.
`.trim(),
    });

    for (const q of [
      "what did the advisor say about budget",
      "find where they discussed the timeline",
      "how did the advisor handle the pricing objection",
    ]) {
      const result = searchPemNeatContent(full, q, { limit: 3, minScore: 6 });
      expect(result.passages.length, q).toBeGreaterThan(0);
    }
  });

  it("bounds excerpt total on a long 20k+ word transcript", async () => {
    const filler = "Advisor discussed site access, setbacks, and utilities in detail. ".repeat(
      2_500,
    );
    const long = `${DISQUALIFY_TRANSCRIPT}\n\n${filler}`;
    expect(long.split(/\s+/).length).toBeGreaterThan(20_000);
    const full = await seedSharonLiuNeat({ transcript: long });
    const result = searchPemNeatContent(full, REPORTED_Q, { limit: 4 });
    expect(result.passages.length).toBeLessThanOrEqual(4);
    expect(result.totalExcerptChars).toBeLessThanOrEqual(3_600);
    expect(result.passages.every((p) => p.excerpt.length <= 700)).toBe(true);
  });
});

describe("retrievePemEvidence content search", () => {
  it("answers the reported question from transcript + assessment when contentSeeking", async () => {
    await seedSharonLiuNeat();
    const evidence = await retrievePemEvidence({
      question: "Tell me about Sharon Liu's PEM",
      contentSearchQuestion: REPORTED_Q,
      contentSeeking: true,
      role: "admin",
      channel: "web",
    });
    expect(evidence.answerMode).toBe("deterministic_structured");
    expect(evidence.deterministicAnswer).toMatch(/39:31|39:35/);
    expect(evidence.deterministicAnswer).toMatch(/recommend you do it/i);
    expect(evidence.deterministicAnswer).toMatch(/Source:/);
    expect(evidence.items[0]?.tags).toContain("content_search");
  });

  it("field lookups still resolve deterministically without content search", async () => {
    await seedSharonLiuNeat();
    const evidence = await retrievePemEvidence({
      question: "What is Sharon Liu's Type 1 Pain?",
      role: "admin",
      channel: "web",
    });
    expect(evidence.answerMode).toBe("deterministic_structured");
    expect(evidence.deterministicAnswer).toMatch(/Type 1 Pain|pain|parent|aging/i);
    expect(evidence.items[0]?.tags ?? []).not.toContain("content_search");
  });

  it("record lookups stay on summary path (not content search)", async () => {
    await seedSharonLiuNeat();
    const evidence = await retrievePemEvidence({
      question: "Show me Sharon Liu's PEM NEAT",
      role: "admin",
      channel: "web",
    });
    expect(evidence.deterministicAnswer).toBeTruthy();
    expect(evidence.items[0]?.tags ?? []).not.toContain("content_search");
  });

  it("content search works via secondary prospect name", async () => {
    await seedSharonLiuNeat({
      prospectName: "Sharon Liu & Jesse Partner",
      prospectNames: ["Sharon Liu", "Jesse Partner"],
    });
    const evidence = await retrievePemEvidence({
      question: "Tell me about Sharon Liu's PEM",
      contentSearchQuestion: "what did the advisor say about recommending an ADU to Sharon Liu",
      contentSeeking: true,
      role: "admin",
      channel: "web",
    });
    expect(evidence.deterministicAnswer).toMatch(/recommend/i);
  });

  it("contentSeeking with nothing relevant returns searched-empty note", async () => {
    await seedSharonLiuNeat({
      transcript: "10:00: Advisor: Hello.\n10:05: Sharon: Hi.\n".repeat(30),
      emptyAssessmentExtras: true,
    });
    const evidence = await retrievePemEvidence({
      question: "Tell me about Sharon Liu's PEM",
      contentSearchQuestion:
        "find the part where they discussed commercial zoning variance appeals in downtown Oakland",
      contentSeeking: true,
      role: "admin",
      channel: "web",
    });
    expect(evidence.answerMode).toBe("not_determinable");
    expect(evidence.diagnostics.pemSkipReason).toBe("pem_content_no_match");
    expect(evidence.deterministicAnswer).toMatch(
      /couldn'?t find that specific part of the transcript/i,
    );
    expect(evidence.deterministicAnswer).toMatch(/I can answer questions like/i);
  });
});

describe("registry routing priority for PEM content search", () => {
  it("PEM content hit short-circuits via confidence arbitration (not a hardcoded Slack skip)", async () => {
    await seedSharonLiuNeat();

    const ghlMiss: EvidenceSource = {
      key: "ghl",
      canHandle: () => ({ plausible: true, confidence: 0.8 }),
      resolve: async () => ({
        items: [],
        deterministicAnswer: "I couldn’t find a GHL contact matching Sharon Liu.",
        confidence: 0.1,
        softMiss: true,
      }),
    };

    const result = await runEvidenceRegistry({
      question: REPORTED_Q,
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semantic: contentSearchSemantic("Sharon Liu"),
      sources: [ghlMiss, pemEvidenceSource],
    });

    expect(result.earlyAnswer?.winningSource).toBe("pem_neat");
    expect(result.earlyAnswer?.answer).toMatch(/39:31|39:35|recommend you do it/i);
    expect(result.diagnostics.tried.some((t) => t.key === "pem_neat")).toBe(true);
    // Confidence arbitration: PEM was ranked/handled, not a special Slack bypass flag.
    const pemTried = result.diagnostics.tried.find((t) => t.key === "pem_neat");
    expect(pemTried?.outcome).toBe("deterministic");
    expect(pemTried?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("both reported Slack phrasings resolve the same NEAT and lead with 39:31", async () => {
    await seedSharonLiuNeat({
      prospectName: "Sharon Liu & Jeff Liu",
      prospectNames: ["Sharon Liu", "Jeff Liu"],
    });
    const ghlMiss: EvidenceSource = {
      key: "ghl",
      canHandle: () => ({ plausible: true, confidence: 0.7 }),
      resolve: async () => ({ items: [], softMiss: true, confidence: 0.1 }),
    };

    for (const [label, q, semantic] of [
      [
        "A",
        REPORTED_Q_A,
        {
          questionType: "entity_lookup" as const,
          entityName: "Sharon Liu",
          entityTypeGuess: "pem_prospect" as const,
          lookupSpecificity: "generic" as const,
          confidence: 0.9,
          source: "llm" as const,
          latencyMs: 1,
          model: "test",
        },
      ],
      [
        "B",
        REPORTED_Q_B,
        {
          questionType: "entity_lookup" as const,
          entityName: "Sharon Liu",
          entityTypeGuess: "pem_prospect" as const,
          lookupSpecificity: "generic" as const,
          confidence: 0.9,
          source: "llm" as const,
          latencyMs: 1,
          model: "test",
        },
      ],
      ["A-null-sem", REPORTED_Q_A, null],
    ] as const) {
      const result = await runEvidenceRegistry({
        question: q,
        history: [],
        conversationMetadata: {},
        role: "admin",
        channel: "slack",
        ghlConfigured: true,
        semantic: semantic ?? undefined,
        semanticOptions: semantic ? undefined : { skipSemantic: true },
        sources: [ghlMiss, pemEvidenceSource],
      });
      expect(result.earlyAnswer?.winningSource, label).toBe("pem_neat");
      expect(result.earlyAnswer?.answer, label).toMatch(/39:3[15]/);
      expect(result.earlyAnswer?.answer, label).toMatch(/recommend you do it|haven.?t heard/i);
      expect(result.earlyAnswer?.answer, label).not.toMatch(/pem-recordings|cash payment/i);
      expect(result.earlyAnswer?.answer, label).not.toMatch(/Customer Story|Bonding/i);
      console.log(`\n--- AFTER ${label} ---\n${result.earlyAnswer?.answer}\n---\n`);
    }
  });

  it("canHandle boosts content_search + pem_prospect above typical Slack-fallback band", async () => {
    const { resolveQuestionEntity } = await import("@/lib/baxter-ai/evidence-registry");
    const semantic = contentSearchSemantic("Sharon Liu");
    const entity = resolveQuestionEntity({ question: REPORTED_Q, semantic });
    const handle = pemEvidenceSource.canHandle({
      question: REPORTED_Q,
      history: [],
      entity,
      preferredSource: null,
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
    });
    expect(handle.plausible).toBe(true);
    expect(handle.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("empty PEM content soft-misses with note (KB can still answer)", async () => {
    await seedSharonLiuNeat({
      transcript: "10:00: Hello there. ".repeat(40),
      emptyAssessmentExtras: true,
    });

    const result = await runEvidenceRegistry({
      question: "how did Sharon Liu discuss commercial zoning variance appeals?",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: false,
      semantic: contentSearchSemantic("Sharon Liu"),
      sources: [pemEvidenceSource],
    });

    expect(result.earlyAnswer).toBeNull();
    expect(result.softMissNotes?.join(" ")).toMatch(
      /couldn'?t find that specific part of the transcript/i,
    );
    expect(
      result.diagnostics.tried.some((t) => t.key === "pem_neat" && t.outcome === "soft_miss"),
    ).toBe(true);
  });
});
