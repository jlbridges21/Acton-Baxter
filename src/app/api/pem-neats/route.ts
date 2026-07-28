import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError, AppError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { createPemNeatInputSchema } from "@/lib/pem-neat/schemas";
import { getPemNeatStore } from "@/lib/pem-neat/store";
import { generatePemNeat, getPemNeatStandardVersion } from "@/lib/pem-neat/generate";
import { resolveSalespersonDisplayName } from "@/lib/pem-neat/salespeople";

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    await requireActiveUser();
    const { searchParams } = new URL(request.url);
    const items = await getPemNeatStore().list({
      query: searchParams.get("q") ?? undefined,
      salespersonUserId: searchParams.get("salesperson") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      outcome: searchParams.get("outcome") ?? undefined,
    });
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error, "GET /api/pem-neats");
  }
}

export async function POST(request: Request) {
  let createdId: string | null = null;
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`pem-neat-create:${user.id}`, { limit: 10, windowMs: 60_000 });
    if (!rate.allowed) {
      throw new RateLimitError();
    }

    const body = await request.json();
    const parsed = createPemNeatInputSchema.parse(body);
    const salesperson = await resolveSalespersonDisplayName(parsed.salespersonUserId);
    if (!salesperson) {
      throw new AppError("Select a valid salesperson from the Sales department", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const store = getPemNeatStore();
    const record = await store.create({
      prospectName: parsed.prospectName,
      salespersonUserId: parsed.salespersonUserId,
      salespersonDisplayName: salesperson.displayName,
      meetingDate: parsed.meetingDate ?? null,
      transcript: parsed.transcript,
      createdBy: user.id,
    });
    createdId = record.id;

    await store.markGenerating(record.id);
    const started = Date.now();

    try {
      const generated = await generatePemNeat({
        prospectName: record.prospect_name,
        advisorName: record.salesperson_display_name,
        meetingDate: record.meeting_date,
        transcript: record.transcript,
      });

      const saved = await store.saveGenerationSuccess(record.id, {
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
        transcriptHash: record.transcript_hash,
        diagnostics: generated.diagnostics,
        finishReason: generated.diagnostics.finishReasons.at(-1) ?? null,
      });

      console.info("[pem-neat] generated", {
        id: saved.id,
        status: saved.status,
        model: saved.model_name,
        latencyMs: saved.generation_latency_ms,
        stages: generated.diagnostics.stages,
      });

      return jsonOk({ id: saved.id, status: saved.status }, { status: 201 });
    } catch (genError) {
      const message =
        genError instanceof AppError
          ? genError.message
          : "Unable to generate PEM NEAT. Baxter couldn't complete the analysis. Your transcript has been saved.";
      const code = genError instanceof AppError ? genError.code : "PEM_NEAT_PROVIDER_ERROR";
      try {
        await store.saveGenerationFailure(record.id, {
          errorMessage: message.slice(0, 500),
          errorCode: code,
          latencyMs: Date.now() - started,
          transcriptHash: record.transcript_hash,
        });
      } catch (persistError) {
        console.error("[pem-neat] failed to persist generation failure", {
          id: record.id,
          code: persistError instanceof AppError ? persistError.code : "UNKNOWN",
        });
      }
      console.error("[pem-neat] generation failed", {
        id: record.id,
        code,
      });
      // Record persisted — return id so the client can open Retry without re-pasting.
      return jsonOk(
        {
          id: record.id,
          status: "failed",
          message,
          errorCode: code,
        },
        { status: 201 },
      );
    }
  } catch (error) {
    if (createdId) {
      console.error("[pem-neat] create path error after persist", {
        id: createdId,
        code: error instanceof AppError ? error.code : "UNKNOWN",
      });
    }
    return jsonError(error, "POST /api/pem-neats");
  }
}
