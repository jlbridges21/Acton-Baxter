import { z } from "zod";
import {
  ASSESSMENT_CATEGORY_KEYS,
  ASSESSMENT_CATEGORY_LABELS,
  ASSESSMENT_STATUSES,
  BED_BATH_COUNTS,
  CUSTOMER_PRIORITIES,
  EVIDENCE_TYPES,
  INTERNAL_NOTES_MAX_CHARS,
  MEETING_OUTCOMES,
  PREFERRED_CONTACT_METHODS,
  PROJECT_FACT_STATUSES,
  PROJECT_TYPES,
  QUALIFICATION_LEVELS,
  type AssessmentCategoryKey,
} from "./constants";

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** Coerce currency/strings from models into number | null. */
export const nullableNumberSchema = z.preprocess((value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}, z.number().nullable());

const nullableScoreSchema = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(10, Math.max(1, n)));
}, z.number().int().min(1).max(10).nullable());

export const evidenceTypeSchema = z.enum(EVIDENCE_TYPES);
export const assessmentStatusSchema = z.enum(ASSESSMENT_STATUSES);
export const meetingOutcomeSchema = z.enum(MEETING_OUTCOMES);
export const qualificationSchema = z.enum(QUALIFICATION_LEVELS);
export const projectFactStatusSchema = z.enum(PROJECT_FACT_STATUSES);

/** Provenance-aware value used where reliability matters. */
export const evidencedValueSchema = z.object({
  value: z.string().nullable(),
  evidenceType: evidenceTypeSchema.default("unknown"),
  evidence: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low", "unknown"]).optional().default("unknown"),
});

export const painItemSchema = z.object({
  statement: z.string().min(1),
  surfaceReason: z.string().nullable().optional(),
  deeperConsequence: z.string().nullable().optional(),
  whyNow: z.string().nullable().optional(),
  presentConsequence: z.string().nullable().optional(),
  futureConsequence: z.string().nullable().optional(),
  importance: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
  evidenceType: evidenceTypeSchema.optional().default("prospect_fact"),
  confidence: z.enum(["high", "medium", "low", "unknown"]).optional().default("medium"),
});

export const budgetSchema = z.object({
  statedBudget: evidencedValueSchema.nullable().optional(),
  range: z.string().nullable().optional(),
  target: evidencedValueSchema.nullable().optional(),
  hardCeiling: evidencedValueSchema.nullable().optional(),
  scope: z.string().nullable().optional(),
  fundingSource: z.string().nullable().optional(),
  firmness: z.string().nullable().optional(),
  competitorAnchors: z
    .array(
      z.object({
        source: z.string().nullable().optional(),
        amount: z.string().nullable().optional(),
        evidence: z.string().nullable().optional(),
      }),
    )
    .default([]),
  advisorEstimates: z
    .array(
      z.object({
        description: z.string().nullable().optional(),
        amount: z.string().nullable().optional(),
        evidence: z.string().nullable().optional(),
      }),
    )
    .default([]),
  risks: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  summary: z.string().nullable().optional(),
});

export const decisionProcessSchema = z.object({
  decisionMakers: z.array(evidencedValueSchema).default([]),
  absentStakeholders: z.array(z.string()).default([]),
  financialApprovers: z.array(evidencedValueSchema).default([]),
  designDecisionMakers: z.array(evidencedValueSchema).default([]),
  criteria: z.array(z.string()).default([]),
  alternatives: z.array(z.string()).default([]),
  process: z.string().nullable().optional(),
  timing: evidencedValueSchema.nullable().optional(),
  missingInformation: z.array(z.string()).default([]),
  summary: z.string().nullable().optional(),
});

export const scheduleSchema = z.object({
  decisionTiming: evidencedValueSchema.nullable().optional(),
  desiredStart: evidencedValueSchema.nullable().optional(),
  desiredCompletion: evidencedValueSchema.nullable().optional(),
  drivers: z.array(z.string()).default([]),
  flexibility: z.string().nullable().optional(),
  dependencies: z.array(z.string()).default([]),
  summary: z.string().nullable().optional(),
});

