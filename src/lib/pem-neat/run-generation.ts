import "server-only";

import { after } from "next/server";
import { AppError } from "@/lib/errors";
import { enqueueJob, usesMemoryJobStore } from "@/lib/jobs/queue";
import {
  employeeFacingPemError,
  normalizePemErrorCode,
  type PemGenerationTrace,
} from "@/lib/pem-neat/trace";
import {
  generatePemNeat,
  getPemNeatStandardVersion,
  type PemStageOutputs,
} from "@/lib/pem-neat/generate";
import { getPemNeatStore } from "@/lib/pem-neat/store";

/**
 * Start PEM generation as a durable background job.
 * Memory/E2E: process immediately. Production: enqueue + after() runner.
 */
export async function startPemNeatGeneration(pemNeatId: string): Promise<{
  id: string;
  status: string;
  jobId: string | null;
}> {
  const store = getPemNeatStore();
  const existing = await store.get(pemNeatId);
  if (!existing) {
    throw new AppError("PEM NEAT not found", { code: "NOT_FOUND", statusCode: 404 });
  }
  if (!existing.transcript?.trim()) {
    throw new AppError("Cannot generate without a stored transcript", {
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }

  await store.markGenerating(pemNeatId);
  await store.updateGenerationProgress(pemNeatId, {
    stage: "queued",
    trace: null,
    stageOutputs: (existing as { stage_outputs_json?: PemStageOutputs }).stage_outputs_json ?? {},
  });

  const job = await enqueueJob({
    jobType: "pem_neat_generate",
    metadata: { pemNeatId },
  });

  await store.setGenerationJobId(pemNeatId, job.id);

  const run = async () => {
    try {
      await runPemNeatGenerationJob(pemNeatId);
    } catch (error) {
      console.error("[pem-neat] background generation failed", {
        pemNeatId,
        code: error instanceof AppError ? error.code : "PEM_FACT_EXTRACTION_FAILED",
      });
    }
  };

  if (usesMemoryJobStore()) {
    await run();
  } else {
    after(run);
  }

  return { id: pemNeatId, status: "generating", jobId: job.id };
}

/** Execute (or resume) PEM generation for a stored record. */
export async function runPemNeatGenerationJob(pemNeatId: string): Promise<void> {
  const store = getPemNeatStore();
  const existing = await store.get(pemNeatId);
  if (!existing) {
    throw new AppError("PEM NEAT not found", { code: "NOT_FOUND", statusCode: 404 });
  }

  const started = Date.now();
  const priorOutputs =
    ((existing as { stage_outputs_json?: PemStageOutputs })
      .stage_outputs_json as PemStageOutputs) ?? {};

  try {
    const generated = await generatePemNeat({
      prospectName: existing.prospect_name,
      advisorName: existing.salesperson_display_name,
      meetingDate: existing.meeting_date,
      transcript: existing.transcript,
      priorStageOutputs: priorOutputs,
      onProgress: async (update) => {
        await store.updateGenerationProgress(pemNeatId, {
          stage: update.stage,
          trace: update.trace,
          stageOutputs: update.stageOutputs,
        });
      },
    });

    await store.saveGenerationSuccess(pemNeatId, {
      structuredResult: generated.result,
      buildertrendFields: generated.result.buildertrendFields,
      analysisMetadata: {
        ...generated.result.analysisMetadata,
        transcriptStrategy: generated.transcriptStrategy,
        standardVersion: getPemNeatStandardVersion(),
        diagnostics: generated.diagnostics,
      },
      meetingOutcome: generated.result.salesIntelligence.meetingOutcome.classification,
      qualification: generated.result.salesIntelligence.qualification.classification,
      modelProvider: generated.modelProvider,
      modelName: generated.modelName,
      latencyMs: generated.latencyMs,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      neatStandardVersion: getPemNeatStandardVersion(),
      transcriptHash: existing.transcript_hash,
      diagnostics: {
        ...generated.diagnostics,
        trace: generated.diagnostics.trace,
      },
      finishReason: generated.diagnostics.finishReasons.at(-1) ?? null,
      stageOutputs: generated.diagnostics.stageOutputs,
      generationTrace: generated.diagnostics.trace ?? null,
    });
  } catch (genError) {
    const latest = (await store.get(pemNeatId)) as {
      generation_trace_json?: PemGenerationTrace;
      stage_outputs_json?: PemStageOutputs;
    } | null;
    const failedStage = latest?.generation_trace_json?.finalErrorStage ?? null;
    const code =
      genError instanceof AppError
        ? normalizePemErrorCode(genError.code, failedStage)
        : "PEM_FACT_EXTRACTION_FAILED";
    const message = employeeFacingPemError(code, failedStage);
    const trace = latest;

    await store.saveGenerationFailure(pemNeatId, {
      errorMessage: message,
      errorCode: code,
      latencyMs: Date.now() - started,
      transcriptHash: existing.transcript_hash,
      diagnostics: {
        trace: trace?.generation_trace_json ?? null,
        stageOutputs: trace?.stage_outputs_json ?? priorOutputs,
      },
      stageOutputs: trace?.stage_outputs_json ?? priorOutputs,
      generationTrace: trace?.generation_trace_json ?? null,
      failedStage,
    });
    throw genError instanceof AppError
      ? genError
      : new AppError(message, { code, statusCode: 502, cause: genError });
  }
}
