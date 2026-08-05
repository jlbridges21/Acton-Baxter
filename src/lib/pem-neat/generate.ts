import "server-only";

import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { OpenAiReasoningEffort } from "@/lib/openai/capabilities";
import { ASSESSMENT_CATEGORY_LABELS, PEM_NEAT_STANDARD_VERSION } from "./constants";
import {
  analyzeTranscriptSignals,
  computeOverallScore,
  scoreFactCoverage,
  type FactCoverageScore,
} from "./coverage";
import {
  emptyPemNeatShell,
  mergeAssessmentCategories,
  mergeBuildertrendFields,
  clampInternalNotes,
} from "./defaults";
import {
  countFactLedgerItems,
  emptyFactLedger,
  mergeFactLedgers,
  tryParseFactLedger,
  type FactLedger,
} from "./fact-ledger";
import { buildMockPemNeatResult } from "./mock-result";
import {
  callPemOpenAiJsonWithRetries,
  getPemNeatStageTimeoutMs,
  resolvePemNeatFallbackModel,
  resolvePemNeatModelName,
} from "./openai-client";
import {
  buildAssessmentCorrectionPrompt,
  buildAssessmentStagePrompt,
  buildCorrectionStagePrompt,
  buildEmailStagePrompt,
  buildFactLedgerStagePrompt,
  buildHandoffStagePrompt,
  buildPemNeatUserPrompt,
  buildQualityReviewStagePrompt,
  buildRecoveryFactPrompt,
  buildSalesIntelligenceCorrectionPrompt,
  buildSalesIntelligenceStagePrompt,
} from "./prompts";
import {
  ASSESSMENT_JSON_SCHEMA,
  mapAssessmentStageToCanonical,
  parseAssessmentStage,
  PEM_NEAT_ASSESSMENT_SCHEMA_VERSION,
  type AssessmentStageOutput,
} from "./assessment-stage";
import {
  applyHandoffStageToShell,
  EMAIL_JSON_SCHEMA,
  HANDOFF_JSON_SCHEMA,
  parseEmailStage,
  parseHandoffStage,
  parseQualityReviewStage,
  QUALITY_REVIEW_JSON_SCHEMA,
} from "./downstream-stages";
import {
  parsePemNeatStructuredResult,
  assessmentSchema,
  type PemNeatStructuredResult,
} from "./schemas";
import {
  extractBudgetCandidatesFromLedger,
  factLedgerSemanticCounts,
  mapSalesIntelligenceStageToCanonical,
  parseSalesIntelligenceStage,
  PEM_NEAT_FACT_LEDGER_SCHEMA_VERSION,
  PEM_NEAT_GENERATION_SCHEMA_VERSION,
  SALES_INTELLIGENCE_JSON_SCHEMA,
  type SalesIntelligenceStageOutput,
} from "./sales-intelligence-stage";
import {
  chunkTranscript,
  detectTranscriptLikelyIncomplete,
  stage0ValidateTranscript,
} from "./transcript";
import {
  completeStage,
  createPemGenerationTrace,
  employeeFacingPemError,
  failTrace,
  normalizePemErrorCode,
  startStage,
  succeedTrace,
  type PemGenerationTrace,
} from "./trace";
import { runDeterministicNeatChecks } from "./validate";

export type GeneratePemNeatInput = {
  prospectName: string;
  advisorName: string;
  meetingDate?: string | null;
  transcript: string;
  /** Optional progress callback for durable status (no transcript). */
  onProgress?: (update: PemGenerationProgressUpdate) => Promise<void> | void;
  /** Resume from prior stage outputs when available. */
  priorStageOutputs?: PemStageOutputs | null;
};

export type PemStageOutputs = {
  /** Overall generation contract version (SI synthesis). */
  schemaVersion?: number;
  /** Fact Ledger evidence contract version. */
  factLedgerSchemaVersion?: number;
  /** Assessment stage contract version. */
  assessmentSchemaVersion?: number;
  factLedger?: FactLedger | null;
  /** Simple stage B output (preferred for resume). */
  salesIntelligenceStage?: SalesIntelligenceStageOutput | null;
  /** Canonical NEAT salesIntelligence after mapping. */
  salesIntelligence?: Record<string, unknown> | null;
  /** Simple stage C output (preferred for resume). */
  assessmentStage?: AssessmentStageOutput | null;
  assessment?: Record<string, unknown> | null;
  followUpEmail?: Record<string, unknown> | null;
  handoff?: Record<string, unknown> | null;
  qualityReview?: Record<string, unknown> | null;
  validationDiagnostics?: {
    stage?: string;
    issues?: string[];
    shape?: string[];
    correctionAttempted?: boolean;
  } | null;
};

export type PemGenerationProgressUpdate = {
  stage: string;
  status: "generating" | "completed" | "failed";
  trace: PemGenerationTrace;
  stageOutputs: PemStageOutputs;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type GeneratePemNeatOutput = {
  result: PemNeatStructuredResult;
  modelProvider: string;
  modelName: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usedMock: boolean;
  stage0Notes: string[];
  transcriptStrategy: "full" | "chunked";
  diagnostics: {
    stages: string[];
    finishReasons: string[];
    validationIssues: string[];
    coverage?: FactCoverageScore;
    recoveryUsed?: boolean;
    overallScore?: number | null;
    chunkCount?: number;
    modelConfigured?: string;
    api?: string;
    usedFallback?: boolean;
    trace?: PemGenerationTrace;
    stageOutputs?: PemStageOutputs;
    qualityReview?: Record<string, unknown> | null;
  };
};

/** Stage token budgets — room to succeed; prompts still ask for concise structure. */
const STAGE_BUDGETS = {
  fact_ledger: { tokens: 24_000, effort: "high" as OpenAiReasoningEffort },
  fact_ledger_merge: { tokens: 16_000, effort: "high" as OpenAiReasoningEffort },
  sales_intelligence: { tokens: 16_000, effort: "high" as OpenAiReasoningEffort },
  assessment: { tokens: 16_000, effort: "high" as OpenAiReasoningEffort },
  email: { tokens: 6_000, effort: "medium" as OpenAiReasoningEffort },
  handoff: { tokens: 16_000, effort: "high" as OpenAiReasoningEffort },
  quality_review: { tokens: 10_000, effort: "high" as OpenAiReasoningEffort },
  correction: { tokens: 12_000, effort: "medium" as OpenAiReasoningEffort },
};

/** Prefer full transcript when estimated prompt+output fits GPT-5.4 context. */
const FULL_TRANSCRIPT_CHAR_LIMIT = 180_000;

function shouldUseMock(): boolean {
  // Prefer process.env — getEnv() can be stale across vi.resetModules() in unit tests.
  const mock = (process.env.ENABLE_MOCK_RESEARCH ?? "true").toLowerCase();
  if (mock === "true" || mock === "1") {
    return process.env.NODE_ENV !== "production";
  }
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

export function getPemNeatModelName(): string {
  return resolvePemNeatModelName();
}

function zodIssueSummary(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
  }
  if (error instanceof Error) return error.message.slice(0, 500);
  return "schema validation failed";
}

function stageMaxTokens(fallback: number): number {
  const raw = process.env.PEM_NEAT_MAX_OUTPUT_TOKENS;
  if (raw && /^\d+$/.test(raw)) {
    return Math.min(Math.max(Number(raw), 2_000), 64_000);
  }
  return fallback;
}

function isFatalPemProviderError(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  return (
    error.code === "AI_NOT_CONFIGURED" ||
    error.code === "PEM_NEAT_PROVIDER_ERROR" ||
    error.code === "PEM_NEAT_PROVIDER_REQUEST_INVALID" ||
    error.code === "PEM_NEAT_MODEL_NOT_AVAILABLE" ||
    error.code === "PEM_NEAT_RATE_LIMITED" ||
    error.code === "PEM_NEAT_QUOTA_EXCEEDED" ||
    error.code === "PEM_NEAT_TIMEOUT" ||
    error.code === "PEM_NEAT_OUTPUT_TRUNCATED" ||
    error.code === "PEM_NEAT_PROVIDER_INCOMPLETE" ||
    error.code === "PEM_NEAT_PROVIDER_REFUSAL" ||
    error.code === "PEM_NEAT_EMPTY_OUTPUT" ||
    error.code.startsWith("PEM_")
  );
}

function pemError(code: string, message?: string): AppError {
  const normalized = normalizePemErrorCode(code);
  return new AppError(message ?? employeeFacingPemError(normalized), {
    code: normalized,
    statusCode: 502,
  });
}

function parseJsonStrict(content: string, code: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw pemError(code, employeeFacingPemError(code));
  }
}

