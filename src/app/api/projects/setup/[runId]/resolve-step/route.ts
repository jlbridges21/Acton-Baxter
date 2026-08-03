import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { isAdminRole } from "@/lib/auth/roles";
import { manuallyResolveProjectSetupStep } from "@/lib/project-setup/manual-resolve";

export const maxDuration = 300;

/**
 * Admin-only: mark a failed step as manually resolved (with required outputs when
 * downstream steps need them), then resume the run.
 */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireActiveUser();
    if (!isAdminRole(user.profile.role)) {
      throw new AppError("Only admins can mark a step as manually resolved.", {
        code: "AUTHORIZATION_ERROR",
        statusCode: 403,
      });
    }

    const { runId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      stepId?: string;
      note?: string;
      outputs?: Record<string, string>;
    };

    if (!body.stepId?.trim()) {
      throw new AppError("stepId is required", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const result = await manuallyResolveProjectSetupStep({
      runId,
      stepId: body.stepId.trim(),
      note: typeof body.note === "string" ? body.note : "",
      outputs: body.outputs ?? {},
      resolvedBy: user.id,
      resolvedByEmail: user.email ?? null,
    });

    return jsonOk({ ...result, status: "queued" });
  } catch (error) {
    return jsonError(error, "POST /api/projects/setup/[runId]/resolve-step");
  }
}
