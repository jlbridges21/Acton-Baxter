import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, NotFoundError, RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { generatePemNeat, getPemNeatStandardVersion } from "@/lib/pem-neat/generate";
import { getPemNeatStore } from "@/lib/pem-neat/store";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 300;

function failurePayload(genError: unknown) {
  const message =
    genError instanceof AppError
      ? genError.message
      : "Unable to generate PEM NEAT. Baxter couldn't complete the analysis. Your transcript has been saved.";
  const code = genError instanceof AppError ? genError.code : "PEM_NEAT_PROVIDER_ERROR";
  return { message: message.slice(0, 500), code };
}

/** Regenerate from the stored transcript. Failure preserves last successful result. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`pem-neat-regen:${user.id}`, { limit: 5, windowMs: 60_000 });
    if (!rate.allowed) {
      throw new RateLimitError();
    }

    const { id } = await context.params;
    const store = getPemNeatStore();
    const existing = await store.get(id);
    if (!existing) {
      throw new NotFoundError("PEM NEAT not found");
    }
    if (!existing.transcript?.trim()) {
      throw new AppError("Cannot regenerate without a stored transcript", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    await store.markGenerating(id);
    const started = Date.now();

    try {
      const generated = await generatePemNeat({
        prospectName: existing.prospect_name,
        advisorName: existing.salesperson_display_name,
        meetingDate: existing.meeting_date,
        transcript: existing.transcript,
      });

      const saved = await store.saveGenerationSuccess(id, {
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
        diagnostics: generated.diagnostics,
        finishReason: generated.diagnostics.finishReasons.at(-1) ?? null,
      });

      console.info("[pem-neat] regenerated", {
        id: saved.id,
        status: saved.status,
        model: saved.model_name,
        latencyMs: saved.generation_latency_ms,
        stages: generated.diagnostics.stages,
      });

      return jsonOk({ id: saved.id, status: saved.status });
    } catch (genError) {
      const { message, code } = failurePayload(genError);
      await store.saveGenerationFailure(id, {
        errorMessage: message,
        errorCode: code,
        latencyMs: Date.now() - started,
        transcriptHash: existing.transcript_hash,
      });
      console.error("[pem-neat] regenerate failed", { id, code });
      throw genError instanceof AppError
        ? genError
        : new AppError(message, { code, statusCode: 502, cause: genError });
    }
  } catch (error) {
    return jsonError(error, "POST /api/pem-neats/[id]/generate");
  }
}
