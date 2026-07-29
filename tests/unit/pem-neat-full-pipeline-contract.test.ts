import { describe, expect, it } from "vitest";
import {
  mapAssessmentStageToCanonical,
  parseAssessmentStage,
} from "@/lib/pem-neat/assessment-stage";
import { ASSESSMENT_CATEGORY_KEYS } from "@/lib/pem-neat/constants";
import { emptyPemNeatShell, mergeBuildertrendFields } from "@/lib/pem-neat/defaults";
import {
  applyHandoffStageToShell,
  parseEmailStage,
  parseHandoffStage,
  parseQualityReviewStage,
} from "@/lib/pem-neat/downstream-stages";
import { parseFactLedger } from "@/lib/pem-neat/fact-ledger";
import {
  mapSalesIntelligenceStageToCanonical,
  parseSalesIntelligenceStage,
} from "@/lib/pem-neat/sales-intelligence-stage";
import { parsePemNeatStructuredResult, buildertrendFieldsSchema } from "@/lib/pem-neat/schemas";
import {
  ROBERT_STYLE_FACT_LEDGER,
  ROBERT_STYLE_SI_STAGE,
} from "../fixtures/pem-neat-robert-style-ledger";

function sampleAssessmentCategories() {
  return Object.fromEntries(
    ASSESSMENT_CATEGORY_KEYS.map((k) => [
      k,
      k === "outcome_close" || k === "post_sell"
        ? {
            score: null,
            status: "NOT_DETERMINABLE",
            explanation: "Transcript ended before close.",
            evidence: [],
            whatWorked: [],
            coachingOpportunities: [],
          }
        : {
            score: 8,
            status: "COMPLETED",
            explanation: "Advisor execution observed.",
            evidence: ["Follow-up questions"],
            whatWorked: ["Clear discovery"],
            coachingOpportunities: [],
          },
    ]),
  );
}

describe("Full PEM pipeline contract (mocked stage outputs)", () => {
  it("Fact Ledger → SI → Assessment → Email → Handoff → Review → final NEAT validates", () => {
    const ledger = parseFactLedger(ROBERT_STYLE_FACT_LEDGER);
    expect(ledger.budget.length).toBeGreaterThan(0);

    const si = parseSalesIntelligenceStage(ROBERT_STYLE_SI_STAGE);
    expect(si.ok).toBe(true);
    if (!si.ok) return;

    const assessment = parseAssessmentStage({
      categories: sampleAssessmentCategories(),
      palo: {
        purpose: {
          score: 9,
          status: "COMPLETED",
          explanation: "Purpose previewed",
          evidence: ["Agenda"],
        },
        agenda: {
          score: 9,
          status: "COMPLETED",
          explanation: "Agenda previewed",
          evidence: ["Topics"],
        },
        logistics: {
          score: 8,
          status: "COMPLETED",
          explanation: "Hard stop",
          evidence: ["Time"],
        },
        outcome: {
          score: 8,
          status: "COMPLETED",
          explanation: "Three outcomes",
          evidence: ["YES/NO/DD"],
        },
      },
      topStrengths: ["Strong Type 2 discovery"],
      topImprovements: ["Quantify alternatives earlier"],
      oneThing: "Quantify competing alternatives before fulfillment.",
    });
    expect(assessment.ok).toBe(true);
    if (!assessment.ok) return;

    const email = parseEmailStage({
      subject: "Next steps on your ADU + pool exploration",
      body: "Thank you for sharing your goals for independent nearby housing and coordinated backyard work. Next we will outline the feasibility package.",
    });
    expect(email.ok).toBe(true);
    if (!email.ok) return;

    const btKeys = Object.keys(buildertrendFieldsSchema.shape);
    const emptyBt: Record<string, unknown> = Object.fromEntries(
      btKeys.map((k) => [k, k === "customerPriorities" ? ["Quality", "Turnkey"] : null]),
    );
    emptyBt.customerBudget = 500000;
    emptyBt.customerStory = "Adult child housing + pool coordination";
    emptyBt.squareFeet = 448;
    emptyBt.projectType = "BR - Signature Series";
    emptyBt.recommendedBrModels = "Manzanita discussed";

    const handoff = parseHandoffStage({
      projectIntelligence: {
        facts: [
          {
            topic: "Sewer",
            value: "Routing/depth concern",
            status: "HOMEOWNER_REPORTED",
            evidence: "Prospect raised sewer concern",
          },
        ],
        summary: "ADU + pool early discovery",
      },
      buildertrendFields: emptyBt,
      internalOpportunityNotes: "Early exploratory; adult-child gating.",
      productionNotes: ["Feasibility first"],
    });
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;

    const review = parseQualityReviewStage({
      pass: true,
      severity: "none",
      issues: [],
    });
    expect(review.ok).toBe(true);

    const shell = emptyPemNeatShell({ prospectName: "Homeowner", advisorName: "Jesse" });
    shell.salesIntelligence = {
      ...shell.salesIntelligence,
      ...mapSalesIntelligenceStageToCanonical(si.data),
    };
    shell.assessment = mapAssessmentStageToCanonical(assessment.data).assessment;
    shell.followUpEmail = email.data;
    applyHandoffStageToShell(shell, handoff.data);
    shell.buildertrendFields = mergeBuildertrendFields(shell.buildertrendFields);

    const final = parsePemNeatStructuredResult(shell);
    expect((final.salesIntelligence.customerStory ?? "").length).toBeGreaterThan(40);
    expect(final.assessment.categories).toHaveLength(12);
    expect(final.followUpEmail.body.length).toBeGreaterThan(20);
    expect(Object.keys(final.buildertrendFields).length).toBe(
      Object.keys(buildertrendFieldsSchema.shape).length,
    );
    expect(final.projectIntelligence.facts.length).toBeGreaterThan(0);
    expect(review.ok && review.data.pass).toBe(true);
  });
});
