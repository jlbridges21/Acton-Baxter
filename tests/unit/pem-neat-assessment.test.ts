import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_JSON_SCHEMA,
  diagnoseLegacyAssessmentShape,
  mapAssessmentStageToCanonical,
  normalizeAssessmentRaw,
  parseAssessmentStage,
  PEM_NEAT_ASSESSMENT_SCHEMA_VERSION,
} from "@/lib/pem-neat/assessment-stage";
import { ASSESSMENT_CATEGORY_KEYS } from "@/lib/pem-neat/constants";
import { computeOverallScore } from "@/lib/pem-neat/coverage";
import {
  EMAIL_JSON_SCHEMA,
  HANDOFF_JSON_SCHEMA,
  parseEmailStage,
  parseHandoffStage,
  parseQualityReviewStage,
  QUALITY_REVIEW_JSON_SCHEMA,
} from "@/lib/pem-neat/downstream-stages";
import { emptyPemNeatShell } from "@/lib/pem-neat/defaults";
import { buildAssessmentStagePrompt } from "@/lib/pem-neat/prompts";
import { buildertrendFieldsSchema, parsePemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { ROBERT_STYLE_SI_STAGE } from "../fixtures/pem-neat-robert-style-ledger";
import { mapSalesIntelligenceStageToCanonical } from "@/lib/pem-neat/sales-intelligence-stage";

function sampleCategory(score: number | null, status: string) {
  return {
    score,
    status,
    explanation: "Observable advisor behavior evaluated.",
    evidence: ["Advisor asked follow-up questions."],
    whatWorked: score && score >= 7 ? ["Clear discovery"] : [],
    coachingOpportunities: score && score < 7 ? ["Deepen alternatives"] : [],
  };
}

function sampleAssessment() {
  const categories = Object.fromEntries(
    ASSESSMENT_CATEGORY_KEYS.map((k) => {
      if (k === "outcome_close" || k === "post_sell") {
        return [k, sampleCategory(null, "NOT_DETERMINABLE")];
      }
      return [k, sampleCategory(8, "COMPLETED")];
    }),
  );
  return {
    categories,
    palo: {
      purpose: {
        score: 9,
        status: "COMPLETED",
        explanation: "Purpose previewed.",
        evidence: ["Agenda/topics explained"],
      },
      agenda: {
        score: 9,
        status: "COMPLETED",
        explanation: "Agenda previewed.",
        evidence: ["Topics listed"],
      },
      logistics: {
        score: 8,
        status: "COMPLETED",
        explanation: "Hard stop discussed.",
        evidence: ["Meeting time constraint"],
      },
      outcome: {
        score: 8,
        status: "COMPLETED",
        explanation: "Three outcomes explained.",
        evidence: ["YES/NO/decision date"],
      },
    },
    topStrengths: ["Deep Type 2 discovery around turnkey preference"],
    topImprovements: ["Quantify competing alternatives before fulfillment"],
    oneThing: "After alternatives surface, quantify how strongly they compete with the ADU.",
  };
}

describe("Assessment stage contract", () => {
  it("prompt lists all canonical category keys", () => {
    const prompt = buildAssessmentStagePrompt();
    for (const key of ASSESSMENT_CATEGORY_KEYS) {
      expect(prompt).toContain(key);
    }
    expect(prompt).toMatch(/score must be a NUMBER/i);
    expect(PEM_NEAT_ASSESSMENT_SCHEMA_VERSION).toBe(1);
  });

  it("JSON Schema requires all 12 category keys", () => {
    const required = ASSESSMENT_JSON_SCHEMA.properties.categories.required;
    expect([...required].sort()).toEqual([...ASSESSMENT_CATEGORY_KEYS].sort());
  });

  it("parses numeric scores and maps into canonical NEAT", () => {
    const parsed = parseAssessmentStage(sampleAssessment());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const mapped = mapAssessmentStageToCanonical(parsed.data);
    expect(mapped.assessment.categories).toHaveLength(12);
    expect(mapped.assessment.categories.find((c) => c.key === "bonding_rapport")?.score).toBe(8);
    expect(mapped.assessment.categories.find((c) => c.key === "outcome_close")?.status).toBe(
      "NOT_DETERMINABLE",
    );
    expect(
      mapped.assessment.categories.find((c) => c.key === "palo_upfront_contract")?.palo,
    ).toBeTruthy();
    const overall = computeOverallScore(mapped.assessment.categories);
    expect(overall).toBeGreaterThan(7);
  });

  it("normalizes 8/10 and NOT DETERMINABLE score strings", () => {
    const raw = normalizeAssessmentRaw({
      ...sampleAssessment(),
      categories: {
        ...sampleAssessment().categories,
        budget: {
          score: "8/10",
          status: "COMPLETED",
          explanation: "Budget explored.",
          evidence: "Asked funding",
          whatWorked: "Identified cash available",
          coachingOpportunities: [],
        },
        schedule: {
          score: "NOT DETERMINABLE",
          status: "strong",
          explanation: "Missing",
          evidence: [],
          whatWorked: [],
          coachingOpportunities: [],
        },
      },
    });
    const parsed = parseAssessmentStage(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.categories.budget.score).toBe(8);
    expect(parsed.data.categories.schedule.score).toBeNull();
  });

  it("converts legacy array categories into keyed object", () => {
    const legacy = {
      categories: [
        {
          key: "bonding_rapport",
          score: "7",
          status: "COMPLETED",
          evidence: ["Rapport built"],
          whatWorked: "Friendly opening",
          coachingOpportunity: "Continue",
        },
      ],
      oneThing: "Deepen Type 1 consequences.",
      topStrengths: ["Good rapport"],
      topImprovements: ["More alternatives"],
    };
    const issues = diagnoseLegacyAssessmentShape(legacy);
    expect(issues.some((i) => /array/i.test(i))).toBe(true);
    const parsed = parseAssessmentStage(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.categories.bonding_rapport.score).toBe(7);
    expect(parsed.data.categories.outcome_close.status).toBe("NOT_DETERMINABLE");
  });

  it("final shell with assessment + SI validates", () => {
    const shell = emptyPemNeatShell({ prospectName: "Homeowner", advisorName: "Jesse" });
    shell.salesIntelligence = {
      ...shell.salesIntelligence,
      ...mapSalesIntelligenceStageToCanonical(ROBERT_STYLE_SI_STAGE),
    };
    const parsed = parseAssessmentStage(sampleAssessment());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    shell.assessment = mapAssessmentStageToCanonical(parsed.data).assessment;
    shell.followUpEmail = {
      subject: "Next steps on your ADU exploration",
      body: "Thank you for meeting today about creating an independent space for your family.",
    };
    expect(() => parsePemNeatStructuredResult(shell)).not.toThrow();
  });
});

describe("Downstream stage contracts", () => {
  it("email schema is simple subject/body", () => {
    expect(EMAIL_JSON_SCHEMA.required).toEqual(["subject", "body"]);
    const parsed = parseEmailStage({
      followUpEmail: { subject: "Thanks", body: "Looking forward to next steps." },
    });
    expect(parsed.ok).toBe(true);
  });

  it("handoff requires all BuilderTrend keys and accepts nulls", () => {
    const keys = HANDOFF_JSON_SCHEMA.properties.buildertrendFields.required as string[];
    expect(keys.length).toBe(Object.keys(buildertrendFieldsSchema.shape).length);
    const emptyBt = Object.fromEntries(
      keys.map((k) => [k, k === "customerPriorities" ? [] : null]),
    );
    const parsed = parseHandoffStage({
      projectIntelligence: { facts: [], summary: null },
      buildertrendFields: emptyBt,
      internalOpportunityNotes: "",
      productionNotes: [],
    });
    expect(parsed.ok).toBe(true);
  });

  it("quality review soft-passes malformed optional fields", () => {
    expect(QUALITY_REVIEW_JSON_SCHEMA.required).toEqual(["pass", "severity", "issues"]);
    const parsed = parseQualityReviewStage({ pass: true, severity: "LOW", issues: null });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.pass).toBe(true);
    expect(parsed.data.issues).toEqual([]);
  });
});
