/**
 * Part A: structured-field floor + synthesis + KB gate.
 * Part B: possessive "his project channel" must not become #s-project.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  STRUCTURED_FIELD_RELEVANCE_FLOOR,
  expandQuestionWithTopicSynonyms,
  formatPemContentSearchAnswer,
  isKnowledgeBaseRelevantToPemContentQuestion,
  passageMatchesTopicAnchors,
  pickRelevantSentencesFromField,
  retrievePemEvidence,
  scorePassageAgainstQuery,
  scoreStructuredFieldCandidates,
  selectPemLadderCandidates,
} from "@/lib/baxter-data/pem-neats";
import {
  extractChannelMentions,
  isRelationalOrMangledChannelSlug,
  isRelationalProjectChannelAsk,
} from "@/lib/baxter-data/slack/intent";
import { extractProjectNameQueries } from "@/lib/baxter-data/slack/project-status";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";

const SALES_ID = "00000000-0000-4000-8000-000000000099";

const Q_KID = "In the Denis Kornilov NEAT, find where he talks about his kid's living situation.";

const CUSTOMER_STORY = `Denis and Cindy live in a 4-bed home in Lafayette. His oldest child, who is currently in community college and whose temporary apartment arrangement may need to continue until the ADU is complete, is a key driver for the project. They also mentioned Living Large as a friend referral.`;

const KID_TRANSCRIPT = `
12:00: Advisor: Tell me more about why now.
12:20: Denis: Our son is in community college and his apartment situation is temporary — we may need that to continue until the ADU is done.
12:40: Advisor: Got it — the ADU is really about giving him a stable place.
`.trim();

async function seedDenis(opts?: { withTranscript?: boolean }) {
  const store = getPemNeatStore();
  const record = await store.create({
    prospectName: "Denis Kornilov",
    salespersonUserId: SALES_ID,
    salespersonDisplayName: "Kevin Lee",
    meetingDate: "2026-03-15",
    transcript: opts?.withTranscript
      ? `${KID_TRANSCRIPT}\n\n${"Advisor covered site access and utilities. ".repeat(20)}`
      : `01:00: Hello.\n01:05: Hi there.\n${"Advisor covered site access and utilities. ".repeat(30)}`,
    createdBy: SALES_ID,
  });
  const mock = buildMockPemNeatResult({
    prospectName: "Denis Kornilov",
    advisorName: "Kevin Lee",
    meetingDate: "2026-03-15",
  });
  mock.salesIntelligence.customerStory = CUSTOMER_STORY;
  mock.salesIntelligence.decisionProcess = {
    ...mock.salesIntelligence.decisionProcess,
    summary:
      "They compared Living Large and Acton. Decision process is still open while they wait on HOA feedback.",
    process: "Compare Living Large vs Acton, then decide.",
    alternatives: ["Living Large"],
  } as never;
  mock.salesIntelligence.competitionAlternatives = [
    "Living Large was mentioned as a friend who built previously.",
  ] as never;

  await store.saveGenerationSuccess(record.id, {
    structuredResult: mock,
    buildertrendFields: mock.buildertrendFields,
    analysisMetadata: mock.analysisMetadata,
    meetingOutcome: mock.salesIntelligence.meetingOutcome.classification,
    qualification: mock.salesIntelligence.qualification.classification,
    modelProvider: "mock",
    modelName: "mock",
    latencyMs: 1,
    neatStandardVersion: "1.0.0",
    transcriptHash: record.transcript_hash,
  });
  return (await store.get(record.id))!;
}

describe("structured field floor + synthesis (Denis kid living situation)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    resetEnvCacheForTests();
    resetPemNeatMemoryStoreForTests();
  });

  it("calibrates field scores: Customer Story clears floor; Living Large FPs do not", async () => {
    const record = await seedDenis();
    const hits = scoreStructuredFieldCandidates(record, Q_KID);
    const byId = Object.fromEntries(hits.map((h) => [h.sectionId, h.score]));

    console.log(
      `\nFIELD CALIBRATION floor=${STRUCTURED_FIELD_RELEVANCE_FLOOR} scores=${JSON.stringify(byId)}\n`,
    );

    expect(byId["field.customer_story"]).toBeGreaterThanOrEqual(STRUCTURED_FIELD_RELEVANCE_FLOOR);
    expect(byId["field.decision_process"]).toBeUndefined();
    expect(byId["field.competition"]).toBeUndefined();
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits[0]?.sectionId).toBe("field.customer_story");
  });

  it("returns a synthesized 1–3 sentence answer, not a multi-field dump", async () => {
    await seedDenis();
    const evidence = await retrievePemEvidence({
      question: "Tell me about Denis Kornilov's PEM",
      contentSearchQuestion: Q_KID,
      contentSeeking: true,
      role: "admin",
      channel: "web",
    });
    const answer = evidence.deterministicAnswer ?? "";
    console.log("\n--- Q1 SYNTHESIZED ---\n" + answer + "\n---\n");

    expect(answer).toMatch(/community college|apartment/i);
    expect(answer).toMatch(/Customer Story|PEM NEAT/i);
    expect(answer).not.toMatch(/Decision Process/i);
    expect(answer).not.toMatch(/Competition\/Alternatives|Competition \/ Alternatives/i);
    expect(answer.split(/\s+/).length).toBeLessThan(120);
  });

  it("synthesizes other buried-field questions", async () => {
    const store = getPemNeatStore();
    const record = await store.create({
      prospectName: "Robert Vertin",
      salespersonUserId: SALES_ID,
      salespersonDisplayName: "Kevin Lee",
      meetingDate: "2026-02-01",
      transcript: `01:00: Hello.\n${"Advisor covered site access and utilities. ".repeat(30)}`,
      createdBy: SALES_ID,
    });
    const mock = buildMockPemNeatResult({
      prospectName: "Robert Vertin",
      advisorName: "Kevin Lee",
      meetingDate: "2026-02-01",
    });
    mock.salesIntelligence.schedule = {
      ...mock.salesIntelligence.schedule,
      summary:
        "Site notes fill most of this field. Timing is loose because Robert is just beginning. Roughly 11-14 months overall. Soil report is pending.",
    } as never;
    await store.saveGenerationSuccess(record.id, {
      structuredResult: mock,
      buildertrendFields: mock.buildertrendFields,
      analysisMetadata: mock.analysisMetadata,
      meetingOutcome: mock.salesIntelligence.meetingOutcome.classification,
      qualification: mock.salesIntelligence.qualification.classification,
      modelProvider: "mock",
      modelName: "mock",
      latencyMs: 1,
      neatStandardVersion: "1.0.0",
      transcriptHash: record.transcript_hash,
    });

    const evidence = await retrievePemEvidence({
      question: "Tell me about Robert Vertin's PEM",
      contentSearchQuestion:
        "In the Robert Vertin NEAT, find where he talks about his timeline for deciding.",
      contentSeeking: true,
      role: "admin",
      channel: "web",
    });
    const answer = evidence.deterministicAnswer ?? "";
    expect(answer).toMatch(/Timing is loose|11-14 months/i);
    expect(answer.split(/\s+/).length).toBeLessThan(100);
  });

  it("KB meta PEM entries do not join prospect-content asks; technique playbook still can", () => {
    expect(
      isKnowledgeBaseRelevantToPemContentQuestion(Q_KID, {
        title: "Manual entry — PEM NEAT",
        summary: "What a PEM NEAT is and how Partnership Evaluation Meetings work.",
        contentExcerpt: "A PEM NEAT captures the Partnership Evaluation Meeting.",
        category: "Knowledge",
        relevanceScore: 80,
        sourceType: "knowledge",
      }),
    ).toBe(false);
    expect(
      isKnowledgeBaseRelevantToPemContentQuestion(Q_KID, {
        title: "Baxter Project Brief",
        summary: "Overview of the Baxter product.",
        contentExcerpt: "Baxter helps Acton teams with PEM NEATs and Slack.",
        category: "Product",
        relevanceScore: 70,
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

  it("kid/living synonyms help transcript passages clear anchors without reopening sewer FPs", () => {
    const expanded = expandQuestionWithTopicSynonyms(Q_KID);
    expect(expanded).toMatch(/son|apartment|college/i);
    const good = KID_TRANSCRIPT;
    const sewer =
      "The backyard slope is steep so I'm worried about grading and sewer capacity for custom vs build-ready.";
    expect(passageMatchesTopicAnchors(good, Q_KID)).toBe(true);
    expect(passageMatchesTopicAnchors(sewer, Q_KID)).toBe(false);
    expect(scorePassageAgainstQuery(good, expanded)).toBeGreaterThan(
      scorePassageAgainstQuery(sewer, expanded),
    );

    const picked = pickRelevantSentencesFromField(CUSTOMER_STORY, Q_KID);
    expect(picked).toMatch(/community college|apartment/i);
    expect(picked).not.toMatch(/Living Large was mentioned/i);

    const formatted = formatPemContentSearchAnswer({
      prospectName: "Denis Kornilov",
      meetingDate: "2026-03-15",
      citationLabel: "Denis Kornilov PEM NEAT",
      passages: [
        {
          kind: "sales_intelligence",
          sectionId: "field.customer_story",
          label: "Customer Story (NEAT field)",
          excerpt: CUSTOMER_STORY,
          timestamp: null,
          score: 90,
        },
      ],
      question: Q_KID,
    });
    expect(formatted).toMatch(/community college|apartment/i);
    expect(formatted).not.toMatch(/^Customer Story \(NEAT field\):/m);
  });

  it("relevant transcript about son/apartment is not rejected by topic anchors", async () => {
    const record = await seedDenis({ withTranscript: true });
    const { searchPemNeatContentAsync, TRANSCRIPT_RELEVANCE_FLOOR, passesTranscriptRelevanceGate } =
      await import("@/lib/baxter-data/pem-neats");
    const searched = await searchPemNeatContentAsync(record, Q_KID, { limit: 4 });
    const tx = searched.passages.find(
      (p) => p.kind === "transcript" && /son|apartment|college/i.test(p.excerpt),
    );
    expect(tx).toBeTruthy();
    console.log(
      `\nTRANSCRIPT CHECK score=${tx!.score} floor=${TRANSCRIPT_RELEVANCE_FLOOR} gate=${passesTranscriptRelevanceGate({ excerpt: tx!.excerpt, score: tx!.score, question: Q_KID })}\n`,
    );
    expect(passageMatchesTopicAnchors(tx!.excerpt, Q_KID)).toBe(true);
  });

  it("ladder caps candidates at 2", () => {
    const ladder = selectPemLadderCandidates({
      question: Q_KID,
      transcriptPassages: [],
      fieldPassages: [
        {
          kind: "sales_intelligence",
          sectionId: "field.customer_story",
          label: "Customer Story",
          excerpt: CUSTOMER_STORY,
          timestamp: null,
          score: 90,
        },
        {
          kind: "sales_intelligence",
          sectionId: "field.budget",
          label: "Budget",
          excerpt: "Budget is 400k",
          timestamp: null,
          score: 80,
        },
        {
          kind: "sales_intelligence",
          sectionId: "field.next_steps",
          label: "Next Steps",
          excerpt: "Send proposal",
          timestamp: null,
          score: 70,
        },
      ],
    });
    expect(ladder.candidates.length).toBe(2);
  });
});

describe("possessive project channel extraction (Part B)", () => {
  it("does not emit #s-project from Kornilov's / his project channel", () => {
    const q1 =
      "What was Denis Kornilov's Type 1 Pain, and what's the latest in his project channel?";
    const q2 = "what's the latest in Denis Kornilov's project channel?";
    const q3 = "latest in their project channel";

    for (const q of [q1, q2, q3]) {
      const mentions = extractChannelMentions(q);
      expect(mentions, q).not.toContain("s-project");
      expect(mentions, q).not.toContain("his-project");
      expect(mentions, q).not.toContain("their-project");
      expect(mentions, q).not.toContain("project");
    }
    expect(isRelationalProjectChannelAsk(q1)).toBe(true);
    expect(isRelationalProjectChannelAsk(q2)).toBe(true);
    expect(isRelationalProjectChannelAsk(q3)).toBe(true);

    expect(isRelationalOrMangledChannelSlug("s-project")).toBe(true);
    expect(isRelationalOrMangledChannelSlug("his-project")).toBe(true);
    expect(extractProjectNameQueries(q1)).not.toContain("his");
    expect(extractProjectNameQueries(q2).some((n) => n.toLowerCase() === "s")).toBe(false);
  });

  it("preserves explicit channel names", () => {
    expect(extractChannelMentions("latest in #l01-26018-kornilov")).toContain("l01-26018-kornilov");
    expect(extractChannelMentions("what happened in the #design channel")).toContain("design");
    expect(extractChannelMentions("last message in the design channel")).toContain("design");
    expect(isRelationalProjectChannelAsk("latest in #l01-26018-kornilov")).toBe(false);
  });
});
