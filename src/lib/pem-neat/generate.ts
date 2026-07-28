import "server-only";

import { ZodError, z } from "zod";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
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
import { buildMockPemNeatResult } from "./mock-result";
import {
  callPemOpenAiJsonWithRetries,
  getPemNeatReasoningEffort,
  getPemNeatStageTimeoutMs,
  resolvePemNeatFallbackModel,
  resolvePemNeatModelName,
} from "./openai-client";
import {
  buildAssessmentStagePrompt,
  buildFactExtractionStagePrompt,
  buildHandoffStagePrompt,
  buildPemNeatUserPrompt,
  buildRecoveryFactPrompt,
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
import { runDeterministicNeatChecks } from "./validate";

export type GeneratePemNeatInput = {
  prospectName: string;
  advisorName: string;
  meetingDate?: string | null;
  transcript: string;
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
  };
};

/** Stage output budgets — large enough for schemas, not chat-sized tiny limits. */
const PEM_STAGE_FACTS_MAX_TOKENS = 8_000;
const PEM_STAGE_ASSESSMENT_MAX_TOKENS = 6_000;
const PEM_STAGE_HANDOFF_MAX_TOKENS = 5_000;
const PEM_MAX_OUTPUT_TOKENS = 12_000;

function stageMaxTokens(fallback: number): number {
  const raw = process.env.PEM_NEAT_MAX_OUTPUT_TOKENS;
  if (raw && /^\d+$/.test(raw)) {
    return Math.min(Math.max(Number(raw), 1_000), 32_000);
  }
  return fallback;
}

/** Provider AppErrors must not be swallowed by stage soft-fail. */
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
    error.code === "PEM_NEAT_EMPTY_OUTPUT"
  );
}

function shouldUseMock(): boolean {
  const env = getEnv();
  return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
}

/**
 * Explicit PEM model resolution (no silent mini→gpt-4o substitution).
 * Prefer PEM_NEAT_OPENAI_MODEL; otherwise Baxter/OpenAI config or gpt-4o.
 */
export function getPemNeatModelName(): string {
  return resolvePemNeatModelName();
}

function zodIssueSummary(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
  }
  if (error instanceof Error) return error.message.slice(0, 500);
  return "schema validation failed";
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

