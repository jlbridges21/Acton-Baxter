import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, NotFoundError, RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { generatePemNeat, getPemNeatStandardVersion } from "@/lib/pem-neat/generate";
import { getPemNeatStore } from "@/lib/pem-neat/store";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 180;

/** Regenerate from the stored original transcript. Failure preserves last successful result. */
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
        },
        meetingOutcome: generated.result.salesIntelligence.meetingOutcome.classification,
        qualification: generated.result.salesIntelligence.qualification.classification,
        modelProvider: generated.modelProvider,
        modelName: generated.modelName,
        latencyMs: generated.latencyMs,
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
        neatStandardVersion: getPemNeatStandardVersion(),
      });

      console.info("[pem-neat] regenerated", {
        id: saved.id,
        status: saved.status,
        model: saved.model_name,
        latencyMs: saved.generation_latency_ms,
      });

      return jsonOk({ id: saved.id, status: saved.status });
    } catch (genError) {
      const message = genError instanceof Error ? genError.message : "Generation failed";
      await store.saveGenerationFailure(id, {
        errorMessage: message.slice(0, 500),
      });
      console.error("[pem-neat] regenerate failed", {
        id,
        code: genError instanceof AppError ? genError.code : "UNKNOWN",
      });
      throw genError;
    }
  } catch (error) {
    return jsonError(error, "POST /api/pem-neats/[id]/generate");
  }
}
