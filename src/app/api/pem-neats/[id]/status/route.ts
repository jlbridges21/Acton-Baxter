import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { isAdminRole } from "@/lib/auth/roles";
import { getPemNeatStore } from "@/lib/pem-neat/store";

type RouteContext = { params: Promise<{ id: string }> };

/** Lightweight status poll for async PEM generation (no transcript). */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireActiveUser();
    const { id } = await context.params;
    const store = getPemNeatStore();
    const existing = await store.get(id);
    if (!existing) throw new NotFoundError("PEM NEAT not found");

    const trace = existing.generation_trace_json ?? {};
    const stageOutputs = (existing.stage_outputs_json ?? {}) as {
      validationDiagnostics?: {
        stage?: string;
        issues?: string[];
        shape?: string[];
      } | null;
    };
    const admin = isAdminRole(user.profile.role);
    const stages = Array.isArray((trace as { stages?: unknown }).stages)
      ? ((trace as { stages: Array<Record<string, unknown>> }).stages ?? []).map((s) => ({
          name: s.name,
          status: s.status,
          durationMs: s.durationMs,
          validationStatus: s.validationStatus,
          errorCode: s.errorCode ?? null,
        }))
      : [];

    const validationIssues = [
      ...(stageOutputs.validationDiagnostics?.issues ?? []),
      ...(stageOutputs.validationDiagnostics?.shape ?? []).map((s) => `shape: ${s}`),
    ].slice(0, 30);

    return jsonOk({
      id: existing.id,
      status: existing.status,
      generationStage: existing.generation_stage ?? null,
      modelName: existing.model_name,
      modelProvider: existing.model_provider,
      generationError: existing.generation_error,
      lastErrorCode: existing.last_error_code,
      generatedAt: existing.generated_at,
      adminDiagnostics: admin
        ? {
            stages,
            finalErrorCode: (trace as { finalErrorCode?: string | null }).finalErrorCode ?? null,
            finalErrorStage: (trace as { finalErrorStage?: string | null }).finalErrorStage ?? null,
            chunkCount:
              (trace as { transcript?: { chunkCount?: number } }).transcript?.chunkCount ?? null,
            validationIssues,
          }
        : null,
    });
  } catch (error) {
    return jsonError(error, "GET /api/pem-neats/[id]/status");
  }
}