function normalizeCategoryLabels(result: PemNeatStructuredResult): PemNeatStructuredResult {
  return {
    ...result,
    assessment: {
      ...result.assessment,
      categories: mergeAssessmentCategories(result.assessment.categories).map((c) => ({
        ...c,
        label: ASSESSMENT_CATEGORY_LABELS[c.key] ?? c.label,
      })),
    },
    buildertrendFields: mergeBuildertrendFields(result.buildertrendFields),
    internalOpportunityNotes: clampInternalNotes(result.internalOpportunityNotes),
  };
}

type ProviderJsonResult = {
  content: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  api?: string;
  usedFallback?: boolean;
};

async function callStageJson(input: {
  system: string;
  user: string;
  maxTokens: number;
  reasoningEffort: OpenAiReasoningEffort;
  jsonSchema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
}): Promise<ProviderJsonResult> {
  const model = getPemNeatModelName();
  const result = await callPemOpenAiJsonWithRetries(
    {
      model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      maxOutputTokens: stageMaxTokens(input.maxTokens),
      temperature: 0.25,
      reasoningEffort: input.reasoningEffort,
      timeoutMs: getPemNeatStageTimeoutMs(),
      jsonSchema: input.jsonSchema,
    },
    {
      maxAttempts: 2,
      fallbackModel: resolvePemNeatFallbackModel(),
    },
  );
  return {
    content: result.content,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    finishReason: result.finishReason,
    api: result.api,
    usedFallback: result.usedFallback,
  };
}

function ledgerIsEmpty(ledger: FactLedger): boolean {
  return countFactLedgerItems(ledger) < 3;
}

function applySalesIntelligenceFromStage(
  shell: PemNeatStructuredResult,
  stage: SalesIntelligenceStageOutput,
) {
  shell.salesIntelligence = {
    ...shell.salesIntelligence,
    ...mapSalesIntelligenceStageToCanonical(stage),
  };
}

function tryResumeSalesIntelligence(
  shell: PemNeatStructuredResult,
  outputs: PemStageOutputs,
): boolean {
  if (outputs.salesIntelligenceStage) {
    const parsed = parseSalesIntelligenceStage(outputs.salesIntelligenceStage);
    if (parsed.ok) {
      applySalesIntelligenceFromStage(shell, parsed.data);
      return true;
    }
  }
  // Legacy: canonical already stored from a prior successful map (same generation schema)
  const si = outputs.salesIntelligence;
  const genVersion = outputs.schemaVersion ?? 0;
  if (
    genVersion >= PEM_NEAT_GENERATION_SCHEMA_VERSION &&
    si &&
    typeof si === "object" &&
    typeof (si as { customerStory?: unknown }).customerStory === "string"
  ) {
    shell.salesIntelligence = {
      ...shell.salesIntelligence,
      ...(si as PemNeatStructuredResult["salesIntelligence"]),
    };
    return true;
  }
  return false;
}

function canResumeFactLedger(outputs: PemStageOutputs): boolean {
  const ledger = outputs.factLedger;
  if (!ledger || ledgerIsEmpty(ledger)) return false;
  const flVersion = outputs.factLedgerSchemaVersion ?? 1;
  return flVersion >= PEM_NEAT_FACT_LEDGER_SCHEMA_VERSION;
}

function applyAssessmentFromStage(shell: PemNeatStructuredResult, stage: AssessmentStageOutput) {
  const mapped = mapAssessmentStageToCanonical(stage);
  shell.assessment = mapped.assessment;
  if (mapped.meetingOutcome) {
    shell.salesIntelligence.meetingOutcome = mapped.meetingOutcome;
  }
  if (mapped.qualification) {
    shell.salesIntelligence.qualification = mapped.qualification;
  }
}

function tryResumeAssessment(shell: PemNeatStructuredResult, outputs: PemStageOutputs): boolean {
  if (outputs.assessmentStage) {
    const parsed = parseAssessmentStage(outputs.assessmentStage);
    if (parsed.ok) {
      applyAssessmentFromStage(shell, parsed.data);
      return true;
    }
  }
  const persisted = outputs.assessment as
    | {
        assessment?: PemNeatStructuredResult["assessment"];
        categories?: PemNeatStructuredResult["assessment"]["categories"];
        topStrengths?: string[];
        topImprovements?: string[];
        oneThing?: string;
        meetingOutcome?: PemNeatStructuredResult["salesIntelligence"]["meetingOutcome"];
        qualification?: PemNeatStructuredResult["salesIntelligence"]["qualification"];
      }
    | null
    | undefined;
  if (!persisted || typeof persisted !== "object") return false;
  const nested = persisted.assessment ?? persisted;
  if (!Array.isArray(nested.categories) || nested.categories.length === 0) return false;
  shell.assessment = {
    categories: mergeAssessmentCategories(nested.categories),
    topStrengths: nested.topStrengths ?? [],
    topImprovements: nested.topImprovements ?? [],
    oneThing: nested.oneThing?.trim() || shell.assessment.oneThing,
  };
  if (persisted.meetingOutcome) {
    shell.salesIntelligence.meetingOutcome = persisted.meetingOutcome;
  }
  if (persisted.qualification) {
    shell.salesIntelligence.qualification = persisted.qualification;
  }
  return true;
}

