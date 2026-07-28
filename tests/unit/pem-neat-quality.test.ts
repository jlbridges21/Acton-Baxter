import { describe, expect, it, beforeEach } from "vitest";
import {
  analyzeTranscriptSignals,
  computeOverallScore,
  scoreFactCoverage,
} from "@/lib/pem-neat/coverage";
import { formatHumanDisplayName } from "@/lib/pem-neat/display-name";
import { emptyPemNeatShell } from "@/lib/pem-neat/defaults";
import { generatePemNeat, getPemNeatModelName } from "@/lib/pem-neat/generate";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { parsePemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { buildFactExtractionStagePrompt, buildPemNeatSystemPrompt } from "@/lib/pem-neat/prompts";
import {
  EXPECTED_ROBERT_STYLE_CONCEPTS,
  ROBERT_STYLE_PEM_TRANSCRIPT,
} from "../fixtures/pem-neat-robert-style";

describe("formatHumanDisplayName", () => {
  it("formats dotted usernames into Title Case", () => {
    expect(formatHumanDisplayName("jackson.bridges")).toBe("Jackson Bridges");
    expect(formatHumanDisplayName("jesse_smith")).toBe("Jesse Smith");
  });

  it("preserves already human names", () => {
    expect(formatHumanDisplayName("Jesse Acton")).toBe("Jesse Acton");
  });
});

describe("PEM evidence coverage", () => {
  it("flags empty shell against substantive transcript signals", () => {
    const signals = analyzeTranscriptSignals(ROBERT_STYLE_PEM_TRANSCRIPT);
    expect(signals.looksSubstantive).toBe(true);
    expect(signals.currencyMentions).toBeGreaterThan(0);

    const empty = emptyPemNeatShell({ prospectName: "Robert", advisorName: "Jesse" });
    const coverage = scoreFactCoverage(empty, signals);
    expect(coverage.isSuspiciouslyEmpty).toBe(true);
  });

  it("does not flag a rich mock result as empty", () => {
    const signals = analyzeTranscriptSignals(ROBERT_STYLE_PEM_TRANSCRIPT);
    const rich = parsePemNeatStructuredResult(
      buildMockPemNeatResult({ prospectName: "Robert", advisorName: "Jesse" }),
    );
    const coverage = scoreFactCoverage(rich, signals);
    expect(coverage.isSuspiciouslyEmpty).toBe(false);
    expect(coverage.customerStory).toBe(true);
    expect(coverage.type1Count).toBeGreaterThan(0);
  });

  it("computes overall score from determinable categories only", () => {
    const result = buildMockPemNeatResult({
      prospectName: "Emily",
      advisorName: "Jesse",
    });
    const score = computeOverallScore(result.assessment.categories);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThanOrEqual(1);
    expect(score!).toBeLessThanOrEqual(10);
  });
});

describe("PEM prompt quality", () => {
  it("encourages grounded synthesis rather than empty placeholders", () => {
    const system = buildPemNeatSystemPrompt();
    expect(system.toLowerCase()).toContain("grounded synthesis");
    expect(system.toLowerCase()).toContain("refuse to understand");
    const facts = buildFactExtractionStagePrompt();
    expect(facts).toMatch(/CUSTOMER MEANING/i);
    expect(facts).not.toMatch(/Prefer null \/ \[\] when not established\./);
  });
});

describe("PEM model selection", () => {
  it("upgrades mini chat models to gpt-4o for PEM unless explicitly overridden", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    const prevPem = process.env.PEM_NEAT_OPENAI_MODEL;
    const prevBaxter = process.env.BAXTER_OPENAI_MODEL;
    const prevOpenAi = process.env.OPENAI_MODEL;
    try {
      delete process.env.PEM_NEAT_OPENAI_MODEL;
      process.env.BAXTER_OPENAI_MODEL = "gpt-4o-mini";
      process.env.OPENAI_MODEL = "gpt-4o-mini";
      expect(getPemNeatModelName()).toBe("gpt-4o");

      process.env.PEM_NEAT_OPENAI_MODEL = "gpt-4.1";
      expect(getPemNeatModelName()).toBe("gpt-4.1");
    } finally {
      if (prevPem === undefined) delete process.env.PEM_NEAT_OPENAI_MODEL;
      else process.env.PEM_NEAT_OPENAI_MODEL = prevPem;
      if (prevBaxter === undefined) delete process.env.BAXTER_OPENAI_MODEL;
      else process.env.BAXTER_OPENAI_MODEL = prevBaxter;
      if (prevOpenAi === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = prevOpenAi;
    }
  });
});

describe("PEM mock generation content bar", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.ENABLE_MOCK_RESEARCH = "true";
  });

  it("mock path remains substantive against Robert-style concepts", async () => {
    const out = await generatePemNeat({
      prospectName: "Robert Test",
      advisorName: "Jesse",
      meetingDate: "2026-07-01",
      transcript: ROBERT_STYLE_PEM_TRANSCRIPT,
    });
    expect(out.usedMock).toBe(true);
    const story = out.result.salesIntelligence.customerStory ?? "";
    expect(story.length).toBeGreaterThan(40);
    expect(out.result.salesIntelligence.type1Pain.length).toBeGreaterThan(0);
    expect(out.result.assessment.categories.some((c) => c.score != null)).toBe(true);
    expect(out.result.followUpEmail.body).not.toMatch(
      /^Thank you for meeting with us\. We will follow up/i,
    );

    // Fixture concepts exist in transcript for future live regression
    for (const re of EXPECTED_ROBERT_STYLE_CONCEPTS.budgetHints) {
      expect(ROBERT_STYLE_PEM_TRANSCRIPT).toMatch(re);
    }
  });
});
