import {
  ASSESSMENT_CATEGORY_KEYS,
  ASSESSMENT_CATEGORY_LABELS,
  type AssessmentCategoryKey,
} from "./constants";
import type { PemNeatStructuredResult } from "./schemas";

function category(
  key: AssessmentCategoryKey,
  overrides: Partial<PemNeatStructuredResult["assessment"]["categories"][number]> = {},
): PemNeatStructuredResult["assessment"]["categories"][number] {
  return {
    key,
    label: ASSESSMENT_CATEGORY_LABELS[key],
    score: 6,
    status: "PARTIAL",
    evidence: "Fixture assessment based on synthetic transcript.",
    whatWorked: null,
    coachingOpportunity: null,
    timestamps: [],
    ...overrides,
  };
}

/** Deterministic structured NEAT for mock/tests — no real customer PII. */
export function buildMockPemNeatResult(input: {
  prospectName: string;
  advisorName: string;
  meetingDate?: string | null;
}): PemNeatStructuredResult {
  const categories = ASSESSMENT_CATEGORY_KEYS.map((key) => {
    if (key === "palo_upfront_contract") {
      return category(key, {
        score: 7,
        status: "PARTIAL",
        evidence: "Advisor set purpose and agenda; logistics and outcome partially covered.",
        whatWorked: "Clear meeting purpose stated early.",
        coachingOpportunity:
          "When the homeowner mentioned timeline pressure, confirm the desired meeting outcome before moving into project requirements.",
        palo: {
          purpose: { status: "COMPLETED", evidence: "Purpose stated at open.", notes: null },
          agenda: { status: "COMPLETED", evidence: "Agenda outlined.", notes: null },
          logistics: { status: "PARTIAL", evidence: "Timeboxed loosely.", notes: null },
          outcome: { status: "PARTIAL", evidence: "Next step discussed but soft.", notes: null },
        },
      });
    }
    if (key === "type1_pain") {
      return category(key, {
        score: 7,
        status: "PARTIAL",
        evidence: "Prospect described aging parent living alone.",
        whatWorked: "Asked why the project matters now.",
        coachingOpportunity:
          "After they said Mom is increasingly vulnerable living alone, ask one consequence question before square footage.",
      });
    }
    if (key === "type2_pain") {
      return category(key, {
        score: 5,
        status: "PARTIAL",
        evidence: "Prospect mentioned prior contractor communication issues.",
        coachingOpportunity: "Explore what a good partner must provide before positioning Acton.",
      });
    }
    return category(key);
  });

  return {
    metadata: {
      prospectName: input.prospectName,
      advisorName: input.advisorName,
      meetingDate: input.meetingDate ?? null,
      transcriptQuality: "medium",
      limitations: ["Mock generation — not a live model analysis."],
    },
    salesIntelligence: {
      customerStory:
        "Prospect is evaluating an ADU so an aging parent can live nearby with more independence.",
      customerPain:
        "Parent living alone has become harder to manage; family wants proximity without shared household conflict.",
      type1Pain: [
        {
          statement:
            "Mom is increasingly vulnerable living alone, and the family wants her nearby while preserving independence.",
          surfaceReason: "Want an ADU for Mom.",
          deeperConsequence:
            "Family is worried about safety and response time if something happens.",
          whyNow: "Recent health decline increased urgency.",
          evidence: "Prospect described parent living alone and recent health concerns.",
          evidenceType: "prospect_fact",
          confidence: "high",
        },
      ],
      type2Pain: [
        {
          statement: "Prior contractor communication left them uncertain about cost and schedule.",
          evidence: "Prospect referenced a past remodel with poor updates.",
          evidenceType: "prospect_fact",
          confidence: "medium",
        },
      ],
      budget: {
        statedBudget: {
          value: "400000",
          evidenceType: "prospect_fact",
          evidence: "Prospect said about four hundred thousand all-in.",
          confidence: "medium",
        },
        range: "350000-450000",
        target: {
          value: "400000",
          evidenceType: "prospect_fact",
          confidence: "medium",
        },
        hardCeiling: null,
        scope: "All-in including site work (as stated by prospect; unverified).",
        fundingSource: "Home equity mentioned; not confirmed.",
        firmness: "Working target, not confirmed hard ceiling.",
        competitorAnchors: [
          {
            source: "Local GC verbal estimate",
            amount: "380000",
            evidence: "Prospect mentioned another builder around 380k.",
          },
        ],
        advisorEstimates: [
          {
            description: "Advisor ballpark for similar ADU",
            amount: "420000-480000",
            evidence: "Advisor shared a range; not customer commitment.",
          },
        ],
        risks: ["Site/utility costs not verified."],
        unknowns: ["Final Acton pricing not established."],
        summary:
          "Customer working target ~$400k all-in; competitor and advisor figures remain distinct.",
      },
      decisionProcess: {
        decisionMakers: [
          {
            value: "Prospect and spouse",
            evidenceType: "prospect_fact",
            evidence: "Both must agree before proceeding.",
            confidence: "high",
          },
        ],
        absentStakeholders: ["Spouse not present on this call"],
        financialApprovers: [],
        designDecisionMakers: [],
        criteria: ["Communication", "Transparent pricing", "Schedule clarity"],
        alternatives: ["Local GC"],
        process: "Discuss with spouse, then decide on design meeting.",
        timing: {
          value: "Within two weeks",
          evidenceType: "prospect_fact",
          confidence: "medium",
        },
        missingInformation: ["Spouse preferences not captured."],
        summary: "Joint decision with spouse; follow-up timing soft.",
      },
      schedule: {
        decisionTiming: {
          value: "Within two weeks",
          evidenceType: "prospect_fact",
          confidence: "medium",
        },
        desiredStart: {
          value: "This year if possible",
          evidenceType: "prospect_fact",
          confidence: "low",
        },
        desiredCompletion: null,
        drivers: ["Parent health"],
        flexibility: "Somewhat flexible on start if process is clear.",
        dependencies: ["Spouse alignment", "Site verification"],
        summary: "Desire to start this year; decision timing within ~two weeks.",
      },
      competitionAlternatives: ["Local general contractor estimate"],
      actonRecommendation: {
        fit: "Promising fit if budget and site realities align.",
        reasoning: "Type 1 motivation is strong; Type 2 and budget verification remain open.",
      },
      nextSteps: {
        prospect: ["Discuss with spouse", "Share any survey/site docs"],
        acton: ["Send follow-up email", "Propose design/feasibility next step"],
      },
      meetingOutcome: {
        classification: "DECISION_DATE",
        explanation:
          "Prospect agreed to reconnect within two weeks after speaking with spouse; not a hard YES to proceed.",
      },
      qualification: {
        classification: "QUALIFIED_WITH_RISKS",
        reasoning:
          "Clear Type 1 motivation and a working budget; spouse decision and site costs are open risks.",
        risks: [
          "Absent spouse",
          "Unverified site/utility costs",
          "Budget may be tight vs advisor range",
        ],
      },
    },
    assessment: {
      categories,
      topStrengths: [
        "Opened with a clear meeting purpose.",
        "Uncovered a meaningful why-now around parent health.",
        "Kept a collaborative tone throughout.",
      ],
      topImprovements: [
        "When the homeowner explained parent vulnerability, ask one consequence question before square footage.",
        "Secure a firmer next-step commitment rather than a soft reconnect.",
        "Separate competitor quotes from Acton estimates when discussing budget.",
      ],
      oneThing:
        "When the homeowner explained that their parent's health is declining, ask one consequence question before moving into project requirements.",
    },
    followUpEmail: {
      subject: `Following up on our conversation — ${input.prospectName}`,
      body: `Hi ${input.prospectName.split(" ")[0] ?? input.prospectName},

Thank you for taking the time to meet with me. I appreciated learning more about your goals for creating a comfortable, independent space for your parent nearby.

Based on what you shared, you are looking for a clear process, transparent communication, and a plan that fits your household timeline. You mentioned reconnecting within about two weeks after you speak with your spouse.

I will follow up as discussed. In the meantime, feel free to send any site documents or questions that come up.

Best regards,
${input.advisorName}`,
    },
    projectIntelligence: {
      facts: [
        {
          topic: "Desired ADU purpose",
          value: "Independent living space for aging parent",
          status: "HOMEOWNER_REPORTED",
          evidence: "Prospect stated use case for parent.",
          evidenceType: "prospect_fact",
        },
        {
          topic: "Electrical panel",
          value: "Existing panel reportedly 100A; upgrade requirement has not been confirmed.",
          status: "UNKNOWN_NEEDS_VERIFICATION",
          evidence: "Prospect mentioned older panel; not verified.",
          evidenceType: "prospect_fact",
        },
      ],
      summary: "Parent ADU concept; site and utility conditions need verification.",
    },
    productionNotes: ["Verify panel capacity and site access before design assumptions."],
    internalOpportunityNotes:
      "Promising opportunity: strong Type 1 driver (aging parent independence), working ~$400k all-in target, spouse decision pending. Competitor GC ~$380k mentioned. Advisor range higher — budget alignment is the largest qualification risk. Follow-up priority: medium-high within two weeks. Outcome: DECISION_DATE.",
    buildertrendFields: {
      notesForInternalUsers: "Parent ADU opportunity; spouse not on call; reconnect in ~2 weeks.",
      squareFeet: null,
      customerBudget: 400000,
      customerStory: "Evaluating ADU so aging parent can live nearby with independence.",
      customerPain1:
        "Parent living alone is increasingly difficult; family wants proximity and safety.",
      customerPain:
        "Prior contractor communication issues create concern about cost/schedule clarity.",
      customerPriorities: ["Communication", "Transparency", "Quality"],
      customerPrioritiesOther: null,
      designHandoff: null,
      decisionMakingProcess: "Prospect and spouse must both agree; spouse was absent.",
      decisionDynamics: "Joint household decision; follow-up after spouse discussion.",
      knownConcernsOrFears: "Uncertainty after prior contractor communication issues.",
      mustHaveFeatures: null,
      siteConstraints: null,
      soilUtilityNotes: "Panel reportedly 100A — needs verification.",
      levelOfInvolvement: null,
      internalStrategyNotes:
        "Customer stated ~$400k all-in target; site work and utilities unverified.",
      projectIntelligence:
        "Parent ADU concept; electrical/site conditions unknown and need verification.",
      scheduleGoals: "Prefer start this year if process is clear; decision in ~2 weeks.",
      preferredContactMethod: null,
      salesCommitments: "Reconnect within about two weeks.",
      personalityTraits: null,
      assumptionsDuringSales: "Assumed spouse alignment not yet confirmed.",
      scopeClarifications: "All-in budget discussion included site work as stated by prospect.",
      bedBathCount: null,
      accessibilityRequirement: null,
      cityZoningFeedback: null,
      accessConstructionIssue: null,
      responsivenessExpected: null,
      nextSteps: "Prospect: discuss with spouse. Acton: send follow-up and propose next meeting.",
      recommendedBrModels: null,
      projectType: null,
      projectTypeOther: null,
    },
    analysisMetadata: {
      transcriptComplete: true,
      speakersLabeled: true,
      timestampsAvailable: false,
      appearsToBePem: true,
      attributionConfidence: "medium",
      limitations: ["Mock generation mode."],
      stage0Notes: ["Synthetic fixture transcript accepted for mock generation."],
    },
  };
}
