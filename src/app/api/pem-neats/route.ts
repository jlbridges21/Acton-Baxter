import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError, AppError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { createPemNeatInputSchema } from "@/lib/pem-neat/schemas";
import { getPemNeatStore } from "@/lib/pem-neat/store";
import { generatePemNeat, getPemNeatStandardVersion } from "@/lib/pem-neat/generate";
import { resolveSalespersonDisplayName } from "@/lib/pem-neat/salespeople";

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
      throw new AppError("Select a valid salesperson from Baxter users", {
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

    await store.markGenerating(record.id);

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

      console.info("[pem-neat] generated", {
        id: saved.id,
        status: saved.status,
        model: saved.model_name,
        latencyMs: saved.generation_latency_ms,
      });

      return jsonOk({ id: saved.id, status: saved.status }, { status: 201 });
    } catch (genError) {
      const message = genError instanceof Error ? genError.message : "Generation failed";
      await store.saveGenerationFailure(record.id, {
        errorMessage: message.slice(0, 500),
      });
      console.error("[pem-neat] generation failed", {
        id: record.id,
        code: genError instanceof AppError ? genError.code : "UNKNOWN",
      });
      throw genError;
    }
  } catch (error) {
    return jsonError(error, "POST /api/pem-neats");
  }
}