export const paloDetailSchema = z.object({
  purpose: z.object({
    status: assessmentStatusSchema,
    evidence: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  agenda: z.object({
    status: assessmentStatusSchema,
    evidence: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  logistics: z.object({
    status: assessmentStatusSchema,
    evidence: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  outcome: z.object({
    status: assessmentStatusSchema,
    evidence: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
});

export const assessmentCategorySchema = z.object({
  key: z.enum(ASSESSMENT_CATEGORY_KEYS),
  label: z.string().min(1),
  score: nullableScoreSchema,
  status: assessmentStatusSchema.catch("NOT_DETERMINABLE"),
  evidence: z.string().nullable().optional(),
  whatWorked: z.string().nullable().optional(),
  coachingOpportunity: z.string().nullable().optional(),
  timestamps: z.array(z.string()).optional().default([]),
  palo: paloDetailSchema.optional(),
});

export const projectFactSchema = z.object({
  topic: z.string().min(1),
  value: z.string().nullable(),
  status: projectFactStatusSchema.default("UNKNOWN_NEEDS_VERIFICATION"),
  evidence: z.string().nullable().optional(),
  evidenceType: evidenceTypeSchema.optional().default("unknown"),
});

/**
 * BuilderTrend Custom Fields — 31 fields (Prompt 3 UI; Prompt 1 schema).
 * Prefer null / not established over guesses.
 */
export const buildertrendFieldsSchema = z.object({
  notesForInternalUsers: z.string().nullable().default(null),
  squareFeet: nullableNumberSchema.default(null),
  /** Customer's working/top-end budget as a number when defensible; else null. */
  customerBudget: nullableNumberSchema.default(null),
  customerStory: z.string().nullable().default(null),
  customerPain1: z.string().nullable().default(null),
  customerPain: z.string().nullable().default(null),
  customerPriorities: z
    .array(z.enum(CUSTOMER_PRIORITIES))
    .catch([])
    .default([]),
  customerPrioritiesOther: z.string().nullable().default(null),
  designHandoff: z.string().nullable().default(null),
  decisionMakingProcess: z.string().nullable().default(null),
  decisionDynamics: z.string().nullable().default(null),
  knownConcernsOrFears: z.string().nullable().default(null),
  mustHaveFeatures: z.string().nullable().default(null),
  siteConstraints: z.string().nullable().default(null),
  soilUtilityNotes: z.string().nullable().default(null),
  levelOfInvolvement: z.string().nullable().default(null),
  internalStrategyNotes: z.string().nullable().default(null),
  projectIntelligence: z.string().nullable().default(null),
  scheduleGoals: z.string().nullable().default(null),
  preferredContactMethod: z
    .enum(PREFERRED_CONTACT_METHODS)
    .nullable()
    .catch(null)
    .default(null),
  salesCommitments: z.string().nullable().default(null),
  personalityTraits: z.string().nullable().default(null),
  assumptionsDuringSales: z.string().nullable().default(null),
  scopeClarifications: z.string().nullable().default(null),
  bedBathCount: z.enum(BED_BATH_COUNTS).nullable().catch(null).default(null),
  accessibilityRequirement: z.string().nullable().default(null),
  cityZoningFeedback: z.string().nullable().default(null),
  accessConstructionIssue: z.string().nullable().default(null),
  responsivenessExpected: z.string().nullable().default(null),
  nextSteps: z.string().nullable().default(null),
  recommendedBrModels: z.string().nullable().default(null),
  projectType: z.enum(PROJECT_TYPES).nullable().catch(null).default(null),
  projectTypeOther: z.string().nullable().default(null),
});

export const analysisMetadataSchema = z.object({
  transcriptComplete: z.boolean().default(false),
  speakersLabeled: z.boolean().default(false),
  timestampsAvailable: z.boolean().default(false),
  appearsToBePem: z.boolean().default(true),
  attributionConfidence: z.enum(["high", "medium", "low", "unknown"]).default("unknown"),
  limitations: z.array(z.string()).default([]),
  stage0Notes: z.array(z.string()).default([]),
});

export const salesIntelligenceSchema = z.object({
  customerStory: z.string().nullable().optional(),
  customerPain: z.string().nullable().optional(),
  type1Pain: z.array(painItemSchema).default([]),
  type2Pain: z.array(painItemSchema).default([]),
  budget: budgetSchema.default(() => ({
    competitorAnchors: [],
    advisorEstimates: [],
    risks: [],
    unknowns: [],
  })),
  decisionProcess: decisionProcessSchema.default(() => ({
    decisionMakers: [],
    absentStakeholders: [],
    financialApprovers: [],
    designDecisionMakers: [],
    criteria: [],
    alternatives: [],
    missingInformation: [],
  })),
  schedule: scheduleSchema.default(() => ({
    drivers: [],
    dependencies: [],
  })),
  competitionAlternatives: z.array(z.string()).default([]),
  actonRecommendation: z
    .object({
      fit: z.string().nullable().optional(),
      reasoning: z.string().nullable().optional(),
    })
    .default(() => ({})),
  nextSteps: z
    .object({
      prospect: z.array(z.string()).default([]),
      acton: z.array(z.string()).default([]),
    })
    .default(() => ({ prospect: [], acton: [] })),
  meetingOutcome: z.object({
    classification: meetingOutcomeSchema,
    explanation: z.string().min(1),
  }),
  qualification: z.object({
    classification: qualificationSchema,
    reasoning: z.string().min(1),
    risks: z.array(z.string()).default([]),
  }),
});

export const assessmentSchema = z.object({
  /** Accept partial lists; parsePemNeatStructuredResult fills missing categories. */
  categories: z.array(assessmentCategorySchema).min(1).max(20),
  topStrengths: z.array(z.string()).max(3).default([]),
  topImprovements: z.array(z.string()).max(3).default([]),
  oneThing: z.string().min(1),
});

export const followUpEmailSchema = z.object({
  subject: z.string().nullable().optional(),
  body: z.string().min(1),
});

export const projectIntelligenceSchema = z.object({
  facts: z.array(projectFactSchema).default([]),
  summary: z.string().nullable().optional(),
});

/** Full structured AI output contract. */
export const pemNeatStructuredResultSchema = z.object({
  metadata: z.object({
    prospectName: z.string().min(1),
    advisorName: z.string().min(1),
    meetingDate: z.string().nullable().optional(),
    transcriptQuality: z.enum(["high", "medium", "low", "poor"]).default("medium"),
    limitations: z.array(z.string()).default([]),
  }),
  salesIntelligence: salesIntelligenceSchema,
  assessment: assessmentSchema,
  followUpEmail: followUpEmailSchema,
  projectIntelligence: projectIntelligenceSchema.default(() => ({ facts: [] })),
  productionNotes: z.array(z.string()).default([]),
  internalOpportunityNotes: z.string().max(INTERNAL_NOTES_MAX_CHARS).default(""),
  buildertrendFields: buildertrendFieldsSchema.default(() => ({
    notesForInternalUsers: null,
    squareFeet: null,
    customerBudget: null,
    customerStory: null,
    customerPain1: null,
    customerPain: null,
    customerPriorities: [],
    customerPrioritiesOther: null,
    designHandoff: null,
    decisionMakingProcess: null,
    decisionDynamics: null,
    knownConcernsOrFears: null,
    mustHaveFeatures: null,
    siteConstraints: null,
    soilUtilityNotes: null,
    levelOfInvolvement: null,
    internalStrategyNotes: null,
    projectIntelligence: null,
    scheduleGoals: null,
    preferredContactMethod: null,
    salesCommitments: null,
    personalityTraits: null,
    assumptionsDuringSales: null,
    scopeClarifications: null,
    bedBathCount: null,
    accessibilityRequirement: null,
    cityZoningFeedback: null,
    accessConstructionIssue: null,
    responsivenessExpected: null,
    nextSteps: null,
    recommendedBrModels: null,
    projectType: null,
    projectTypeOther: null,
  })),
  analysisMetadata: analysisMetadataSchema.default(() => ({
    transcriptComplete: false,
    speakersLabeled: false,
    timestampsAvailable: false,
    appearsToBePem: true,
    attributionConfidence: "unknown" as const,
    limitations: [],
    stage0Notes: [],
  })),
});

export type PemNeatStructuredResult = z.infer<typeof pemNeatStructuredResultSchema>;
export type BuildertrendFields = z.infer<typeof buildertrendFieldsSchema>;
export type AssessmentCategory = z.infer<typeof assessmentCategorySchema>;

export const createPemNeatInputSchema = z.object({
  prospectName: z.string().trim().min(1, "Prospect name is required").max(300),
  salespersonUserId: z.string().uuid("Select a valid salesperson"),
  meetingDate: z
    .preprocess(
      emptyToNull,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    )
    .optional()
    .nullable(),
  transcript: z
    .string()
    .trim()
    .min(1, "Transcript is required")
    .refine((t) => t.replace(/\s+/g, " ").length >= 200, {
      message:
        "Transcript appears too short for a Partnership Evaluation Meeting. Paste the full meeting transcript.",
    }),
});

export type CreatePemNeatInput = z.infer<typeof createPemNeatInputSchema>;

/** Soft post-generation checks (deterministic). */
const INTERNAL_EMAIL_TERMS =
  /\b(type\s*[12]\s*pain|qualification|STRONGLY_QUALIFIED|WEAKLY_QUALIFIED|DISQUALIFIED|coaching|score\s*\/\s*10|process control|PALO)\b/i;

export function validateFollowUpEmailCustomerSafe(body: string): string[] {
  const issues: string[] = [];
  if (INTERNAL_EMAIL_TERMS.test(body)) {
    issues.push("Follow-up email contains internal sales terminology");
  }
  return issues;
}

export function assertAssessmentCategoriesComplete(categories: AssessmentCategory[]): string[] {
  const keys = new Set(categories.map((c) => c.key));
  const missing = ASSESSMENT_CATEGORY_KEYS.filter((k) => !keys.has(k));
  return missing.map((k) => `Missing assessment category: ${k}`);
}

function placeholderCategory(key: AssessmentCategoryKey): AssessmentCategory {
  return {
    key,
    label: ASSESSMENT_CATEGORY_LABELS[key],
    score: null,
    status: "NOT_DETERMINABLE",
    evidence: "Category was missing from model output; marked not determinable.",
    whatWorked: null,
    coachingOpportunity: null,
    timestamps: [],
  };
}

/** Ensure exactly the 12 required categories (fill gaps; drop unknown duplicates). */
export function normalizeAssessmentCategories(
  categories: AssessmentCategory[],
): AssessmentCategory[] {
  const byKey = new Map<AssessmentCategoryKey, AssessmentCategory>();
  for (const category of categories) {
    if (!byKey.has(category.key)) {
      byKey.set(category.key, category);
    }
  }
  return ASSESSMENT_CATEGORY_KEYS.map(
    (key) => byKey.get(key) ?? placeholderCategory(key),
  );
}

/** Soften internal sales language in customer-facing email without rejecting the NEAT. */
export function sanitizeCustomerEmailBody(body: string): string {
  return body
    .replace(/\bType\s*[12]\s*pain\b/gi, "priorities")
    .replace(/\b(STRONGLY_QUALIFIED|QUALIFIED_WITH_RISKS|EARLY_EXPLORATORY|WEAKLY_QUALIFIED|DISQUALIFIED)\b/g, "")
    .replace(/\bqualification\b/gi, "fit")
    .replace(/\bcoaching\b/gi, "follow-up")
    .replace(/\bscore\s*\/\s*10\b/gi, "")
    .replace(/\bPALO\b/g, "meeting structure")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parsePemNeatStructuredResult(raw: unknown): PemNeatStructuredResult {
  const parsed = pemNeatStructuredResultSchema.parse(raw);
  parsed.assessment.categories = normalizeAssessmentCategories(parsed.assessment.categories);

  const emailIssues = validateFollowUpEmailCustomerSafe(parsed.followUpEmail.body);
  if (emailIssues.length) {
    parsed.followUpEmail = {
      ...parsed.followUpEmail,
      body: sanitizeCustomerEmailBody(parsed.followUpEmail.body),
    };
    parsed.analysisMetadata = {
      ...parsed.analysisMetadata,
      limitations: [
        ...(parsed.analysisMetadata.limitations ?? []),
        ...emailIssues.map((i) => `Sanitized follow-up email: ${i}`),
      ],
    };
  }

  // Truncate overlong internal notes rather than failing the whole NEAT.
  if (parsed.internalOpportunityNotes.length > INTERNAL_NOTES_MAX_CHARS) {
    parsed.internalOpportunityNotes = parsed.internalOpportunityNotes.slice(
      0,
      INTERNAL_NOTES_MAX_CHARS,
    );
  }

  return parsed;
}
