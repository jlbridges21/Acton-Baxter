/**
 * PEM NEAT domain constants.
 * Governing docs: docs/pem-neat/01–03 (versioned product rules).
 */
export const PEM_NEAT_STANDARD_VERSION = "1.0.0" as const;

export const PEM_NEAT_STATUSES = [
  "draft",
  "generating",
  "completed",
  "failed",
  "needs_regeneration",
] as const;
export type PemNeatStatus = (typeof PEM_NEAT_STATUSES)[number];

/** Human-readable library/detail status labels. */
export const PEM_NEAT_STATUS_LABELS: Record<PemNeatStatus, string> = {
  draft: "Draft",
  generating: "Generating",
  completed: "Completed",
  failed: "Failed",
  needs_regeneration: "Needs Regeneration",
};

export const MEETING_OUTCOMES = [
  "YES",
  "NO",
  "DECISION_DATE",
  "DECISION_DATE_NOT_SECURED",
] as const;
export type MeetingOutcome = (typeof MEETING_OUTCOMES)[number];

export const QUALIFICATION_LEVELS = [
  "STRONGLY_QUALIFIED",
  "QUALIFIED_WITH_RISKS",
  "EARLY_EXPLORATORY",
  "WEAKLY_QUALIFIED",
  "DISQUALIFIED",
] as const;
export type QualificationLevel = (typeof QUALIFICATION_LEVELS)[number];

export const ASSESSMENT_STATUSES = [
  "COMPLETED",
  "PARTIAL",
  "MISSED",
  "N_A",
  "NOT_DETERMINABLE",
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const EVIDENCE_TYPES = [
  "prospect_fact",
  "advisor_statement",
  "analyst_inference",
  "unknown",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const PROJECT_FACT_STATUSES = [
  "CONFIRMED",
  "HOMEOWNER_REPORTED",
  "ADVISOR_ESTIMATE",
  "UNKNOWN_NEEDS_VERIFICATION",
] as const;
export type ProjectFactStatus = (typeof PROJECT_FACT_STATUSES)[number];

/** Required assessment categories (Acton PEM grading). */
export const ASSESSMENT_CATEGORY_KEYS = [
  "bonding_rapport",
  "palo_upfront_contract",
  "type1_pain",
  "type2_pain",
  "budget",
  "decision_making_process",
  "schedule",
  "summary",
  "fulfillment_solution_positioning",
  "outcome_close",
  "post_sell",
  "overall_process_control",
] as const;
export type AssessmentCategoryKey = (typeof ASSESSMENT_CATEGORY_KEYS)[number];

export const ASSESSMENT_CATEGORY_LABELS: Record<AssessmentCategoryKey, string> = {
  bonding_rapport: "Bonding & Rapport",
  palo_upfront_contract: "PALO / Up-Front Contract",
  type1_pain: "Type 1 Pain — Why Build an ADU?",
  type2_pain: "Type 2 Pain — Why Acton / the Right Partner?",
  budget: "Budget",
  decision_making_process: "Decision-Making Process",
  schedule: "Schedule",
  summary: "Summary",
  fulfillment_solution_positioning: "Fulfillment / Solution Positioning",
  outcome_close: "Outcome / Close",
  post_sell: "Post-Sell",
  overall_process_control: "Overall Process Control",
};

export const CUSTOMER_PRIORITIES = [
  "Cost",
  "Speed",
  "Design",
  "ROI",
  "Flexibility",
  "Thoroughness",
  "Communication",
  "Transparency",
  "Quality",
  "Turnkey",
  "Risk management",
  "Other",
] as const;
export type CustomerPriority = (typeof CUSTOMER_PRIORITIES)[number];

export const PREFERRED_CONTACT_METHODS = ["Phone", "Email", "Text"] as const;
export type PreferredContactMethod = (typeof PREFERRED_CONTACT_METHODS)[number];

export const BED_BATH_COUNTS = [
  "0 Bed / 1 Bath",
  "1 Bed / 1 Bath",
  "1 Bed / 1.5 Bath",
  "1 Bed / 2 Bath",
  "1 Bed + Office / 1 Bath",
  "1 Bed + Office / 1.5 Bath",
  "1 Bed + Office / 2 Bath",
  "2 Bed / 1 Bath",
  "2 Bed / 1.5 Bath",
  "2 Bed / 2 Bath",
  "3 Bed / 2 Bath",
] as const;
export type BedBathCount = (typeof BED_BATH_COUNTS)[number];

export const PROJECT_TYPES = [
  "BR - Investor Series",
  "BR - Investor + Series",
  "BR - Signature Series",
  "BR - Age in Place Series",
  "BR - Bonus Series",
  "BR - Garage Conversion",
  "Attached ADU",
  "Attached Garage",
  "Detached Garage",
  "Remodel",
  "Custom ADU",
  "Other",
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Minimum transcript length for Stage 0 validation (chars). */
export const MIN_TRANSCRIPT_CHARS = 200;

/** Internal opportunity notes hard limit. */
export const INTERNAL_NOTES_MAX_CHARS = 2500;
