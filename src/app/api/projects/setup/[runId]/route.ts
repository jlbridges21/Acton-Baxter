import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getProjectSetupRun, getProjectSetupSteps } from "@/lib/project-setup/store";
import { PROJECT_SETUP_STEPS } from "@/lib/project-setup/steps";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
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
    const steps = await getProjectSetupSteps(runId);
    const titles = Object.fromEntries(PROJECT_SETUP_STEPS.map((s) => [s.key, s.title]));

    return jsonOk({
      run,
      steps: steps.map((s) => ({
        ...s,
        title: titles[s.stepKey] ?? s.stepKey,
      })),
    });
  } catch (error) {
    return jsonError(error, "GET /api/projects/setup/[runId]");
  }
}
