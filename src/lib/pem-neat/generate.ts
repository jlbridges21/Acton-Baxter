import "server-only";

import { randomUUID } from "node:crypto";
import { ZodError, z } from "zod";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { OpenAiReasoningEffort } from "@/lib/openai/capabilities";
import { ASSESSMENT_CATEGORY_LABELS, PEM_NEAT_STANDARD_VERSION } from "./constants";
import { coerceSalesIntelligencePartial } from "./coerce";
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
  buildAssessmentStagePrompt,
  buildCorrectionStagePrompt,
  buildEmailStagePrompt,
  buildFactLedgerStagePrompt,
  buildHandoffStagePrompt,
  buildPemNeatUserPrompt,
  buildQualityReviewStagePrompt,
  buildRecoveryFactPrompt,
  buildSalesIntelligenceStagePrompt,
} from "./prompts";
import {
  parsePemNeatStructuredResult,
  salesIntelligenceSchema,
  assessmentSchema,
  followUpEmailSchema,
  buildertrendFieldsSchema,
  projectIntelligenceSchema,
  type PemNeatStructuredResult,
} from "./schemas";
import { chunkTranscript, stage0ValidateTranscript } from "./transcript";
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
  factLedger?: FactLedger | null;
  salesIntelligence?: Record<string, unknown> | null;
  assessment?: Record<string, unknown> | null;
  followUpEmail?: Record<string, unknown> | null;
  handoff?: Record<string, unknown> | null;
  qualityReview?: Record<string, unknown> | null;
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
  const env = getEnv();
  return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
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

