/**
 * Server-side defaults for structurally required NEAT pieces.
 * Model fills content; code owns keys/boilerplate.
 */
import {
  ASSESSMENT_CATEGORY_KEYS,
  ASSESSMENT_CATEGORY_LABELS,
  INTERNAL_NOTES_MAX_CHARS,
  type AssessmentCategoryKey,
} from "./constants";
import type { AssessmentCategory, BuildertrendFields, PemNeatStructuredResult } from "./schemas";
import { buildertrendFieldsSchema } from "./schemas";

export function emptyBuildertrendFields(): BuildertrendFields {
  return buildertrendFieldsSchema.parse({});
}

export function defaultAssessmentCategories(): AssessmentCategory[] {
  return ASSESSMENT_CATEGORY_KEYS.map((key) => ({
    key,
    label: ASSESSMENT_CATEGORY_LABELS[key],
    score: null,
    status: "NOT_DETERMINABLE" as const,
    evidence: "Not enough evidence to assess.",
    whatWorked: null,
    coachingOpportunity: "Not enough evidence to assess.",
    timestamps: [],
    ...(key === "palo_upfront_contract"
      ? {
          palo: {
            purpose: { status: "NOT_DETERMINABLE" as const, evidence: null, notes: null },
            agenda: { status: "NOT_DETERMINABLE" as const, evidence: null, notes: null },
            logistics: { status: "NOT_DETERMINABLE" as const, evidence: null, notes: null },
            outcome: { status: "NOT_DETERMINABLE" as const, evidence: null, notes: null },
          },
        }
      : {}),
  }));
}

export function mergeBuildertrendFields(
  partial: Partial<BuildertrendFields> | Record<string, unknown> | null | undefined,
): BuildertrendFields {
  const base = emptyBuildertrendFields();
  if (!partial || typeof partial !== "object") return base;
  return buildertrendFieldsSchema.parse({ ...base, ...partial });
}

export function mergeAssessmentCategories(
  incoming: AssessmentCategory[] | undefined,
): AssessmentCategory[] {
  const byKey = new Map<AssessmentCategoryKey, AssessmentCategory>();
  for (const category of incoming ?? []) {
    if (category?.key) byKey.set(category.key, category);
  }
  return ASSESSMENT_CATEGORY_KEYS.map((key) => {
    const found = byKey.get(key);
    if (!found) {
      return defaultAssessmentCategories().find((c) => c.key === key)!;
    }
    return {
      ...found,
      label: ASSESSMENT_CATEGORY_LABELS[key],
    };
  });
}

export function clampInternalNotes(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (text.length <= INTERNAL_NOTES_MAX_CHARS) return text;
  return text.slice(0, INTERNAL_NOTES_MAX_CHARS);
}

/** Build a structurally complete NEAT shell; stages fill content. */
export function emptyPemNeatShell(input: {
  prospectName: string;
  advisorName: string;
  meetingDate?: string | null;
}): PemNeatStructuredResult {
  return {
    metadata: {
      prospectName: input.prospectName,
      advisorName: input.advisorName,
      meetingDate: input.meetingDate ?? null,
      transcriptQuality: "medium",
      limitations: [],
    },
    salesIntelligence: {
      customerStory: null,
      customerPain: null,
      type1Pain: [],
      type2Pain: [],
      budget: {
        competitorAnchors: [],
        advisorEstimates: [],
        risks: [],
        unknowns: [],
      },
      decisionProcess: {
        decisionMakers: [],
        absentStakeholders: [],
        financialApprovers: [],
        designDecisionMakers: [],
        criteria: [],
        alternatives: [],
        missingInformation: [],
      },
      schedule: {
        drivers: [],
        dependencies: [],
      },
      competitionAlternatives: [],
      actonRecommendation: {},
      nextSteps: { prospect: [], acton: [] },
      meetingOutcome: {
        classification: "DECISION_DATE_NOT_SECURED",
        explanation: "Outcome not yet established from transcript evidence.",
      },
      qualification: {
        classification: "EARLY_EXPLORATORY",
        reasoning: "Qualification not yet established from transcript evidence.",
        risks: [],
      },
    },
    assessment: {
      categories: defaultAssessmentCategories(),
      topStrengths: [],
      topImprovements: [],
      oneThing: "Not enough evidence to determine The One Thing.",
    },
    followUpEmail: {
      subject: null,
      body: "Thank you for meeting with us. We will follow up with next steps based on our conversation.",
    },
    projectIntelligence: { facts: [] },
    productionNotes: [],
    internalOpportunityNotes: "",
    buildertrendFields: emptyBuildertrendFields(),
    analysisMetadata: {
      transcriptComplete: false,
      speakersLabeled: false,
      timestampsAvailable: false,
      appearsToBePem: true,
      attributionConfidence: "unknown",
      limitations: [],
      stage0Notes: [],
    },
  };
}