function applyIncompleteEndingAssessmentGuard(shell: PemNeatStructuredResult, incomplete: boolean) {
  if (!incomplete) return;
  shell.assessment.categories = shell.assessment.categories.map((cat) => {
    if (cat.key !== "outcome_close" && cat.key !== "post_sell") return cat;
    if (cat.status === "NOT_DETERMINABLE") return cat;
    return {
      ...cat,
      score: null,
      status: "NOT_DETERMINABLE" as const,
      evidence:
        cat.evidence?.trim() ||
        "Meeting ending not fully observed in transcript; Outcome/Close and Post-Sell cannot be scored confidently.",
      coachingOpportunity:
        cat.coachingOpportunity ??
        "Ensure the full meeting ending is captured so Outcome and Post-Sell can be evaluated.",
    };
  });
}

/**
 * Multi-stage PEM generation:
 * Fact Ledger → Sales Intelligence → Assessment → Email → Handoff → Quality Review → (optional correction)
 */
export async function generatePemNeat(input: GeneratePemNeatInput): Promise<GeneratePemNeatOutput> {
  const started = Date.now();
  const generationId = randomUUID();
  const stage0 = stage0ValidateTranscript(input.transcript);
  if (!stage0.ok) {
    throw new AppError(stage0.error ?? "Invalid transcript", {
      code: "PEM_NEAT_TRANSCRIPT_INVALID",
      statusCode: 400,
    });
  }
  const stage0Notes = stage0.notes;
  const signals = analyzeTranscriptSignals(input.transcript);
  const preferFull = input.transcript.length <= FULL_TRANSCRIPT_CHAR_LIMIT;
  const chunks = preferFull
    ? [{ index: 0, total: 1, label: "full" as const, text: input.transcript }]
    : chunkTranscript(input.transcript);
  const strategy: "full" | "chunked" = chunks.length === 1 ? "full" : "chunked";

  const timestampsDetected = /\b\d{1,2}:\d{2}(:\d{2})?\b/.test(input.transcript);
  const speakersDetected =
    /^(speaker|advisor|salesperson|prospect|homeowner|customer|jesse|client)\b/im.test(
      input.transcript,
    ) || /:\s/.test(input.transcript.slice(0, 2000));

  const trace = createPemGenerationTrace({
    generationId,
    transcriptChars: input.transcript.length,
    chunkCount: chunks.length,
    timestampsDetected,
    speakersDetected,
  });

  const diagnostics: GeneratePemNeatOutput["diagnostics"] = {
    stages: [],
    finishReasons: [],
    validationIssues: [...stage0Notes],
    chunkCount: chunks.length,
    modelConfigured: getPemNeatModelName(),
    recoveryUsed: false,
    stageOutputs: input.priorStageOutputs ?? {},
    qualityReview: null,
  };

  const stageOutputs: PemStageOutputs = { ...(input.priorStageOutputs ?? {}) };

  async function emitProgress(stage: string) {
    diagnostics.trace = trace;
    diagnostics.stageOutputs = stageOutputs;
    await input.onProgress?.({
      stage,
      status: "generating",
      trace,
      stageOutputs,
    });
  }

  if (shouldUseMock()) {
    const result = normalizeCategoryLabels(
      parsePemNeatStructuredResult(
        buildMockPemNeatResult({
          prospectName: input.prospectName,
          advisorName: input.advisorName,
          meetingDate: input.meetingDate,
        }),
      ),
    );
    const overallScore = computeOverallScore(result.assessment.categories);
    result.analysisMetadata = {
      ...result.analysisMetadata,
      stage0Notes,
      limitations: [...(result.analysisMetadata.limitations ?? []), ...stage0Notes],
      overallScore,
    } as typeof result.analysisMetadata & { overallScore?: number | null };
    succeedTrace(trace);
    diagnostics.stages = ["mock"];
    diagnostics.trace = trace;
    diagnostics.overallScore = overallScore;
    return {
      result,
      modelProvider: "mock",
      modelName: "mock-pem-neat",
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      usedMock: true,
      stage0Notes,
      transcriptStrategy: strategy,
      diagnostics,
    };
  }

  let modelName = getPemNeatModelName();
  let inputTokens = 0;
  let outputTokens = 0;
  const shell = emptyPemNeatShell({
    prospectName: input.prospectName,
    advisorName: input.advisorName,
    meetingDate: input.meetingDate,
  });

  try {
    // -------- Stage A: Fact Ledger --------
    let ledger: FactLedger = stageOutputs.factLedger ?? emptyFactLedger();
    if (!canResumeFactLedger(stageOutputs)) {
      stageOutputs.factLedger = null;
      ledger = emptyFactLedger();
      const prep = startStage(trace, "transcript_prep");
      completeStage(prep, {
        status: "completed",
        validationStatus: "ok",
        extractedItemCounts: { chunks: chunks.length, strategy: strategy === "full" ? 1 : 0 },
      });
      diagnostics.stages.push("transcript_prep");
      await emitProgress("extracting_facts");

      const ledgerParts: FactLedger[] = [];
      for (const chunk of chunks) {
        const stage = startStage(trace, "fact_ledger", {
          model: modelName,
          provider: "openai",
          attempt: chunk.index + 1,
        });
        diagnostics.stages.push("fact_ledger");
        try {
          const user = buildPemNeatUserPrompt({
            prospectName: input.prospectName,
            advisorName: input.advisorName,
            meetingDate: input.meetingDate ?? null,
            transcript: chunk.text,
            transcriptNotes: [
              ...stage0Notes,
              chunks.length > 1
                ? `Chunk ${chunk.index + 1}/${chunk.total} (${chunk.label}). Extract facts from this segment.`
                : "Full transcript provided — analyze the entire meeting.",
            ],
          });
          const res = await callStageJson({
            system: buildFactLedgerStagePrompt(),
            user,
            maxTokens: STAGE_BUDGETS.fact_ledger.tokens,
            reasoningEffort: STAGE_BUDGETS.fact_ledger.effort,
          });
          modelName = res.model;
          inputTokens += res.inputTokens ?? 0;
          outputTokens += res.outputTokens ?? 0;
          if (res.api) diagnostics.api = res.api;
          if (res.usedFallback) diagnostics.usedFallback = true;
          diagnostics.finishReasons.push(res.finishReason ?? "unknown");

          const raw = parseJsonStrict(res.content, "PEM_FACT_LEDGER_SCHEMA_INVALID");
          const parsed = tryParseFactLedger(raw);
          if (!parsed.ok && ledgerIsEmpty(parsed.ledger)) {
            completeStage(stage, {
              status: "failed",
              validationStatus: "failed",
              validationIssues: parsed.issues,
              outputCharacters: res.content.length,
              finishReason: res.finishReason,
              errorCode: "PEM_FACT_LEDGER_SCHEMA_INVALID",
              api: res.api ?? null,
            });
            throw pemError("PEM_FACT_LEDGER_SCHEMA_INVALID");
          }
          ledgerParts.push(parsed.ledger);
          completeStage(stage, {
            status: "completed",
            validationStatus: parsed.ok ? "ok" : "soft_issues",
            validationIssues: parsed.issues,
            outputCharacters: res.content.length,
            finishReason: res.finishReason,
            extractedItemCounts: { items: countFactLedgerItems(parsed.ledger) },
            api: res.api ?? null,
            model: res.model,
          });
          if (parsed.issues.length) {
            diagnostics.validationIssues.push(...parsed.issues.map((i) => `fact_ledger: ${i}`));
          }
        } catch (error) {
          if (isFatalPemProviderError(error)) {
            completeStage(stage, {
              status: "failed",
              validationStatus: "failed",
              errorCode: error instanceof AppError ? error.code : "PEM_FACT_EXTRACTION_FAILED",
            });
            throw error;
          }
          throw error;
        }
      }

      if (chunks.length > 1) {
        const mergeStage = startStage(trace, "fact_ledger_merge", {
          model: modelName,
          provider: "openai",
        });
        diagnostics.stages.push("fact_ledger_merge");
        try {
          const res = await callStageJson({
            system: `${buildFactLedgerStagePrompt()}

MERGE / RECONCILE overlapping Fact Ledger fragments chronologically.
Keep distinct budget meanings (ideal vs stretch). Deduplicate paraphrases. Return one Fact Ledger JSON.`,
            user: `Prospect: ${input.prospectName}\nAdvisor: ${input.advisorName}\n\nFragments:\n${JSON.stringify(ledgerParts).slice(0, 100_000)}`,
            maxTokens: STAGE_BUDGETS.fact_ledger_merge.tokens,
            reasoningEffort: STAGE_BUDGETS.fact_ledger_merge.effort,
          });
          modelName = res.model;
          inputTokens += res.inputTokens ?? 0;
          outputTokens += res.outputTokens ?? 0;
          diagnostics.finishReasons.push(res.finishReason ?? "unknown");
          const raw = parseJsonStrict(res.content, "PEM_FACT_LEDGER_SCHEMA_INVALID");
          const parsed = tryParseFactLedger(raw);
          ledger =
            parsed.ok || !ledgerIsEmpty(parsed.ledger)
              ? parsed.ledger
              : mergeFactLedgers(ledgerParts);
          completeStage(mergeStage, {
            status: "completed",
            validationStatus: parsed.ok ? "ok" : "soft_issues",
            validationIssues: parsed.issues,
            outputCharacters: res.content.length,
            finishReason: res.finishReason,
            extractedItemCounts: { items: countFactLedgerItems(ledger) },
            model: res.model,
            api: res.api ?? null,
          });
        } catch (error) {
          ledger = mergeFactLedgers(ledgerParts);
          completeStage(mergeStage, {
            status: "completed",
            validationStatus: "soft_issues",
            validationIssues: ["merge model failed — used deterministic fragment merge"],
            extractedItemCounts: { items: countFactLedgerItems(ledger) },
          });
          if (isFatalPemProviderError(error) && ledgerIsEmpty(ledger)) throw error;
        }
      } else {
        ledger = ledgerParts[0] ?? emptyFactLedger();
      }

      // Recovery if empty against substantive transcript
      if (ledgerIsEmpty(ledger) && signals.looksSubstantive) {
        diagnostics.recoveryUsed = true;
        const recovery = startStage(trace, "fact_ledger_recovery", {
          model: modelName,
          provider: "openai",
        });
        diagnostics.stages.push("fact_ledger_recovery");
        await emitProgress("extracting_facts");
        try {
          const res = await callStageJson({
            system: buildRecoveryFactPrompt([
              "customerContext",
              "motivation",
              "partnerConcerns",
              "budget",
              "decision",
              "project",
              "nextSteps",
            ]),
            user: buildPemNeatUserPrompt({
              prospectName: input.prospectName,
              advisorName: input.advisorName,
              meetingDate: input.meetingDate ?? null,
              transcript: input.transcript.slice(0, FULL_TRANSCRIPT_CHAR_LIMIT),
              transcriptNotes: stage0Notes,
            }),
            maxTokens: STAGE_BUDGETS.fact_ledger.tokens,
            reasoningEffort: STAGE_BUDGETS.fact_ledger.effort,
          });
          modelName = res.model;
          inputTokens += res.inputTokens ?? 0;
          outputTokens += res.outputTokens ?? 0;
          diagnostics.finishReasons.push(res.finishReason ?? "unknown");
          const raw = parseJsonStrict(res.content, "PEM_FACT_RECOVERY_FAILED");
          const parsed = tryParseFactLedger(raw);
          ledger = parsed.ledger;
          completeStage(recovery, {
            status: ledgerIsEmpty(ledger) ? "failed" : "completed",
            validationStatus: ledgerIsEmpty(ledger) ? "failed" : parsed.ok ? "ok" : "soft_issues",
            validationIssues: parsed.issues,
            outputCharacters: res.content.length,
            finishReason: res.finishReason,
            extractedItemCounts: { items: countFactLedgerItems(ledger) },
            errorCode: ledgerIsEmpty(ledger) ? "PEM_FACT_RECOVERY_FAILED" : null,
            model: res.model,
            api: res.api ?? null,
          });
        } catch (error) {
          completeStage(recovery, {
            status: "failed",
            errorCode: error instanceof AppError ? error.code : "PEM_FACT_RECOVERY_FAILED",
          });
          if (isFatalPemProviderError(error)) throw error;
          throw pemError("PEM_FACT_RECOVERY_FAILED");
        }
      }

      if (ledgerIsEmpty(ledger) && signals.looksSubstantive) {
        throw pemError("PEM_FACT_EXTRACTION_EMPTY");
      }

      stageOutputs.factLedger = ledger;
      stageOutputs.factLedgerSchemaVersion = PEM_NEAT_FACT_LEDGER_SCHEMA_VERSION;
      stageOutputs.schemaVersion = PEM_NEAT_GENERATION_SCHEMA_VERSION;
      await emitProgress("extracting_facts");
    } else {
      ledger = stageOutputs.factLedger!;
      stageOutputs.factLedgerSchemaVersion =
        stageOutputs.factLedgerSchemaVersion ?? PEM_NEAT_FACT_LEDGER_SCHEMA_VERSION;
      diagnostics.stages.push("fact_ledger_resume");
      const resumeStage = startStage(trace, "fact_ledger");
      completeStage(resumeStage, {
        status: "completed",
        validationStatus: "ok",
        validationIssues: ["Resumed persisted Fact Ledger (not re-run)."],
        extractedItemCounts: { items: countFactLedgerItems(ledger) },
      });
      await emitProgress("extracting_facts");
    }

    // -------- Stage B: Sales Intelligence --------
    await emitProgress("building_sales_intelligence");
    stageOutputs.schemaVersion = PEM_NEAT_GENERATION_SCHEMA_VERSION;

    const resumedSi = tryResumeSalesIntelligence(shell, stageOutputs);
    if (!resumedSi) {
      const stage = startStage(trace, "sales_intelligence", {
        model: modelName,
        provider: "openai",
      });
      diagnostics.stages.push("sales_intelligence");
      const budgetCandidates = extractBudgetCandidatesFromLedger(ledger);
      const ledgerCounts = factLedgerSemanticCounts(ledger);
      diagnostics.validationIssues.push(`fact_ledger_counts: ${JSON.stringify(ledgerCounts)}`);

      const siUser = `Prospect: ${input.prospectName}
Advisor: ${input.advisorName}

Budget candidates extracted from Fact Ledger (interpret; do not invent):
${budgetCandidates.length ? budgetCandidates.map((b) => `- ${b}`).join("\n") : "- none listed"}

Fact Ledger (primary source — synthesize sales intelligence from this):
${JSON.stringify(ledger).slice(0, 120_000)}

Optional transcript excerpt for clarification only (do not rediscover everything):
${input.transcript.slice(0, 40_000)}`;

      try {
        const res = await callStageJson({
          system: buildSalesIntelligenceStagePrompt(),
          user: siUser,
          maxTokens: STAGE_BUDGETS.sales_intelligence.tokens,
          reasoningEffort: STAGE_BUDGETS.sales_intelligence.effort,
          jsonSchema: {
            name: "pem_sales_intelligence",
            schema: SALES_INTELLIGENCE_JSON_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        });
        modelName = res.model;
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        if (res.api) diagnostics.api = res.api;
        diagnostics.finishReasons.push(res.finishReason ?? "unknown");

        let raw: unknown;
        try {
          raw = parseJsonStrict(res.content, "PEM_SALES_INTELLIGENCE_SCHEMA_INVALID");
        } catch {
          throw pemError("PEM_SALES_INTELLIGENCE_SCHEMA_INVALID");
        }

        let parsed = parseSalesIntelligenceStage(raw);
        if (!parsed.ok) {
          stageOutputs.validationDiagnostics = {
            stage: "sales_intelligence",
            issues: parsed.issues,
            shape: parsed.shape,
          };
          diagnostics.validationIssues.push(
            ...parsed.issues.map((i) => `sales_intelligence: ${i}`),
          );

          // One structure-only correction pass
          const corrRes = await callStageJson({
            system: buildSalesIntelligenceCorrectionPrompt(),
            user: `Validation issues (paths/types only):
${parsed.issues.join("\n")}

Invalid JSON to correct (preserve meaning):
${res.content.slice(0, 60_000)}`,
            maxTokens: STAGE_BUDGETS.sales_intelligence.tokens,
            reasoningEffort: "medium",
            jsonSchema: {
              name: "pem_sales_intelligence",
              schema: SALES_INTELLIGENCE_JSON_SCHEMA as unknown as Record<string, unknown>,
              strict: true,
            },
          });
          modelName = corrRes.model;
          inputTokens += corrRes.inputTokens ?? 0;
          outputTokens += corrRes.outputTokens ?? 0;
          diagnostics.finishReasons.push(corrRes.finishReason ?? "unknown");
          diagnostics.stages.push("sales_intelligence_correction");

          const corrRaw = parseJsonStrict(corrRes.content, "PEM_SALES_INTELLIGENCE_SCHEMA_INVALID");
          parsed = parseSalesIntelligenceStage(corrRaw);
          if (!parsed.ok) {
            stageOutputs.validationDiagnostics = {
              stage: "sales_intelligence",
              issues: parsed.issues,
              shape: parsed.shape,
            };
            completeStage(stage, {
              status: "failed",
              validationStatus: "failed",
              validationIssues: parsed.issues,
              errorCode: "PEM_SALES_INTELLIGENCE_SCHEMA_INVALID",
              outputCharacters: corrRes.content.length,
              finishReason: corrRes.finishReason,
              model: corrRes.model,
              api: corrRes.api ?? null,
            });
            throw pemError("PEM_SALES_INTELLIGENCE_SCHEMA_INVALID");
          }
        }

        applySalesIntelligenceFromStage(shell, parsed.data);
        stageOutputs.salesIntelligenceStage = parsed.data;
        stageOutputs.salesIntelligence = shell.salesIntelligence as unknown as Record<
          string,
          unknown
        >;
        stageOutputs.schemaVersion = PEM_NEAT_GENERATION_SCHEMA_VERSION;
        stageOutputs.validationDiagnostics = null;
        completeStage(stage, {
          status: "completed",
          validationStatus: "ok",
          outputCharacters: res.content.length,
          finishReason: res.finishReason,
          model: res.model,
          api: res.api ?? null,
          extractedItemCounts: {
            type1: parsed.data.type1Pain.drivers.length,
            type2: parsed.data.type2Pain.drivers.length,
            alternatives: parsed.data.decisionProcess.alternatives.length,
          },
        });
      } catch (error) {
        completeStage(stage, {
          status: "failed",
          errorCode:
            error instanceof AppError ? error.code : "PEM_SALES_INTELLIGENCE_SCHEMA_INVALID",
        });
        throw error instanceof AppError ? error : pemError("PEM_SALES_INTELLIGENCE_SCHEMA_INVALID");
      }
    } else {
      stageOutputs.schemaVersion = PEM_NEAT_GENERATION_SCHEMA_VERSION;
    }

    const incompleteness = detectTranscriptLikelyIncomplete(input.transcript);
    const siIncomplete =
      Boolean(
        (stageOutputs.salesIntelligenceStage as SalesIntelligenceStageOutput | null | undefined)
          ?.meetingOutcome?.transcriptIncomplete,
      ) || incompleteness.likelyIncomplete;
    if (incompleteness.notes.length) {
      diagnostics.validationIssues.push(...incompleteness.notes);
    }

    await emitProgress("evaluating_sales");

    // Coverage gate after SI
    let coverage = scoreFactCoverage(shell, signals);
    diagnostics.coverage = coverage;
    if (coverage.isSuspiciouslyEmpty && signals.looksSubstantive) {
      throw pemError("PEM_LOW_EVIDENCE_COVERAGE");
    }

    // -------- Stage C: Assessment --------
    const resumedAssessment = tryResumeAssessment(shell, stageOutputs);
    if (!resumedAssessment) {
      const stage = startStage(trace, "assessment", { model: modelName, provider: "openai" });
      diagnostics.stages.push("assessment");
      try {
        const res = await callStageJson({
          system: buildAssessmentStagePrompt(),
          user: `Prospect: ${input.prospectName}
Advisor: ${input.advisorName}
TranscriptIncompleteHint: ${siIncomplete}

Fact Ledger (context):
${JSON.stringify(ledger).slice(0, 80_000)}

Validated Sales Intelligence (context — do not grade the customer from this alone):
${JSON.stringify(shell.salesIntelligence).slice(0, 40_000)}

FULL TRANSCRIPT — grade SALESPERSON behavior from observable questions, follow-ups, summaries, positioning, and close:
${input.transcript.slice(0, FULL_TRANSCRIPT_CHAR_LIMIT)}`,
          maxTokens: STAGE_BUDGETS.assessment.tokens,
          reasoningEffort: STAGE_BUDGETS.assessment.effort,
          jsonSchema: {
            name: "pem_assessment",
            schema: ASSESSMENT_JSON_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        });
        modelName = res.model;
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        diagnostics.finishReasons.push(res.finishReason ?? "unknown");

        let raw: unknown;
        try {
          raw = parseJsonStrict(res.content, "PEM_ASSESSMENT_SCHEMA_INVALID");
        } catch {
          throw pemError("PEM_ASSESSMENT_SCHEMA_INVALID");
        }

        let parsed = parseAssessmentStage(raw);
        if (!parsed.ok) {
          stageOutputs.validationDiagnostics = {
            stage: "assessment",
            issues: parsed.issues,
            shape: parsed.shape,
            correctionAttempted: true,
          };
          diagnostics.validationIssues.push(...parsed.issues.map((i) => `assessment: ${i}`));

          const corrRes = await callStageJson({
            system: buildAssessmentCorrectionPrompt(),
            user: `Validation issues (paths/types only):
${parsed.issues.join("\n")}

Invalid JSON to correct (preserve meaning):
${res.content.slice(0, 60_000)}`,
            maxTokens: STAGE_BUDGETS.assessment.tokens,
            reasoningEffort: "medium",
            jsonSchema: {
              name: "pem_assessment",
              schema: ASSESSMENT_JSON_SCHEMA as unknown as Record<string, unknown>,
              strict: true,
            },
          });
          modelName = corrRes.model;
          inputTokens += corrRes.inputTokens ?? 0;
          outputTokens += corrRes.outputTokens ?? 0;
          diagnostics.stages.push("assessment_correction");

          const corrRaw = parseJsonStrict(corrRes.content, "PEM_ASSESSMENT_SCHEMA_INVALID");
          parsed = parseAssessmentStage(corrRaw);
          if (!parsed.ok) {
            stageOutputs.validationDiagnostics = {
              stage: "assessment",
              issues: parsed.issues,
              shape: parsed.shape,
              correctionAttempted: true,
            };
            completeStage(stage, {
              status: "failed",
              validationStatus: "failed",
              validationIssues: parsed.issues,
              errorCode: "PEM_ASSESSMENT_SCHEMA_INVALID",
              outputCharacters: corrRes.content.length,
              finishReason: corrRes.finishReason,
              model: corrRes.model,
              api: corrRes.api ?? null,
            });
            throw pemError("PEM_ASSESSMENT_SCHEMA_INVALID");
          }
        }

        applyAssessmentFromStage(shell, parsed.data);
        applyIncompleteEndingAssessmentGuard(shell, siIncomplete);
        stageOutputs.assessmentStage = parsed.data;
        stageOutputs.assessmentSchemaVersion = PEM_NEAT_ASSESSMENT_SCHEMA_VERSION;
        stageOutputs.assessment = {
          assessment: shell.assessment,
          meetingOutcome: shell.salesIntelligence.meetingOutcome,
          qualification: shell.salesIntelligence.qualification,
        };
        stageOutputs.validationDiagnostics = null;
        completeStage(stage, {
          status: "completed",
          validationStatus: "ok",
          outputCharacters: res.content.length,
          finishReason: res.finishReason,
          model: res.model,
          api: res.api ?? null,
          extractedItemCounts: {
            determinable: shell.assessment.categories.filter(
              (c) => c.status !== "NOT_DETERMINABLE" && c.score != null,
            ).length,
          },
        });
      } catch (error) {
        completeStage(stage, {
          status: "failed",
          errorCode: error instanceof AppError ? error.code : "PEM_ASSESSMENT_SCHEMA_INVALID",
        });
        throw error instanceof AppError ? error : pemError("PEM_ASSESSMENT_SCHEMA_INVALID");
      }
    } else {
      applyIncompleteEndingAssessmentGuard(shell, siIncomplete);
      stageOutputs.assessmentSchemaVersion =
        stageOutputs.assessmentSchemaVersion ?? PEM_NEAT_ASSESSMENT_SCHEMA_VERSION;
    }

    // -------- Stage D: Email --------
    await emitProgress("generating_handoff");
    if (!stageOutputs.followUpEmail) {
      const stage = startStage(trace, "email", { model: modelName, provider: "openai" });
      diagnostics.stages.push("email");
      try {
        const res = await callStageJson({
          system: buildEmailStagePrompt(),
          user: `Prospect: ${input.prospectName}
Advisor: ${input.advisorName}

Validated sales intelligence (customer-safe facts only):
${JSON.stringify({
  customerStory: shell.salesIntelligence.customerStory,
  customerPain: shell.salesIntelligence.customerPain,
  nextSteps: shell.salesIntelligence.nextSteps,
  schedule: shell.salesIntelligence.schedule,
  actonRecommendation: shell.salesIntelligence.actonRecommendation,
  meetingOutcome: shell.salesIntelligence.meetingOutcome,
}).slice(0, 40_000)}`,
          maxTokens: STAGE_BUDGETS.email.tokens,
          reasoningEffort: STAGE_BUDGETS.email.effort,
          jsonSchema: {
            name: "pem_follow_up_email",
            schema: EMAIL_JSON_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        });
        modelName = res.model;
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        diagnostics.finishReasons.push(res.finishReason ?? "unknown");
        const raw = parseJsonStrict(res.content, "PEM_EMAIL_SCHEMA_INVALID");
        const parsed = parseEmailStage(raw);
        if (!parsed.ok) {
          stageOutputs.validationDiagnostics = {
            stage: "email",
            issues: parsed.issues,
            shape: [],
          };
          throw pemError("PEM_EMAIL_SCHEMA_INVALID");
        }
        shell.followUpEmail = {
          subject: parsed.data.subject,
          body: parsed.data.body,
        };
        stageOutputs.followUpEmail = shell.followUpEmail;
        completeStage(stage, {
          status: "completed",
          validationStatus: "ok",
          outputCharacters: res.content.length,
          finishReason: res.finishReason,
          model: res.model,
          api: res.api ?? null,
        });
      } catch (error) {
        completeStage(stage, {
          status: "failed",
          errorCode: error instanceof AppError ? error.code : "PEM_EMAIL_SCHEMA_INVALID",
        });
        throw error instanceof AppError ? error : pemError("PEM_EMAIL_SCHEMA_INVALID");
      }
    } else if (stageOutputs.followUpEmail) {
      shell.followUpEmail = {
        subject: (stageOutputs.followUpEmail.subject as string | null) ?? null,
        body: String(stageOutputs.followUpEmail.body ?? shell.followUpEmail.body),
      };
    }

    // -------- Stage E: Handoff --------
    await emitProgress("generating_handoff");
    if (!stageOutputs.handoff) {
      const stage = startStage(trace, "handoff", { model: modelName, provider: "openai" });
      diagnostics.stages.push("handoff");
      try {
        const res = await callStageJson({
          system: buildHandoffStagePrompt(),
          user: `Prospect: ${input.prospectName}
Advisor: ${input.advisorName}

Fact Ledger:
${JSON.stringify(ledger).slice(0, 80_000)}

Sales intelligence:
${JSON.stringify(shell.salesIntelligence).slice(0, 40_000)}`,
          maxTokens: STAGE_BUDGETS.handoff.tokens,
          reasoningEffort: STAGE_BUDGETS.handoff.effort,
          jsonSchema: {
            name: "pem_handoff",
            schema: HANDOFF_JSON_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        });
        modelName = res.model;
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        diagnostics.finishReasons.push(res.finishReason ?? "unknown");
        const raw = parseJsonStrict(res.content, "PEM_HANDOFF_SCHEMA_INVALID");
        const parsed = parseHandoffStage(raw);
        if (!parsed.ok) {
          stageOutputs.validationDiagnostics = {
            stage: "handoff",
            issues: parsed.issues,
            shape: [],
          };
          throw pemError("PEM_HANDOFF_SCHEMA_INVALID");
        }
        applyHandoffStageToShell(shell, parsed.data);
        stageOutputs.handoff = {
          projectIntelligence: shell.projectIntelligence,
          buildertrendFields: shell.buildertrendFields,
          internalOpportunityNotes: shell.internalOpportunityNotes,
          productionNotes: shell.productionNotes,
        };
        completeStage(stage, {
          status: "completed",
          validationStatus: "ok",
          outputCharacters: res.content.length,
          finishReason: res.finishReason,
          model: res.model,
          api: res.api ?? null,
        });
      } catch (error) {
        completeStage(stage, {
          status: "failed",
          errorCode: error instanceof AppError ? error.code : "PEM_HANDOFF_SCHEMA_INVALID",
        });
        throw error instanceof AppError ? error : pemError("PEM_HANDOFF_SCHEMA_INVALID");
      }
    } else if (stageOutputs.handoff) {
      const h = stageOutputs.handoff as {
        projectIntelligence?: PemNeatStructuredResult["projectIntelligence"];
        buildertrendFields?: PemNeatStructuredResult["buildertrendFields"];
        internalOpportunityNotes?: string;
        productionNotes?: string[];
      };
      if (h.projectIntelligence) shell.projectIntelligence = h.projectIntelligence;
      if (h.buildertrendFields) {
        shell.buildertrendFields = mergeBuildertrendFields(h.buildertrendFields);
      }
      if (h.internalOpportunityNotes != null) {
        shell.internalOpportunityNotes = clampInternalNotes(h.internalOpportunityNotes);
      }
      if (Array.isArray(h.productionNotes)) shell.productionNotes = h.productionNotes;
    }

    // -------- Final assemble (code owns scaffolding) --------
    const assembleStage = startStage(trace, "final_assemble");
    diagnostics.stages.push("final_assemble");
    let result: PemNeatStructuredResult;
    try {
      result = normalizeCategoryLabels(parsePemNeatStructuredResult(shell));
      completeStage(assembleStage, { status: "completed", validationStatus: "ok" });
    } catch (error) {
      completeStage(assembleStage, {
        status: "failed",
        validationStatus: "failed",
        validationIssues: [zodIssueSummary(error)],
        errorCode: "PEM_FINAL_MERGE_INVALID",
      });
      console.error("[pem-neat] final assemble failed", {
        code: "PEM_FINAL_MERGE_INVALID",
        issues: zodIssueSummary(error),
      });
      throw pemError("PEM_FINAL_MERGE_INVALID");
    }

    // -------- Stage F: Quality Review --------
    await emitProgress("quality_review");
    const reviewStage = startStage(trace, "quality_review", {
      model: modelName,
      provider: "openai",
    });
    diagnostics.stages.push("quality_review");
    const priorReview = stageOutputs.qualityReview
      ? parseQualityReviewStage(stageOutputs.qualityReview)
      : null;
    let review = priorReview?.ok ? priorReview.data : null;
    if (!review) {
      try {
        const res = await callStageJson({
          system: buildQualityReviewStagePrompt(),
          user: `Fact Ledger:
${JSON.stringify(ledger).slice(0, 60_000)}

Generated NEAT (salesIntelligence, assessment summary, email subject/body preview, project facts):
${JSON.stringify({
  salesIntelligence: result.salesIntelligence,
  assessment: {
    topStrengths: result.assessment.topStrengths,
    topImprovements: result.assessment.topImprovements,
    oneThing: result.assessment.oneThing,
    categories: result.assessment.categories.map((c) => ({
      key: c.key,
      score: c.score,
      status: c.status,
    })),
  },
  followUpEmail: result.followUpEmail,
  projectIntelligence: result.projectIntelligence,
}).slice(0, 80_000)}`,
          maxTokens: STAGE_BUDGETS.quality_review.tokens,
          reasoningEffort: STAGE_BUDGETS.quality_review.effort,
          jsonSchema: {
            name: "pem_quality_review",
            schema: QUALITY_REVIEW_JSON_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        });
        modelName = res.model;
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        diagnostics.finishReasons.push(res.finishReason ?? "unknown");
        let raw: unknown = {};
        try {
          raw = parseJsonStrict(res.content, "PEM_QUALITY_REVIEW_SCHEMA_INVALID");
        } catch {
          raw = {};
        }
        const parsed = parseQualityReviewStage(raw);
        review = parsed.ok ? parsed.data : { pass: true, severity: "low" as const, issues: [] };
        stageOutputs.qualityReview = review;
        completeStage(reviewStage, {
          status: "completed",
          validationStatus: review.pass ? "ok" : "soft_issues",
          finishReason: res.finishReason,
          extractedItemCounts: { issues: review.issues.length },
          model: res.model,
          api: res.api ?? null,
        });
      } catch (error) {
        if (isFatalPemProviderError(error) && error instanceof AppError) {
          if (
            error.code === "PEM_NEAT_TIMEOUT" ||
            error.code === "PEM_NEAT_RATE_LIMITED" ||
            error.code === "PEM_NEAT_PROVIDER_ERROR"
          ) {
            review = { pass: true, severity: "low", issues: [] };
            completeStage(reviewStage, {
              status: "completed",
              validationStatus: "soft_issues",
              validationIssues: [`quality_review skipped after ${error.code}`],
            });
          } else {
            // Soft: do not fail entire NEAT on review infrastructure
            review = { pass: true, severity: "low", issues: [] };
            completeStage(reviewStage, {
              status: "completed",
              validationStatus: "soft_issues",
              validationIssues: [`quality_review soft-pass after ${error.code}`],
            });
          }
        } else {
          review = { pass: true, severity: "low", issues: [] };
          completeStage(reviewStage, {
            status: "completed",
            validationStatus: "soft_issues",
          });
        }
      }
    }

    diagnostics.qualityReview = review;

    // One correction pass for material issues
    if (review && !review.pass && (review.severity === "medium" || review.severity === "high")) {
      const material = review.issues.filter((i) =>
        ["unsupported", "contradiction", "attribution", "email"].includes(i.type),
      );
      if (material.length > 0) {
        const corr = startStage(trace, "correction", { model: modelName, provider: "openai" });
        diagnostics.stages.push("correction");
        try {
          const res = await callStageJson({
            system: buildCorrectionStagePrompt(),
            user: `Issues to fix:
${JSON.stringify(material).slice(0, 20_000)}

Fact Ledger:
${JSON.stringify(ledger).slice(0, 40_000)}

Current NEAT sections:
${JSON.stringify({
  salesIntelligence: result.salesIntelligence,
  followUpEmail: result.followUpEmail,
  assessment: result.assessment,
  projectIntelligence: result.projectIntelligence,
}).slice(0, 60_000)}`,
            maxTokens: STAGE_BUDGETS.correction.tokens,
            reasoningEffort: STAGE_BUDGETS.correction.effort,
          });
          modelName = res.model;
          inputTokens += res.inputTokens ?? 0;
          outputTokens += res.outputTokens ?? 0;
          const raw = parseJsonStrict(res.content, "PEM_QUALITY_GATE_FAILED") as Record<
            string,
            unknown
          >;
          if (raw.salesIntelligence) {
            const siParsed = parseSalesIntelligenceStage(raw.salesIntelligence);
            if (siParsed.ok) {
              applySalesIntelligenceFromStage(shell, siParsed.data);
            }
          }
          if (raw.followUpEmail && typeof raw.followUpEmail === "object") {
            const fe = raw.followUpEmail as { subject?: string; body?: string };
            if (fe.body) {
              shell.followUpEmail = { subject: fe.subject ?? null, body: fe.body };
            }
          }
          if (raw.assessment && typeof raw.assessment === "object") {
            const a = assessmentSchema.partial().safeParse(raw.assessment);
            if (a.success) {
              shell.assessment = {
                categories: mergeAssessmentCategories(
                  (a.data.categories as PemNeatStructuredResult["assessment"]["categories"]) ??
                    shell.assessment.categories,
                ),
                topStrengths: a.data.topStrengths ?? shell.assessment.topStrengths,
                topImprovements: a.data.topImprovements ?? shell.assessment.topImprovements,
                oneThing: a.data.oneThing ?? shell.assessment.oneThing,
              };
            }
          }
          result = normalizeCategoryLabels(parsePemNeatStructuredResult(shell));
          completeStage(corr, {
            status: "completed",
            validationStatus: "ok",
            finishReason: res.finishReason,
            model: res.model,
            api: res.api ?? null,
          });
        } catch (error) {
          completeStage(corr, {
            status: "failed",
            errorCode: error instanceof AppError ? error.code : "PEM_QUALITY_GATE_FAILED",
          });
          // Keep pre-correction result if correction fails
          if (
            error instanceof AppError &&
            (error.code === "PEM_NEAT_PROVIDER_REFUSAL" || error.code === "PEM_FINAL_MERGE_INVALID")
          ) {
            throw pemError("PEM_QUALITY_GATE_FAILED");
          }
        }
      } else if (review.severity === "high") {
        throw pemError("PEM_GROUNDING_VALIDATION_FAILED");
      }
    }

    // Final semantic gate
    const gate = startStage(trace, "quality_gate");
    diagnostics.stages.push("quality_gate");
    coverage = scoreFactCoverage(result, signals);
    diagnostics.coverage = coverage;
    if (coverage.isSuspiciouslyEmpty && signals.looksSubstantive) {
      completeStage(gate, {
        status: "failed",
        errorCode: "PEM_QUALITY_GATE_FAILED",
      });
      throw pemError("PEM_QUALITY_GATE_FAILED");
    }
    completeStage(gate, { status: "completed", validationStatus: "ok" });

    const overallScore = computeOverallScore(result.assessment.categories);
    diagnostics.overallScore = overallScore;
    const checkIssues = runDeterministicNeatChecks(result, input.transcript);
    diagnostics.validationIssues.push(...checkIssues);

    result = {
      ...result,
      analysisMetadata: {
        ...result.analysisMetadata,
        transcriptComplete: !siIncomplete,
        limitations: [
          ...(result.analysisMetadata.limitations ?? []),
          ...checkIssues.map((i) => `QC: ${i}`),
          ...(siIncomplete
            ? [
                "Transcript appears incomplete at the ending; Outcome/Close and Post-Sell may be NOT_DETERMINABLE.",
              ]
            : []),
        ],
        stage0Notes: [...(result.analysisMetadata.stage0Notes ?? []), ...stage0Notes],
        overallScore,
        factCoverageScore: coverage.totalScore,
        recoveryUsed: diagnostics.recoveryUsed,
        generationSchemaVersion: PEM_NEAT_GENERATION_SCHEMA_VERSION,
      } as typeof result.analysisMetadata & {
        overallScore?: number | null;
        factCoverageScore?: number;
        recoveryUsed?: boolean;
        generationSchemaVersion?: number;
      },
      metadata: {
        ...result.metadata,
        prospectName: input.prospectName,
        advisorName: input.advisorName,
        meetingDate: input.meetingDate ?? result.metadata.meetingDate ?? null,
      },
    };

    succeedTrace(trace);
    diagnostics.trace = trace;
    diagnostics.stageOutputs = stageOutputs;
    await input.onProgress?.({
      stage: "completed",
      status: "completed",
      trace,
      stageOutputs,
    });

    console.info("[pem-neat] generation complete", {
      stages: diagnostics.stages,
      finishReasons: diagnostics.finishReasons,
      validationIssueCount: diagnostics.validationIssues.length,
      coverageScore: coverage.totalScore,
      recoveryUsed: diagnostics.recoveryUsed,
      overallScore,
      model: modelName,
      latencyMs: Date.now() - started,
      calls: diagnostics.stages.length,
    });

    return {
      result,
      modelProvider: "openai",
      modelName,
      latencyMs: Date.now() - started,
      inputTokens: inputTokens || null,
      outputTokens: outputTokens || null,
      usedMock: false,
      stage0Notes,
      transcriptStrategy: strategy,
      diagnostics,
    };
  } catch (error) {
    const failedStage = trace.stages.at(-1)?.name ?? null;
    const code =
      error instanceof AppError
        ? normalizePemErrorCode(error.code, failedStage)
        : "PEM_FACT_EXTRACTION_FAILED";
    failTrace(trace, code, failedStage ?? undefined);
    diagnostics.trace = trace;
    diagnostics.stageOutputs = stageOutputs;
    await input.onProgress?.({
      stage: trace.finalErrorStage ?? "failed",
      status: "failed",
      trace,
      stageOutputs,
      errorCode: code,
      errorMessage: employeeFacingPemError(code, failedStage),
    });
    if (error instanceof AppError) {
      throw new AppError(employeeFacingPemError(code, failedStage), {
        code,
        statusCode: error.statusCode,
        cause: error,
      });
    }
    throw pemError(code);
  }
}

export function getPemNeatStandardVersion() {
  return PEM_NEAT_STANDARD_VERSION;
}

/** Route / job wall-clock allowance for multi-stage GPT-5.4 PEM. */
export const PEM_NEAT_ROUTE_MAX_DURATION_SECONDS = 800;

/** Typical primary model calls (without chunking/recovery/correction). */
export const PEM_NEAT_TYPICAL_MODEL_CALLS = 6;
/** Max bounded calls: chunks(≤4) + merge + recovery + SI + assess + email + handoff + review + correction + retries. */
export const PEM_NEAT_MAX_BOUNDED_MODEL_CALLS = 28;
