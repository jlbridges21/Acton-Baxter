/** Structured PEM generation diagnostics (no transcript / PII / raw model output). */

export type PemGenerationStageName =
  | "transcript_prep"
  | "fact_ledger"
  | "fact_ledger_merge"
  | "fact_ledger_recovery"
  | "sales_intelligence"
  | "assessment"
  | "email"
  | "handoff"
  | "quality_review"
  | "correction"
  | "final_assemble"
  | "quality_gate";

export type PemGenerationStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type PemGenerationStageTrace = {
  name: PemGenerationStageName;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  model: string | null;
  provider: string | null;
  api: string | null;
  attempt: number;
  status: PemGenerationStageStatus;
  outputCharacters: number | null;
  finishReason: string | null;
  validationStatus: "ok" | "soft_issues" | "failed" | "skipped" | null;
  validationIssues: string[];
  extractedItemCounts?: Record<string, number>;
  errorCode?: string | null;
};

export type PemGenerationTrace = {
  generationId: string;
  startedAt: string;
  completedAt: string | null;
  transcript: {
    characters: number;
    estimatedTokens: number;
    chunkCount: number;
    timestampsDetected: boolean;
    speakersDetected: boolean;
  };
  stages: PemGenerationStageTrace[];
  finalStatus: "running" | "completed" | "failed";
  finalErrorCode: string | null;
  finalErrorStage: string | null;
};

export function createPemGenerationTrace(input: {
  generationId: string;
  transcriptChars: number;
  chunkCount: number;
  timestampsDetected: boolean;
  speakersDetected: boolean;
}): PemGenerationTrace {
  return {
    generationId: input.generationId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    transcript: {
      characters: input.transcriptChars,
      estimatedTokens: Math.ceil(input.transcriptChars / 4),
      chunkCount: input.chunkCount,
      timestampsDetected: input.timestampsDetected,
      speakersDetected: input.speakersDetected,
    },
    stages: [],
    finalStatus: "running",
    finalErrorCode: null,
    finalErrorStage: null,
  };
}

export function startStage(
  trace: PemGenerationTrace,
  name: PemGenerationStageName,
  meta?: { model?: string; provider?: string; api?: string; attempt?: number },
): PemGenerationStageTrace {
  const stage: PemGenerationStageTrace = {
    name,
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    model: meta?.model ?? null,
    provider: meta?.provider ?? null,
    api: meta?.api ?? null,
    attempt: meta?.attempt ?? 1,
    status: "running",
    outputCharacters: null,
    finishReason: null,
    validationStatus: null,
    validationIssues: [],
    errorCode: null,
  };
  trace.stages.push(stage);
  return stage;
}

export function completeStage(
  stage: PemGenerationStageTrace,
  patch: Partial<PemGenerationStageTrace>,
) {
  const now = new Date().toISOString();
  stage.completedAt = now;
  if (stage.startedAt) {
    stage.durationMs = Date.parse(now) - Date.parse(stage.startedAt);
  }
  Object.assign(stage, patch);
  if (!stage.status || stage.status === "running") {
    stage.status = patch.status ?? "completed";
  }
}

export function failTrace(trace: PemGenerationTrace, code: string, stageName?: string) {
  trace.finalStatus = "failed";
  trace.finalErrorCode = code;
  trace.finalErrorStage = stageName ?? trace.stages.at(-1)?.name ?? null;
  trace.completedAt = new Date().toISOString();
}

export function succeedTrace(trace: PemGenerationTrace) {
  trace.finalStatus = "completed";
  trace.finalErrorCode = null;
  trace.finalErrorStage = null;
  trace.completedAt = new Date().toISOString();
}

/** Employee-safe failure message (no internals). */
export function employeeFacingPemError(code: string): string {
  switch (code) {
    case "PEM_LOW_EVIDENCE_COVERAGE":
    case "PEM_FACT_EXTRACTION_EMPTY":
      return "Baxter couldn't reliably extract enough information from this transcript. Your transcript is saved and can be retried.";
    case "PEM_OUTPUT_TRUNCATED":
      return "Baxter's analysis was truncated before it finished. Your transcript is saved — try again.";
    case "PEM_NEAT_TIMEOUT":
    case "PEM_TIMEOUT":
      return "PEM analysis took too long. Your transcript is saved and can be retried.";
    case "PEM_NEAT_RATE_LIMITED":
      return "OpenAI is temporarily rate limited. Try again shortly.";
    case "PEM_NEAT_QUOTA_EXCEEDED":
      return "OpenAI quota or billing is preventing PEM generation.";
    case "PEM_NEAT_MODEL_NOT_AVAILABLE":
      return "Configured PEM AI model is not available to this OpenAI project.";
    default:
      return "Baxter couldn't safely finish this NEAT. Your transcript is saved and can be retried.";
  }
}

/** Map legacy codes to new stage-specific codes when possible. */
export function normalizePemErrorCode(code: string): string {
  if (code === "PEM_NEAT_SCHEMA_INVALID") return "PEM_FINAL_MERGE_INVALID";
  if (code === "PEM_NEAT_INVALID_JSON") return "PEM_FACT_SCHEMA_INVALID";
  if (code === "PEM_NEAT_LOW_EVIDENCE_COVERAGE") return "PEM_LOW_EVIDENCE_COVERAGE";
  if (code === "PEM_NEAT_OUTPUT_TRUNCATED") return "PEM_OUTPUT_TRUNCATED";
  if (code === "PEM_NEAT_PROVIDER_INCOMPLETE") return "PEM_PROVIDER_INCOMPLETE";
  if (code === "PEM_NEAT_PROVIDER_REFUSAL") return "PEM_PROVIDER_REFUSAL";
  return code;
}