const qualityReviewSchema = z.object({
  pass: z.boolean(),
  severity: z.enum(["none", "low", "medium", "high"]).catch("medium"),
  issues: z
    .array(
      z.object({
        section: z.string(),
        type: z.string(),
        explanation: z.string(),
        suggestedCorrection: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

function ledgerIsEmpty(ledger: FactLedger): boolean {
  return countFactLedgerItems(ledger) < 3;
}

function applySalesIntelligence(
  shell: PemNeatStructuredResult,
  raw: unknown,
  diagnostics: { validationIssues: string[] },
) {
  const coerced = coerceSalesIntelligencePartial(
    raw && typeof raw === "object" && "salesIntelligence" in (raw as object)
      ? (raw as { salesIntelligence: unknown }).salesIntelligence
      : raw,
  );
  const parsed = salesIntelligenceSchema.partial().safeParse(coerced);
  if (!parsed.success) {
    diagnostics.validationIssues.push(`sales_intelligence: ${zodIssueSummary(parsed.error)}`);
    // Coerced merge of known-safe fields only — never raw poison
    const safe = coerceSalesIntelligencePartial(coerced);
    const retry = salesIntelligenceSchema.partial().safeParse(safe);
    if (!retry.success) {
      throw pemError("PEM_FACT_SCHEMA_INVALID");
    }
    Object.assign(shell.salesIntelligence, {
      ...shell.salesIntelligence,
      ...retry.data,
      budget: { ...shell.salesIntelligence.budget, ...(retry.data.budget ?? {}) },
      decisionProcess: {
        ...shell.salesIntelligence.decisionProcess,
        ...(retry.data.decisionProcess ?? {}),
      },
      schedule: { ...shell.salesIntelligence.schedule, ...(retry.data.schedule ?? {}) },
      nextSteps: {
        prospect: retry.data.nextSteps?.prospect ?? shell.salesIntelligence.nextSteps.prospect,
        acton: retry.data.nextSteps?.acton ?? shell.salesIntelligence.nextSteps.acton,
      },
      actonRecommendation: {
        ...shell.salesIntelligence.actonRecommendation,
        ...(retry.data.actonRecommendation ?? {}),
      },
      meetingOutcome: retry.data.meetingOutcome ?? shell.salesIntelligence.meetingOutcome,
      qualification: retry.data.qualification ?? shell.salesIntelligence.qualification,
    });
    return;
  }
  const patch = parsed.data;
  shell.salesIntelligence = {
    ...shell.salesIntelligence,
    ...patch,
    budget: { ...shell.salesIntelligence.budget, ...(patch.budget ?? {}) },
    decisionProcess: {
      ...shell.salesIntelligence.decisionProcess,
      ...(patch.decisionProcess ?? {}),
    },
    schedule: { ...shell.salesIntelligence.schedule, ...(patch.schedule ?? {}) },
    nextSteps: {
      prospect: patch.nextSteps?.prospect ?? shell.salesIntelligence.nextSteps.prospect,
      acton: patch.nextSteps?.acton ?? shell.salesIntelligence.nextSteps.acton,
    },
    actonRecommendation: {
      ...shell.salesIntelligence.actonRecommendation,
      ...(patch.actonRecommendation ?? {}),
    },
    meetingOutcome: patch.meetingOutcome ?? shell.salesIntelligence.meetingOutcome,
    qualification: patch.qualification ?? shell.salesIntelligence.qualification,
    type1Pain: patch.type1Pain ?? shell.salesIntelligence.type1Pain,
    type2Pain: patch.type2Pain ?? shell.salesIntelligence.type2Pain,
  };
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
    if (!stageOutputs.factLedger || ledgerIsEmpty(ledger)) {
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

          const raw = parseJsonStrict(res.content, "PEM_FACT_SCHEMA_INVALID");
          const parsed = tryParseFactLedger(raw);
          if (!parsed.ok && ledgerIsEmpty(parsed.ledger)) {
            completeStage(stage, {
              status: "failed",
              validationStatus: "failed",
              validationIssues: parsed.issues,
              outputCharacters: res.content.length,
              finishReason: res.finishReason,
              errorCode: "PEM_FACT_SCHEMA_INVALID",
              api: res.api ?? null,
            });
            throw pemError("PEM_FACT_SCHEMA_INVALID");
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
          const raw = parseJsonStrict(res.content, "PEM_FACT_SCHEMA_INVALID");
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
      await emitProgress("extracting_facts");
    }

    // -------- Stage B: Sales Intelligence --------
    await emitProgress("evaluating_sales");
    if (!stageOutputs.salesIntelligence) {
      const stage = startStage(trace, "sales_intelligence", {
        model: modelName,
        provider: "openai",
      });
      diagnostics.stages.push("sales_intelligence");
      try {
        const res = await callStageJson({
          system: buildSalesIntelligenceStagePrompt(),
          user: `Prospect: ${input.prospectName}
Advisor: ${input.advisorName}

Fact Ledger (primary source — synthesize NEAT sales intelligence from this):
${JSON.stringify(ledger).slice(0, 120_000)}

Optional transcript excerpt for clarification only:
${input.transcript.slice(0, 40_000)}`,
          maxTokens: STAGE_BUDGETS.sales_intelligence.tokens,
          reasoningEffort: STAGE_BUDGETS.sales_intelligence.effort,
        });
        modelName = res.model;
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        if (res.api) diagnostics.api = res.api;
        diagnostics.finishReasons.push(res.finishReason ?? "unknown");
        const raw = parseJsonStrict(res.content, "PEM_FACT_SCHEMA_INVALID");
        applySalesIntelligence(shell, raw, diagnostics);
        stageOutputs.salesIntelligence = shell.salesIntelligence as unknown as Record<
          string,
          unknown
        >;
        completeStage(stage, {
          status: "completed",
          validationStatus: diagnostics.validationIssues.some((v) =>
            v.startsWith("sales_intelligence:"),
          )
            ? "soft_issues"
            : "ok",
          outputCharacters: res.content.length,
          finishReason: res.finishReason,
          model: res.model,
          api: res.api ?? null,
        });
      } catch (error) {
        completeStage(stage, {
          status: "failed",
          errorCode: error instanceof AppError ? error.code : "PEM_FACT_EXTRACTION_FAILED",
        });
        throw error instanceof AppError ? error : pemError("PEM_FACT_EXTRACTION_FAILED");
      }
    } else {
      applySalesIntelligence(shell, stageOutputs.salesIntelligence, diagnostics);
    }

    // Coverage gate after SI
    let coverage = scoreFactCoverage(shell, signals);
    diagnostics.coverage = coverage;
    if (coverage.isSuspiciouslyEmpty && signals.looksSubstantive) {
      throw pemError("PEM_LOW_EVIDENCE_COVERAGE");
    }

    // -------- Stage C: Assessment --------
    await emitProgress("evaluating_sales");
    if (!stageOutputs.assessment) {
      const stage = startStage(trace, "assessment", { model: modelName, provider: "openai" });
      diagnostics.stages.push("assessment");
      try {
        const res = await callStageJson({
          system: buildAssessmentStagePrompt(),
          user: `Prospect: ${input.prospectName}
Advisor: ${input.advisorName}

Fact Ledger:
${JSON.stringify(ledger).slice(0, 80_000)}

Sales intelligence:
${JSON.stringify(shell.salesIntelligence).slice(0, 40_000)}

Transcript evidence for scoring salesperson behavior:
${input.transcript.slice(0, 80_000)}`,
          maxTokens: STAGE_BUDGETS.assessment.tokens,
          reasoningEffort: STAGE_BUDGETS.assessment.effort,
        });
        modelName = res.model;
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        diagnostics.finishReasons.push(res.finishReason ?? "unknown");
        const raw = parseJsonStrict(res.content, "PEM_ASSESSMENT_SCHEMA_INVALID");
        const parsed = z
          .object({
            assessment: assessmentSchema.partial().optional(),
            meetingOutcome: z
              .object({ classification: z.string(), explanation: z.string().optional() })
              .optional(),
            qualification: z
              .object({
                classification: z.string(),
                reasoning: z.string().optional(),
                risks: z.array(z.string()).optional(),
              })
              .optional(),
          })
          .safeParse(raw);
        if (!parsed.success) {
          throw pemError("PEM_ASSESSMENT_SCHEMA_INVALID");
        }
        if (parsed.data.assessment) {
          shell.assessment = {
            categories: mergeAssessmentCategories(
              (parsed.data.assessment
                .categories as PemNeatStructuredResult["assessment"]["categories"]) ?? [],
            ),
            topStrengths: parsed.data.assessment.topStrengths ?? [],
            topImprovements: parsed.data.assessment.topImprovements ?? [],
            oneThing:
              parsed.data.assessment.oneThing?.trim() ||
              "Tighten discovery and next-step clarity on the next PEM.",
          };
        }
        if (parsed.data.meetingOutcome) {
          shell.salesIntelligence.meetingOutcome = {
            classification: parsed.data.meetingOutcome
              .classification as PemNeatStructuredResult["salesIntelligence"]["meetingOutcome"]["classification"],
            explanation:
              parsed.data.meetingOutcome.explanation?.trim() ||
              "Outcome based on closing evidence in the transcript.",
          };
        }
        if (parsed.data.qualification) {
          shell.salesIntelligence.qualification = {
            classification: parsed.data.qualification
              .classification as PemNeatStructuredResult["salesIntelligence"]["qualification"]["classification"],
            reasoning:
              parsed.data.qualification.reasoning?.trim() ||
              "Qualification based on Pain, Budget, Decision, Schedule, and Fit.",
            risks: parsed.data.qualification.risks ?? [],
          };
        }
        stageOutputs.assessment = {
          assessment: shell.assessment,
          meetingOutcome: shell.salesIntelligence.meetingOutcome,
          qualification: shell.salesIntelligence.qualification,
        };
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
          errorCode: error instanceof AppError ? error.code : "PEM_ASSESSMENT_FAILED",
        });
        throw error instanceof AppError ? error : pemError("PEM_ASSESSMENT_FAILED");
      }
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
        });
        modelName = res.model;
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        diagnostics.finishReasons.push(res.finishReason ?? "unknown");
        const raw = parseJsonStrict(res.content, "PEM_HANDOFF_SCHEMA_INVALID");
        const parsed = z.object({ followUpEmail: followUpEmailSchema.partial() }).safeParse(raw);
        if (!parsed.success || !parsed.data.followUpEmail?.body) {
          throw pemError("PEM_HANDOFF_SCHEMA_INVALID");
        }
        shell.followUpEmail = {
          subject: parsed.data.followUpEmail.subject ?? null,
          body: parsed.data.followUpEmail.body,
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
          errorCode: error instanceof AppError ? error.code : "PEM_HANDOFF_FAILED",
        });
        throw error instanceof AppError ? error : pemError("PEM_HANDOFF_FAILED");
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
        });
        modelName = res.model;
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        diagnostics.finishReasons.push(res.finishReason ?? "unknown");
        const raw = parseJsonStrict(res.content, "PEM_HANDOFF_SCHEMA_INVALID") as Record<
          string,
          unknown
        >;
        if (raw.projectIntelligence) {
          const p = projectIntelligenceSchema.safeParse(raw.projectIntelligence);
          if (p.success) {
            shell.projectIntelligence = {
              ...shell.projectIntelligence,
              ...p.data,
              facts: p.data.facts?.length ? p.data.facts : shell.projectIntelligence.facts,
            };
          } else {
            diagnostics.validationIssues.push(`project: ${zodIssueSummary(p.error)}`);
          }
        }
        if (raw.buildertrendFields) {
          shell.buildertrendFields = mergeBuildertrendFields(
            raw.buildertrendFields as Record<string, unknown>,
          );
        }
        if (raw.internalOpportunityNotes != null) {
          shell.internalOpportunityNotes = clampInternalNotes(String(raw.internalOpportunityNotes));
        }
        if (Array.isArray(raw.productionNotes)) {
          shell.productionNotes = raw.productionNotes.map(String);
        }
        // Require at least BT object parseable
        buildertrendFieldsSchema.parse(shell.buildertrendFields);
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
          errorCode: error instanceof AppError ? error.code : "PEM_HANDOFF_FAILED",
        });
        throw error instanceof AppError ? error : pemError("PEM_HANDOFF_FAILED");
      }
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
    let review = stageOutputs.qualityReview
      ? qualityReviewSchema.safeParse(stageOutputs.qualityReview).data
      : null;
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
        });
        modelName = res.model;
        inputTokens += res.inputTokens ?? 0;
        outputTokens += res.outputTokens ?? 0;
        diagnostics.finishReasons.push(res.finishReason ?? "unknown");
        const raw = parseJsonStrict(res.content, "PEM_QUALITY_GATE_FAILED");
        const parsed = qualityReviewSchema.safeParse(raw);
        if (!parsed.success) {
          // Soft: treat as pass with note — don't fail entire PEM on review parse alone
          review = { pass: true, severity: "low", issues: [] };
          diagnostics.validationIssues.push(`quality_review: ${zodIssueSummary(parsed.error)}`);
          completeStage(reviewStage, {
            status: "completed",
            validationStatus: "soft_issues",
            finishReason: res.finishReason,
          });
        } else {
          review = parsed.data;
          stageOutputs.qualityReview = review;
          completeStage(reviewStage, {
            status: "completed",
            validationStatus: review.pass ? "ok" : "soft_issues",
            finishReason: res.finishReason,
            extractedItemCounts: { issues: review.issues.length },
            model: res.model,
            api: res.api ?? null,
          });
        }
      } catch (error) {
        if (isFatalPemProviderError(error) && error instanceof AppError) {
          // Provider hard fail on review — don't lose the NEAT if content is good
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
            completeStage(reviewStage, { status: "failed", errorCode: error.code });
            throw error;
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
            applySalesIntelligence(shell, raw.salesIntelligence, diagnostics);
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
        limitations: [
          ...(result.analysisMetadata.limitations ?? []),
          ...checkIssues.map((i) => `QC: ${i}`),
        ],
        stage0Notes: [...(result.analysisMetadata.stage0Notes ?? []), ...stage0Notes],
        overallScore,
        factCoverageScore: coverage.totalScore,
        recoveryUsed: diagnostics.recoveryUsed,
      } as typeof result.analysisMetadata & {
        overallScore?: number | null;
        factCoverageScore?: number;
        recoveryUsed?: boolean;
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
    const code =
      error instanceof AppError ? normalizePemErrorCode(error.code) : "PEM_FACT_EXTRACTION_FAILED";
    failTrace(trace, code);
    diagnostics.trace = trace;
    diagnostics.stageOutputs = stageOutputs;
    await input.onProgress?.({
      stage: trace.finalErrorStage ?? "failed",
      status: "failed",
      trace,
      stageOutputs,
      errorCode: code,
      errorMessage: employeeFacingPemError(code),
    });
    if (error instanceof AppError) {
      throw new AppError(employeeFacingPemError(code), {
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
