/**
 * Relevance gate + PEM answer ladder — no confident-but-irrelevant transcript answers.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  TRANSCRIPT_RELEVANCE_FLOOR,
  passesTranscriptRelevanceGate,
  retrievePemEvidence,
  scorePassageAgainstQuery,
  searchPemNeatContentAsync,
} from "@/lib/baxter-data/pem-neats";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";

const SALES_ID = "00000000-0000-4000-8000-000000000099";

const Q_VERTIN_TIMELINE =
  "In the Robert Vertin NEAT, find the part of the transcript where he talks about his timeline for deciding.";
const Q_KITA_SOLAR =
  "In the Leslie Kita NEAT, find the part of the transcript where they discussed solar panels.";
const Q_SHARON =
  "Look in Sharon Liu neat and find the part of the transcript where Kevin disqualified her by saying that he didn't recommend an ADU and this caused her to open up more about her pain (reason for building an ADU).";

const VERTIN_TRANSCRIPT = `
01:00: Advisor: Today I want to cover custom versus build-ready options, sewer capacity, and the backyard slope.
01:20: Robert: The backyard slope is steep so I'm worried about grading.
01:40: Advisor: Custom vs build-ready depends on setbacks and sewer. Let's walk the site.
02:00: Robert: OK, show me what that means for the pad.
`.trim();

const KITA_TRANSCRIPT = `
05:00: Advisor: Feasibility pricing usually lands after we confirm setbacks.
05:20: Leslie: What does the project agreement cover?
05:40: Advisor: The project agreement locks scope and deposits before design. Leslie and I discussed next steps.
06:00: Leslie: Makes sense — send me the pricing range when you can.
`.trim();

const SHARON_TRANSCRIPT = `
39:31: I, I, I can't sit here and recommend you do it at this moment.
39:35: But maybe I just haven't heard, Why you would?
39:42: Well, I think partly I feel like eventually we would want to do something.
40:22: And like you said, we'll have to talk to our parents about it because eventually if they want to move in with us, so.
`.trim();

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

async function seed(
  name: string,
  transcript: string,
  patch?: (m: ReturnType<typeof buildMockPemNeatResult>) => void,
) {
  const store = getPemNeatStore();
  const record = await store.create({
    prospectName: name,
    salespersonUserId: SALES_ID,
    salespersonDisplayName: "Kevin",
    meetingDate: "2026-08-01",
    transcript: `${transcript}\n\n${"Advisor covered site access and utilities. ".repeat(30)}`,
    createdBy: SALES_ID,
  });
  const mock = buildMockPemNeatResult({
    prospectName: name,
    advisorName: "Kevin",
    meetingDate: "2026-08-01",
  });
  patch?.(mock);
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

describe("transcript relevance calibration", () => {
  it("documents floor vs Fail A / known-good Sharon scores", async () => {
    const vertin = await seed("Robert Vertin", VERTIN_TRANSCRIPT);
    const sharon = await seed("Sharon Liu", SHARON_TRANSCRIPT);
    const bad = await searchPemNeatContentAsync(vertin, Q_VERTIN_TIMELINE, { limit: 4 });
    const good = await searchPemNeatContentAsync(sharon, Q_SHARON, { limit: 4 });
    const badTop = bad.passages.find((p) => p.kind === "transcript");
    const goodTop = good.passages.find((p) => p.kind === "transcript");
    expect(badTop?.score ?? 0).toBeLessThan(TRANSCRIPT_RELEVANCE_FLOOR);
    expect(goodTop?.score ?? 0).toBeGreaterThanOrEqual(TRANSCRIPT_RELEVANCE_FLOOR);
    expect(
      passesTranscriptRelevanceGate({
        excerpt: goodTop!.excerpt,
        score: goodTop!.score,
        question: Q_SHARON,
      }),
    ).toBe(true);
    expect(
      passesTranscriptRelevanceGate({
        excerpt: badTop?.excerpt ?? "sewer slope custom",
        score: badTop?.score ?? 55,
        question: Q_VERTIN_TIMELINE,
      }),
    ).toBe(false);
    // Surface for the audit report.
    console.log(
      `\nCALIBRATION floor=${TRANSCRIPT_RELEVANCE_FLOOR} failA=${badTop?.score ?? "none"} sharon=${goodTop?.score}\n`,
    );
  });
});

describe("PEM answer ladder", () => {
  it("Failure A: Vertin timeline → Schedule field, not sewer transcript", async () => {
    await seed("Robert Vertin", VERTIN_TRANSCRIPT, (m) => {
      m.salesIntelligence.schedule = {
        ...m.salesIntelligence.schedule,
        summary:
          "Timing is loose because Robert is just beginning the process. No real rush. Roughly 4-5 months for permit/engineering, 3-6 months for construction, around 11-14 months overall.",
        flexibility: "No real rush — just beginning the process.",
      } as never;
    });
    const evidence = await retrievePemEvidence({
      question: "Tell me about Robert Vertin's PEM",
      contentSearchQuestion: Q_VERTIN_TIMELINE,
      contentSeeking: true,
      role: "admin",
      channel: "web",
    });
    expect(evidence.answerMode).toBe("deterministic_structured");
    expect(evidence.deterministicAnswer).toMatch(/Timing is loose|11-14 months|No real rush/i);
    expect(evidence.deterministicAnswer).not.toMatch(/sewer|backyard slope|build-ready/i);
    expect(evidence.items[0]?.tags).toContain("field.schedule");
    console.log("\n--- FAILURE A AFTER ---\n" + evidence.deterministicAnswer + "\n---\n");
  });

  it("Failure B: Kita solar → honest fallback, not pricing passage", async () => {
    await seed("Leslie Kita", KITA_TRANSCRIPT);
    const evidence = await retrievePemEvidence({
      question: "Tell me about Leslie Kita's PEM",
      contentSearchQuestion: Q_KITA_SOLAR,
      contentSeeking: true,
      role: "admin",
      channel: "web",
    });
    expect(evidence.answerMode).toBe("not_determinable");
    expect(evidence.deterministicAnswer).toMatch(/couldn'?t find any mention of solar/i);
    expect(evidence.deterministicAnswer).toMatch(/I can answer questions like/i);
    expect(evidence.deterministicAnswer).not.toMatch(/feasibility pricing|project agreement/i);
    console.log("\n--- FAILURE B AFTER ---\n" + evidence.deterministicAnswer + "\n---\n");
  });

  it("Sharon Liu 39:31 still clears the gate", async () => {
    await seed("Sharon Liu", SHARON_TRANSCRIPT);
    const evidence = await retrievePemEvidence({
      question: "Tell me about Sharon Liu's PEM",
      contentSearchQuestion: Q_SHARON,
      contentSeeking: true,
      role: "admin",
      channel: "web",
    });
    expect(evidence.deterministicAnswer).toMatch(/39:31/);
    expect(evidence.deterministicAnswer).toMatch(/can'?t sit here and recommend/i);
  });

  it("direct field lookup still works (Razel-style budget)", async () => {
    await seed("Razel Talle", "10:00: Hello.\n10:05: Hi.\n".repeat(20));
    const evidence = await retrievePemEvidence({
      question: "What is Razel Talle's budget?",
      role: "admin",
      channel: "web",
    });
    expect(evidence.answerMode).toBe("deterministic_structured");
    expect(evidence.deterministicAnswer).toMatch(/budget|400|thousand/i);
    expect(evidence.items[0]?.tags ?? []).not.toContain("content_search");
  });

  it("unanswerable content asks across NEATs hit honest fallback", async () => {
    await seed("Robert Vertin", VERTIN_TRANSCRIPT);
    await seed("Leslie Kita", KITA_TRANSCRIPT);
    for (const [name, q] of [
      [
        "Robert Vertin",
        "find the part of the transcript where they discussed geothermal heat pumps",
      ],
      ["Leslie Kita", "find where they talked about EV chargers in the transcript"],
      ["Leslie Kita", "show me the transcript quote about HOA disputes"],
    ] as const) {
      const evidence = await retrievePemEvidence({
        question: `Tell me about ${name}'s PEM`,
        contentSearchQuestion: q,
        contentSeeking: true,
        role: "admin",
        channel: "web",
      });
      expect(evidence.answerMode, q).toBe("not_determinable");
      expect(evidence.deterministicAnswer, q).toMatch(/couldn'?t find/i);
      expect(evidence.deterministicAnswer, q).toMatch(/I can answer questions like/i);
    }
  });
});

describe("scorePassageAgainstQuery topic noise", () => {
  it("does not score sewer agenda highly for a timeline ask without timeline terms", () => {
    const sewer =
      "Advisor: Custom vs build-ready depends on setbacks and sewer. Let's walk the site.";
    const score = scorePassageAgainstQuery(sewer, Q_VERTIN_TIMELINE);
    expect(score).toBeLessThan(TRANSCRIPT_RELEVANCE_FLOOR);
  });
});
