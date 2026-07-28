/**
 * Evidence coverage + empty-shell detection for PEM NEAT.
 * Structural validity ≠ semantic success.
 */
import type { PemNeatStructuredResult } from "./schemas";
import { ASSESSMENT_CATEGORY_KEYS } from "./constants";

export type TranscriptEvidenceSignals = {
  charCount: number;
  wordCount: number;
  currencyMentions: number;
  squareFootageMentions: number;
  timelineMentions: number;
  nextStepMentions: number;
  questionMarks: number;
  looksSubstantive: boolean;
};

export type FactCoverageScore = {
  customerStory: boolean;
  customerPain: boolean;
  type1Count: number;
  type2Count: number;
  budgetSignal: boolean;
  decisionSignal: boolean;
  nextStepsCount: number;
  projectFactsCount: number;
  determinableAssessments: number;
  totalScore: number;
  maxScore: number;
  ratio: number;
  isSuspiciouslyEmpty: boolean;
};

const PLACEHOLDER_RE =
  /^(not established|not enough evidence|outcome not yet established|qualification not yet established|thank you for meeting with us\. we will follow up)/i;

export function analyzeTranscriptSignals(transcript: string): TranscriptEvidenceSignals {
  const text = transcript.trim();
  const wordCount = text ? text.split(/\s+/).length : 0;
  const currencyMentions = (
    text.match(/\$[\d,]+|\b\d{2,3}\s*k\b|\b\d{3},\d{3}\b|\bbudget\b/gi) ?? []
  ).length;
  const squareFootageMentions = (text.match(/\b\d{2,4}\s*(sf|sq\.?\s*ft|square\s*feet)\b/gi) ?? [])
    .length;
  const timelineMentions = (
    text.match(
      /\b(week|weeks|month|months|year|schedule|timeline|start|complete|by\s+\d{4})\b/gi,
    ) ?? []
  ).length;
  const nextStepMentions = (
    text.match(
      /\b(next step|follow[- ]?up|I'll send|I will send|reconnect|schedule|agreement)\b/gi,
    ) ?? []
  ).length;
  const questionMarks = (text.match(/\?/g) ?? []).length;

  const looksSubstantive =
    wordCount >= 400 ||
    (wordCount >= 200 && (currencyMentions >= 1 || nextStepMentions >= 1 || questionMarks >= 3));

  return {
    charCount: text.length,
    wordCount,
    currencyMentions,
    squareFootageMentions,
    timelineMentions,
    nextStepMentions,
    questionMarks,
    looksSubstantive,
  };
}

function hasText(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return !PLACEHOLDER_RE.test(value.trim());
}

function budgetHasSignal(budget: PemNeatStructuredResult["salesIntelligence"]["budget"]): boolean {
  return Boolean(
    hasText(budget.summary) ||
    hasText(budget.range) ||
    hasText(budget.scope) ||
    hasText(budget.fundingSource) ||
    hasText(budget.firmness) ||
    hasText(budget.target?.value) ||
    hasText(budget.statedBudget?.value) ||
    hasText(budget.hardCeiling?.value) ||
    budget.competitorAnchors.length > 0 ||
    budget.advisorEstimates.length > 0,
  );
}

function decisionHasSignal(
  decision: PemNeatStructuredResult["salesIntelligence"]["decisionProcess"],
): boolean {
  return Boolean(
    hasText(decision.summary) ||
    hasText(decision.process) ||
    decision.decisionMakers.length > 0 ||
    decision.criteria.length > 0 ||
    decision.alternatives.length > 0 ||
    decision.timing?.value,
  );
}

/** Score how much grounded sales intelligence exists in the structured result. */
export function scoreFactCoverage(
  result: PemNeatStructuredResult,
  signals: TranscriptEvidenceSignals,
): FactCoverageScore {
  const si = result.salesIntelligence;
  const customerStory = hasText(si.customerStory);
  const customerPain = hasText(si.customerPain);
  const type1Count = si.type1Pain.filter((p) => hasText(p.statement)).length;
  const type2Count = si.type2Pain.filter((p) => hasText(p.statement)).length;
  const budgetSignal = budgetHasSignal(si.budget);
  const decisionSignal = decisionHasSignal(si.decisionProcess);
  const nextStepsCount = si.nextSteps.prospect.length + si.nextSteps.acton.length;
  const projectFactsCount = result.projectIntelligence.facts.filter(
    (f) => hasText(f.topic) && (hasText(f.value) || f.status !== "UNKNOWN_NEEDS_VERIFICATION"),
  ).length;
  const determinableAssessments = result.assessment.categories.filter(
    (c) => c.status !== "NOT_DETERMINABLE" && c.status !== "N_A" && c.score != null,
  ).length;

  let totalScore = 0;
  if (customerStory) totalScore += 2;
  if (customerPain) totalScore += 2;
  if (type1Count > 0) totalScore += 2;
  if (type2Count > 0) totalScore += 1;
  if (budgetSignal) totalScore += 2;
  if (decisionSignal) totalScore += 2;
  if (nextStepsCount > 0) totalScore += 1;
  if (projectFactsCount > 0) totalScore += 1;
  if (determinableAssessments >= 3) totalScore += 2;
  else if (determinableAssessments >= 1) totalScore += 1;

  const maxScore = 15;
  const ratio = totalScore / maxScore;

  // Substantive transcript + near-empty extraction = pathology
  const isSuspiciouslyEmpty =
    signals.looksSubstantive &&
    totalScore <= 2 &&
    !customerStory &&
    type1Count === 0 &&
    !budgetSignal &&
    projectFactsCount === 0;

  return {
    customerStory,
    customerPain,
    type1Count,
    type2Count,
    budgetSignal,
    decisionSignal,
    nextStepsCount,
    projectFactsCount,
    determinableAssessments,
    totalScore,
    maxScore,
    ratio,
    isSuspiciouslyEmpty,
  };
}

/** Mean of determinable 1–10 scores; excludes NOT_DETERMINABLE / N_A / null. */
export function computeOverallScore(
  categories: PemNeatStructuredResult["assessment"]["categories"],
): number | null {
  const scores = categories
    .filter((c) => c.status !== "NOT_DETERMINABLE" && c.status !== "N_A" && c.score != null)
    .map((c) => c.score as number);
  if (scores.length === 0) return null;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(mean * 10) / 10;
}

export function isEmptyShellResult(result: PemNeatStructuredResult): boolean {
  const coverage = scoreFactCoverage(result, {
    charCount: 10_000,
    wordCount: 1000,
    currencyMentions: 2,
    squareFootageMentions: 0,
    timelineMentions: 2,
    nextStepMentions: 2,
    questionMarks: 5,
    looksSubstantive: true,
  });
  return coverage.isSuspiciouslyEmpty || coverage.totalScore <= 2;
}

export function expectedCategoryKeys() {
  return ASSESSMENT_CATEGORY_KEYS;
}
