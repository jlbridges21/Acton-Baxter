import { describe, expect, it } from "vitest";
import { emptyPemNeatShell } from "@/lib/pem-neat/defaults";
import { parseFactLedger, countFactLedgerItems } from "@/lib/pem-neat/fact-ledger";
import { buildSalesIntelligenceStagePrompt } from "@/lib/pem-neat/prompts";
import { parsePemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import {
  describeSalesIntelligenceShape,
  extractBudgetCandidatesFromLedger,
  factLedgerSemanticCounts,
  mapSalesIntelligenceStageToCanonical,
  parseSalesIntelligenceStage,
  PEM_NEAT_GENERATION_SCHEMA_VERSION,
  salesIntelligenceStageSchema,
  SALES_INTELLIGENCE_JSON_SCHEMA,
} from "@/lib/pem-neat/sales-intelligence-stage";
import { detectTranscriptLikelyIncomplete } from "@/lib/pem-neat/transcript";
import { employeeFacingPemError, normalizePemErrorCode } from "@/lib/pem-neat/trace";
import {
  ROBERT_STYLE_FACT_LEDGER,
  ROBERT_STYLE_SI_CONCEPT_HINTS,
  ROBERT_STYLE_SI_STAGE,
} from "../fixtures/pem-neat-robert-style-ledger";

describe("Sales Intelligence stage contract", () => {
  it("prompt contract mentions simple synthesis fields (not evidence wrappers)", () => {
    const prompt = buildSalesIntelligenceStagePrompt();
    expect(prompt).toMatch(/type1Pain:\s*\{\s*summary,\s*drivers/i);
    expect(prompt).toMatch(/availableFunds \(number\|null\)/i);
    expect(prompt).toMatch(/primaryDecisionMaker/i);
    expect(prompt).not.toMatch(/evidenceType.*budget\.target/i);
  });

  it("JSON Schema required keys match Zod stage schema", () => {
    const zodKeys = Object.keys(salesIntelligenceStageSchema.shape).sort();
    const jsonKeys = Object.keys(SALES_INTELLIGENCE_JSON_SCHEMA.properties).sort();
    expect(jsonKeys).toEqual(zodKeys);
    expect(PEM_NEAT_GENERATION_SCHEMA_VERSION).toBe(2);
  });

  it("representative stage output passes Zod and maps into canonical NEAT", () => {
    const parsed = parseSalesIntelligenceStage(ROBERT_STYLE_SI_STAGE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const canonical = mapSalesIntelligenceStageToCanonical(parsed.data);
    const shell = emptyPemNeatShell({ prospectName: "Homeowner", advisorName: "Jesse" });
    shell.salesIntelligence = { ...shell.salesIntelligence, ...canonical };
    const neat = parsePemNeatStructuredResult(shell);

    expect(
      ROBERT_STYLE_SI_CONCEPT_HINTS.story.some((r) =>
        r.test(neat.salesIntelligence.customerStory ?? ""),
      ),
    ).toBe(true);
    expect(neat.salesIntelligence.type1Pain.length).toBeGreaterThan(0);
    expect(neat.salesIntelligence.type2Pain.length).toBeGreaterThan(0);
    expect(
      neat.salesIntelligence.budget.statedBudget?.value ?? neat.salesIntelligence.budget.summary,
    ).toMatch(/500/);
    expect(neat.salesIntelligence.decisionProcess.alternatives.join(" ")).toMatch(/rent|pool/i);
    expect(neat.salesIntelligence.meetingOutcome.explanation).toMatch(/incomplete/i);
  });

  it("normalizes string money and string lists without inventing meaning", () => {
    const parsed = parseSalesIntelligenceStage({
      ...ROBERT_STYLE_SI_STAGE,
      budget: {
        ...ROBERT_STYLE_SI_STAGE.budget,
        availableFunds: "$500,000",
        potentialCeiling: "600000",
        statedTarget: null,
      },
      type1Pain: {
        summary: "Housing for adult child",
        drivers: "Independent nearby housing",
      },
      competitionAlternatives: "Continue rental",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.budget.availableFunds).toBe(500000);
    expect(parsed.data.budget.potentialCeiling).toBe(600000);
    expect(parsed.data.type1Pain.drivers).toEqual(["Independent nearby housing"]);
    expect(parsed.data.competitionAlternatives).toEqual(["Continue rental"]);
  });

  it("shape diagnostics report paths/types without sensitive values", () => {
    const shape = describeSalesIntelligenceShape({
      customerStory: "SECRET STORY TEXT",
      type1Pain: ["string driver"],
      budget: { target: "$500k" },
    });
    expect(shape.some((l) => l.includes("customerStory — string"))).toBe(true);
    expect(shape.some((l) => l.includes("type1Pain — array"))).toBe(true);
    expect(shape.join("\n")).not.toContain("SECRET STORY TEXT");
    expect(shape.join("\n")).not.toContain("$500k");
  });

  it("rejects legacy evidenced budget object shape as invalid stage output", () => {
    const parsed = parseSalesIntelligenceStage({
      customerStory: "Story",
      customerPain: "Pain",
      type1Pain: [{ statement: "old pain item" }],
      type2Pain: { summary: "ok", drivers: [] },
      budget: {
        summary: "Budget",
        target: { value: "$500k", evidenceType: "prospect_fact" },
        statedTarget: null,
        availableFunds: null,
        potentialCeiling: null,
        aduAllocation: null,
        poolAllocation: null,
        fundingSummary: null,
        flexibility: null,
        risks: [],
      },
      decisionProcess: {
        summary: "Decision",
        primaryDecisionMaker: null,
        otherParticipants: [],
        gatingFactors: [],
        alternatives: [],
        criteria: [],
        timing: null,
      },
      schedule: { summary: "Schedule", urgency: null, dates: [], drivers: [] },
      competitionAlternatives: [],
      actonRecommendation: {
        fit: "not_enough_information",
        summary: "n/a",
        reasons: [],
      },
      nextSteps: { prospect: [], acton: [] },
      meetingOutcome: {
        classification: "DECISION_DATE_NOT_SECURED",
        explanation: "n/a",
        transcriptIncomplete: false,
      },
      qualification: {
        classification: "EARLY_EXPLORATORY",
        explanation: "n/a",
        risks: [],
      },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.some((i) => /type1Pain/i.test(i))).toBe(true);
  });
});

describe("Fact Ledger → SI inputs", () => {
  it("robert-style ledger is substantive with budget candidates", () => {
    const ledger = parseFactLedger(ROBERT_STYLE_FACT_LEDGER);
    expect(countFactLedgerItems(ledger)).toBeGreaterThan(10);
    const counts = factLedgerSemanticCounts(ledger);
    expect(counts.customerContextCount).toBeGreaterThan(0);
    expect(counts.budgetMentionCount).toBeGreaterThanOrEqual(3);
    expect(counts.decisionFactCount).toBeGreaterThan(0);
    expect(counts.projectFactCount).toBeGreaterThan(0);
    const budgets = extractBudgetCandidatesFromLedger(ledger);
    expect(budgets.join(" ")).toMatch(/500/);
    expect(budgets.join(" ")).toMatch(/600/);
  });
});

describe("Incomplete transcript heuristic", () => {
  it("flags mid-sentence endings", () => {
    const incomplete = detectTranscriptLikelyIncomplete(
      "Advisor: We covered budget and decision.\nProspect: As far as",
    );
    expect(incomplete.likelyIncomplete).toBe(true);
  });

  it("does not flag a clear close", () => {
    const complete = detectTranscriptLikelyIncomplete(
      "Advisor: I'll email the agreement tomorrow. Thanks for your time today.\nProspect: Sounds good.",
    );
    expect(complete.likelyIncomplete).toBe(false);
  });
});

describe("SI error taxonomy", () => {
  it("maps legacy FACT schema invalid + sales_intelligence stage to SI code", () => {
    expect(normalizePemErrorCode("PEM_FACT_SCHEMA_INVALID", "sales_intelligence")).toBe(
      "PEM_SALES_INTELLIGENCE_SCHEMA_INVALID",
    );
    expect(normalizePemErrorCode("PEM_FACT_SCHEMA_INVALID", "fact_ledger")).toBe(
      "PEM_FACT_LEDGER_SCHEMA_INVALID",
    );
    expect(employeeFacingPemError("PEM_SALES_INTELLIGENCE_SCHEMA_INVALID")).toMatch(
      /sales intelligence/i,
    );
  });
});
