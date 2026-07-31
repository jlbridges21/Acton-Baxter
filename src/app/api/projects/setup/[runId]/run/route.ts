import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getProjectSetupRun } from "@/lib/project-setup/store";
import { enqueueProjectSetupRun } from "@/lib/project-setup/enqueue";
import {
  updateProjectSetupRun,
  getProjectSetupSteps,
  updateProjectSetupStep,
} from "@/lib/project-setup/store";

export const maxDuration = 60;

/** Kick / resume a run (durable job + after()). */
export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    await requireActiveUser();
    const { runId } = await context.params;
    const run = await getProjectSetupRun(runId);
    if (!run) {
      throw new AppError("Project setup run not found", {
        code: "NOT_FOUND",
        statusCode: 404,
      });
    }

    if (run.status === "complete") {
      return jsonOk({ runId, status: run.status, message: "Already complete" });
    }

    if (run.status === "cancelled") {
      throw new AppError("This run was cancelled and cannot be resumed.", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    // Reset failed step to pending so the runner can resume.
    if (run.status === "failed") {
      const steps = await getProjectSetupSteps(runId);
      for (const step of steps) {
        if (step.status === "failed" || step.status === "running") {
          await updateProjectSetupStep(step.id, {
            status: "pending",
            error: null,
            startedAt: null,
            finishedAt: null,
          });
        }
      }
      await updateProjectSetupRun(runId, {
        status: "confirmed",
        error: null,
        finishedAt: null,
      });
    }

    const { jobId } = await enqueueProjectSetupRun(runId);
    return jsonOk({ runId, jobId, status: "queued" });
  } catch (error) {
    return jsonError(error, "POST /api/projects/setup/[runId]/run");
  }
}