async function callOpenAiJson(
  messages: Array<{ role: string; content: string }>,
  maxTokens = PEM_MAX_OUTPUT_TOKENS,
): Promise<ProviderJsonResult> {
  const model = getPemNeatModelName();
  const result = await callPemOpenAiJsonWithRetries(
    {
      model,
      messages: messages.map((m) => ({
        role: (m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user") as
          "system" | "user" | "assistant",
        content: m.content,
      })),
      maxOutputTokens: maxTokens,
      temperature: 0.25,
      reasoningEffort: getPemNeatReasoningEffort(),
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

async function runStage(
  system: string,
  user: string,
  maxTokens: number,
): Promise<ProviderJsonResult> {
  return callOpenAiJson(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens,
  );
}

function parseJsonOrThrow(content: string, code: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new AppError(
      "Baxter generated an incomplete analysis and could not safely save it. Try again.",
      { code, statusCode: 502 },
    );
  }
}

const factsStageSchema = z.object({
  salesIntelligence: salesIntelligenceSchema.partial().optional(),
  projectIntelligence: projectIntelligenceSchema.optional(),
  productionNotes: z.array(z.string()).optional(),
  analysisMetadata: z
    .object({
      transcriptComplete: z.boolean().optional(),
      speakersLabeled: z.boolean().optional(),
      timestampsAvailable: z.boolean().optional(),
      appearsToBePem: z.boolean().optional(),
      attributionConfidence: z.enum(["high", "medium", "low", "unknown"]).optional(),
      limitations: z.array(z.string()).optional(),
    })
    .optional(),
  metadata: z
    .object({
      transcriptQuality: z.enum(["high", "medium", "low", "poor"]).optional(),
      limitations: z.array(z.string()).optional(),
    })
    .optional(),
});

const assessmentStageSchema = z.object({
  assessment: assessmentSchema.partial().optional(),
  meetingOutcome: z
    .object({
      classification: z.string(),
      explanation: z.string().optional(),
    })
    .optional(),
  qualification: z
    .object({
      classification: z.string(),
      reasoning: z.string().optional(),
      risks: z.array(z.string()).optional(),
    })
    .optional(),
});

const handoffStageSchema = z.object({
  followUpEmail: followUpEmailSchema.partial().optional(),
  buildertrendFields: buildertrendFieldsSchema.partial().optional(),
  internalOpportunityNotes: z.string().optional(),
  productionNotes: z.array(z.string()).optional(),
});

function applyFactsToShell(
  shell: PemNeatStructuredResult,
  mergedFacts: unknown,
  diagnostics: { validationIssues: string[] },
) {
  // Prefer validated parse; on failure still merge raw SI fields so shape drift doesn't wipe content.
  const parsed = factsStageSchema.safeParse(mergedFacts);
  const source = parsed.success
    ? parsed.data
    : ((mergedFacts && typeof mergedFacts === "object" ? mergedFacts : {}) as Record<
        string,
        unknown
      >);

  if (!parsed.success) {
    diagnostics.validationIssues.push(`facts: ${zodIssueSummary(parsed.error)}`);
    console.error("[pem-neat] facts stage schema soft-fail — merging raw fields", {
      code: "PEM_NEAT_FACTS_PARTIAL",
      issues: zodIssueSummary(parsed.error),
    });
  }

  const siRaw =
    (source as { salesIntelligence?: Record<string, unknown> }).salesIntelligence ??
    (source as Record<string, unknown>);

  if (siRaw && typeof siRaw === "object") {
    const siParsed = salesIntelligenceSchema.partial().safeParse(siRaw);
    const patch = (siParsed.success ? siParsed.data : siRaw) as Partial<
      PemNeatStructuredResult["salesIntelligence"]
    >;
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
      // Keep outcome/qualification for Stage 2 unless Stage 1 provided them.
      meetingOutcome: patch.meetingOutcome ?? shell.salesIntelligence.meetingOutcome,
      qualification: patch.qualification ?? shell.salesIntelligence.qualification,
    };
  }

  const projectRaw = (source as { projectIntelligence?: unknown }).projectIntelligence;
  if (projectRaw) {
    const p = projectIntelligenceSchema.safeParse(projectRaw);
    if (p.success) {
      shell.projectIntelligence = {
        ...shell.projectIntelligence,
        ...p.data,
        facts: p.data.facts?.length ? p.data.facts : shell.projectIntelligence.facts,
      };
    }
  }

  const productionNotes = (source as { productionNotes?: string[] }).productionNotes;
  if (Array.isArray(productionNotes) && productionNotes.length) {
    shell.productionNotes = productionNotes;
  }

  const analysisMetadata = (source as { analysisMetadata?: Record<string, unknown> })
    .analysisMetadata;
  if (analysisMetadata && typeof analysisMetadata === "object") {
    shell.analysisMetadata = {
      ...shell.analysisMetadata,
      ...analysisMetadata,
      limitations: [
        ...(shell.analysisMetadata.limitations ?? []),
        ...((analysisMetadata.limitations as string[] | undefined) ?? []),
      ],
    } as PemNeatStructuredResult["analysisMetadata"];
  }
}

function missingCoverageLabels(coverage: FactCoverageScore): string[] {
  const missing: string[] = [];
  if (!coverage.customerStory) missing.push("customerStory");
  if (!coverage.customerPain) missing.push("customerPain");
  if (coverage.type1Count === 0) missing.push("type1Pain");
  if (coverage.type2Count === 0) missing.push("type2Pain");
  if (!coverage.budgetSignal) missing.push("budget");
  if (!coverage.decisionSignal) missing.push("decisionProcess");
  if (coverage.nextStepsCount === 0) missing.push("nextSteps");
  if (coverage.projectFactsCount === 0) missing.push("projectIntelligence.facts");
  return missing;
}

/**
 * Staged PEM NEAT generation with evidence-coverage recovery.
 */
export async function generatePemNeat(input: GeneratePemNeatInput): Promise<GeneratePemNeatOutput> {
  const started = Date.now();
  const diagnostics: GeneratePemNeatOutput["diagnostics"] = {
    stages: [],
    finishReasons: [],
    validationIssues: [],
    recoveryUsed: false,
    modelConfigured: getPemNeatModelName(),
  };

  const stage0 = stage0ValidateTranscript(input.transcript);
  if (!stage0.ok) {
    throw new AppError(stage0.error ?? "Invalid transcript", {
      code: "PEM_NEAT_TRANSCRIPT_INVALID",
      statusCode: 400,
    });
  }

  const signals = analyzeTranscriptSignals(input.transcript);
  const chunks = chunkTranscript(input.transcript);
  diagnostics.chunkCount = chunks.length;
  const strategy = chunks.length === 1 ? ("full" as const) : ("chunked" as const);
  const stage0Notes = [
    ...stage0.notes,
    ...(strategy === "chunked"
      ? [`Transcript analyzed in ${chunks.length} overlapping chunks (beginning→end).`]
      : []),
  ];

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
      diagnostics: {
        stages: ["mock"],
        finishReasons: [],
        validationIssues: [],
        overallScore,
        chunkCount: chunks.length,
      },
    };
  }

  let modelName = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const shell = emptyPemNeatShell({
    prospectName: input.prospectName,
    advisorName: input.advisorName,
    meetingDate: input.meetingDate,
  });

  async function extractFacts(label: string, systemPrompt: string, transcriptText: string) {
    diagnostics.stages.push(label);
    const user = buildPemNeatUserPrompt({
      prospectName: input.prospectName,
      advisorName: input.advisorName,
      meetingDate: input.meetingDate ?? null,
      transcript: transcriptText,
      transcriptNotes: stage0Notes,
    });
    const res = await runStage(systemPrompt, user, stageMaxTokens(PEM_STAGE_FACTS_MAX_TOKENS));
    diagnostics.finishReasons.push(res.finishReason ?? "unknown");
    modelName = res.model;
    if (res.api) diagnostics.api = res.api;
    if (res.usedFallback) diagnostics.usedFallback = true;
    inputTokens += res.inputTokens ?? 0;
    outputTokens += res.outputTokens ?? 0;
    return parseJsonOrThrow(res.content, "PEM_NEAT_INVALID_JSON");
  }

  // -------- Stage 1: facts --------
  const factParts: unknown[] = [];
  const factSystem = buildFactExtractionStagePrompt();
  for (const chunk of chunks) {
    const chunkSystem = `${factSystem}\nChunk ${chunk.index + 1}/${chunk.total} (${chunk.label}).`;
    factParts.push(await extractFacts("facts", chunkSystem, chunk.text));
  }
  applyFactsToShell(shell, mergeFactStages(factParts), diagnostics);

  // Evidence coverage + recovery
  let coverage = scoreFactCoverage(shell, signals);
  if (coverage.isSuspiciouslyEmpty && signals.looksSubstantive) {
    diagnostics.recoveryUsed = true;
    diagnostics.stages.push("facts_recovery");
    console.warn("[pem-neat] low evidence coverage — recovery pass", {
      code: "PEM_NEAT_LOW_EVIDENCE_COVERAGE",
      totalScore: coverage.totalScore,
      wordCount: signals.wordCount,
    });
    const missing = missingCoverageLabels(coverage);
    const recovered = await extractFacts(
      "facts_recovery",
      buildRecoveryFactPrompt(missing),
      // Prefer full transcript head+middle+tail via first+last chunks if huge
      chunks.length === 1
        ? input.transcript
        : [
            chunks[0]?.text ?? "",
            chunks[Math.floor(chunks.length / 2)]?.text ?? "",
            chunks.at(-1)?.text ?? "",
          ].join("\n\n"),
    );
    applyFactsToShell(shell, recovered, diagnostics);
    coverage = scoreFactCoverage(shell, signals);
  }

  diagnostics.coverage = coverage;

  if (coverage.isSuspiciouslyEmpty && signals.looksSubstantive) {
    console.error("[pem-neat] empty shell after recovery", {
      code: "PEM_NEAT_LOW_EVIDENCE_COVERAGE",
      coverage,
    });
    throw new AppError(
      "Baxter couldn't reliably extract enough information from this transcript. Your transcript is saved. You can edit it or retry the analysis.",
      { code: "PEM_NEAT_LOW_EVIDENCE_COVERAGE", statusCode: 502 },
    );
  }

  // -------- Stage 2: assessment --------
  diagnostics.stages.push("assessment");
  const assessmentUser = `Prospect: ${input.prospectName}
Advisor: ${input.advisorName}

Established facts (JSON) — use as primary sales intelligence; still verify against transcript for scoring:
${JSON.stringify({
  salesIntelligence: shell.salesIntelligence,
  projectIntelligence: shell.projectIntelligence,
}).slice(0, 40_000)}

Transcript evidence (score salesperson behavior from this):
<pem_transcript>
${input.transcript.slice(0, 80_000)}
</pem_transcript>`;

  try {
    const res = await runStage(
      buildAssessmentStagePrompt(),
      assessmentUser,
      stageMaxTokens(PEM_STAGE_ASSESSMENT_MAX_TOKENS),
    );
    diagnostics.finishReasons.push(res.finishReason ?? "unknown");
    modelName = res.model;
    if (res.api) diagnostics.api = res.api;
    if (res.usedFallback) diagnostics.usedFallback = true;
    inputTokens += res.inputTokens ?? 0;
    outputTokens += res.outputTokens ?? 0;
    const raw = parseJsonOrThrow(res.content, "PEM_NEAT_INVALID_JSON");
    const parsed = assessmentStageSchema.safeParse(raw);
    if (!parsed.success) {
      throw parsed.error;
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
  } catch (error) {
    if (isFatalPemProviderError(error)) throw error;
    diagnostics.validationIssues.push(`assessment: ${zodIssueSummary(error)}`);
    console.error("[pem-neat] assessment stage soft-fail", {
      code: "PEM_NEAT_ASSESSMENT_PARTIAL",
      issues: zodIssueSummary(error),
    });
  }

  // -------- Stage 3: handoff --------
  diagnostics.stages.push("handoff");
  const handoffUser = `Prospect: ${input.prospectName}
Advisor: ${input.advisorName}

Validated sales intelligence (write a specific customer email from these facts):
${JSON.stringify(shell.salesIntelligence).slice(0, 30_000)}

Project intelligence:
${JSON.stringify(shell.projectIntelligence).slice(0, 10_000)}

Transcript excerpt for next-step / contact preference grounding:
${input.transcript.slice(0, 20_000)}`;

  try {
    const res = await runStage(
      buildHandoffStagePrompt(),
      handoffUser,
      stageMaxTokens(PEM_STAGE_HANDOFF_MAX_TOKENS),
    );
    diagnostics.finishReasons.push(res.finishReason ?? "unknown");
    modelName = res.model;
    if (res.api) diagnostics.api = res.api;
    if (res.usedFallback) diagnostics.usedFallback = true;
    inputTokens += res.inputTokens ?? 0;
    outputTokens += res.outputTokens ?? 0;
    const raw = parseJsonOrThrow(res.content, "PEM_NEAT_INVALID_JSON");
    const parsed = handoffStageSchema.safeParse(raw);
    if (!parsed.success) throw parsed.error;
    if (parsed.data.followUpEmail?.body) {
      shell.followUpEmail = {
        subject: parsed.data.followUpEmail.subject ?? null,
        body: parsed.data.followUpEmail.body,
      };
    }
    if (parsed.data.buildertrendFields) {
      shell.buildertrendFields = mergeBuildertrendFields(parsed.data.buildertrendFields);
    }
    if (parsed.data.internalOpportunityNotes != null) {
      shell.internalOpportunityNotes = clampInternalNotes(parsed.data.internalOpportunityNotes);
    }
    if (parsed.data.productionNotes?.length) {
      shell.productionNotes = parsed.data.productionNotes;
    }
  } catch (error) {
    if (isFatalPemProviderError(error)) throw error;
    diagnostics.validationIssues.push(`handoff: ${zodIssueSummary(error)}`);
    console.error("[pem-neat] handoff stage soft-fail", {
      code: "PEM_NEAT_HANDOFF_PARTIAL",
      issues: zodIssueSummary(error),
    });
  }

  let result: PemNeatStructuredResult;
  try {
    result = normalizeCategoryLabels(parsePemNeatStructuredResult(shell));
  } catch (error) {
    console.error("[pem-neat] final assemble failed", {
      code: "PEM_NEAT_SCHEMA_INVALID",
      issues: zodIssueSummary(error),
    });
    throw new AppError(
      "Baxter generated an incomplete analysis and could not safely save it. Try again.",
      { code: "PEM_NEAT_SCHEMA_INVALID", statusCode: 502 },
    );
  }

  // Final semantic gate
  coverage = scoreFactCoverage(result, signals);
  diagnostics.coverage = coverage;
  if (coverage.isSuspiciouslyEmpty && signals.looksSubstantive) {
    throw new AppError(
      "Baxter couldn't reliably extract enough information from this transcript. Your transcript is saved. You can edit it or retry the analysis.",
      { code: "PEM_NEAT_LOW_EVIDENCE_COVERAGE", statusCode: 502 },
    );
  }

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

  console.info("[pem-neat] generation complete", {
    stages: diagnostics.stages,
    finishReasons: diagnostics.finishReasons,
    validationIssueCount: diagnostics.validationIssues.length,
    coverageScore: coverage.totalScore,
    recoveryUsed: diagnostics.recoveryUsed,
    overallScore,
    model: modelName,
    latencyMs: Date.now() - started,
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
}

function mergeFactStages(parts: unknown[]): unknown {
  if (parts.length === 1) return parts[0];
  const base: Record<string, unknown> = {};
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    deepMergeFacts(base, part as Record<string, unknown>);
  }
  return base;
}

function deepMergeFacts(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    const existing = target[key];
    if (Array.isArray(value)) {
      const prev = Array.isArray(existing) ? existing : [];
      // Prefer non-empty later arrays; concat unique-ish strings
      target[key] = [...prev, ...value];
    } else if (typeof value === "object") {
      const prev =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};
      const next = { ...prev };
      deepMergeFacts(next, value as Record<string, unknown>);
      target[key] = next;
    } else if (existing == null || existing === "") {
      target[key] = value;
    } else if (typeof existing === "string" && typeof value === "string" && existing !== value) {
      // Prefer longer / later synthesis
      target[key] = value.length >= existing.length ? value : existing;
    }
  }
}

export function getPemNeatStandardVersion() {
  return PEM_NEAT_STANDARD_VERSION;
}

export const PEM_NEAT_ROUTE_MAX_DURATION_SECONDS = 300;
