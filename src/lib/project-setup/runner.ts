import "server-only";

import { PROJECT_SETUP_STEPS } from "./steps";
import {
  ensureProjectSetupStepRows,
  getProjectSetupRun,
  getProjectSetupSettings,
  getProjectSetupSteps,
  updateProjectSetupRun,
  updateProjectSetupStep,
} from "./store";
import type { ProjectSetupStep } from "./types";
import { notifyProjectSetupSlackInitiator } from "./notify-slack";
import { formatProjectSetupStepStatus } from "./step-status";

export { formatProjectSetupStepStatus };

/**
 * Execute a project setup run, resuming from the first non-terminal step.
 * Completed and planned steps are never re-executed (idempotent resume).
 */
export async function runProjectSetupJob(runId: string): Promise<{
  status: "complete" | "failed";
  completedSteps: number;
  failedStepKey?: string;
  error?: string;
}> {
  const run = await getProjectSetupRun(runId);
  if (!run) throw new Error("Project setup run not found");

  if (run.status === "complete") {
    return { status: "complete", completedSteps: PROJECT_SETUP_STEPS.length };
  }
  if (run.status === "cancelled") {
    return { status: "failed", completedSteps: 0, error: "Run was cancelled." };
  }

  await updateProjectSetupRun(runId, {
    status: "running",
    startedAt: run.startedAt ?? new Date().toISOString(),
    error: null,
  });

  const settings = await getProjectSetupSettings();
  let steps = await ensureProjectSetupStepRows(runId);
  const priorOutputs: Record<string, Record<string, unknown>> = {};
  for (const step of steps) {
    if (step.status === "complete" || step.status === "planned") {
      priorOutputs[step.stepKey] = step.outputJson;
    }
  }

  let completedSteps = steps.filter(
    (s) => s.status === "complete" || s.status === "planned" || s.status === "skipped",
  ).length;

  for (const definition of PROJECT_SETUP_STEPS) {
    steps = await getProjectSetupSteps(runId);
    const stepRow = steps.find((s) => s.stepKey === definition.key);
    if (!stepRow) {
      // ensureProjectSetupStepRows should have inserted it — fail loudly if still missing.
      await failRun(runId, `Missing step row for ${definition.key}`);
      const result = {
        status: "failed" as const,
        completedSteps,
        failedStepKey: definition.key,
        error: `Missing step row for ${definition.key}`,
      };
      await notifyProjectSetupSlackInitiator(runId, result);
      return result;
    }

    if (
      stepRow.status === "complete" ||
      stepRow.status === "skipped" ||
      stepRow.status === "planned"
    ) {
      priorOutputs[definition.key] = stepRow.outputJson;
      continue;
    }

    const startedAt = new Date().toISOString();
    await updateProjectSetupStep(stepRow.id, {
      status: "running",
      startedAt,
      error: null,
    });

    try {
      const currentRun = (await getProjectSetupRun(runId))!;
      const result = await definition.execute({
        run: currentRun,
        settings,
        priorOutputs,
        stepId: stepRow.id,
        partialOutput: stepRow.outputJson ?? {},
      });
      const finishedAt = new Date().toISOString();
      const stepStatus = result.status === "planned" ? "planned" : "complete";
      await updateProjectSetupStep(stepRow.id, {
        status: stepStatus,
        outputJson: result.outputJson,
        finishedAt,
        error: null,
      });
      priorOutputs[definition.key] = result.outputJson;
      completedSteps += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Step failed";
      await updateProjectSetupStep(stepRow.id, {
        status: "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      });
      await failRun(runId, message);
      const result = {
        status: "failed" as const,
        completedSteps,
        failedStepKey: definition.key,
        error: message,
      };
      await notifyProjectSetupSlackInitiator(runId, result);
      return result;
    }
  }

  await updateProjectSetupRun(runId, {
    status: "complete",
    finishedAt: new Date().toISOString(),
    error: null,
  });

  const result = { status: "complete" as const, completedSteps };
  await notifyProjectSetupSlackInitiator(runId, result);
  return result;
}

async function failRun(runId: string, error: string): Promise<void> {
  await updateProjectSetupRun(runId, {
    status: "failed",
    error,
    finishedAt: new Date().toISOString(),
  });
}

/** Pure helper for unit tests — next step to execute given step statuses. */
export function nextPendingStep(
  steps: Array<Pick<ProjectSetupStep, "stepKey" | "orderIndex" | "status">>,
): string | null {
  const ordered = [...steps].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const step of ordered) {
    if (step.status !== "complete" && step.status !== "skipped" && step.status !== "planned") {
      return step.stepKey;
    }
  }
  return null;
}
