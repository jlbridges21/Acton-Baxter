import "server-only";

import { AppError } from "@/lib/errors";
import { parseProjectNumber } from "./project-number";
import { enqueueProjectSetupRun } from "./enqueue";
import { MANUAL_RESOLVE_FIELDS, type ManualResolveField } from "./manual-resolve-fields";
import {
  getProjectSetupRun,
  getProjectSetupSteps,
  updateProjectSetupRun,
  updateProjectSetupStep,
} from "./store";
import type { ProjectSetupStepKey } from "./types";
import { PROJECT_SETUP_STEP_KEYS } from "./types";

export type { ManualResolveField };
export { MANUAL_RESOLVE_FIELDS };

export function requiredManualResolveFields(stepKey: ProjectSetupStepKey): ManualResolveField[] {
  return MANUAL_RESOLVE_FIELDS[stepKey].filter((f) => f.required);
}

export function isProjectSetupStepKey(value: string): value is ProjectSetupStepKey {
  return (PROJECT_SETUP_STEP_KEYS as readonly string[]).includes(value);
}

export type ManualResolveInput = {
  runId: string;
  stepId: string;
  note: string;
  outputs?: Record<string, string>;
  resolvedBy: string;
  resolvedByEmail?: string | null;
};

/**
 * Mark a failed step complete with admin-supplied outputs (when required) and a
 * required audit note, then resume the run from the next step.
 */
export async function manuallyResolveProjectSetupStep(input: ManualResolveInput): Promise<{
  runId: string;
  stepId: string;
  jobId: string;
}> {
  const note = input.note.trim();
  if (note.length < 8) {
    throw new AppError(
      "A short note explaining what you verified is required (at least 8 characters).",
      {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      },
    );
  }

  const run = await getProjectSetupRun(input.runId);
  if (!run) {
    throw new AppError("Project setup run not found", {
      code: "NOT_FOUND",
      statusCode: 404,
    });
  }
  if (run.status !== "failed") {
    throw new AppError("Only failed runs can have steps marked as manually resolved.", {
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }

  const steps = await getProjectSetupSteps(input.runId);
  const step = steps.find((s) => s.id === input.stepId);
  if (!step) {
    throw new AppError("Step not found on this run", {
      code: "NOT_FOUND",
      statusCode: 404,
    });
  }
  if (step.status !== "failed") {
    throw new AppError("Only a failed step can be marked as manually resolved.", {
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }

  const fields = MANUAL_RESOLVE_FIELDS[step.stepKey];
  const provided: Record<string, string> = {};
  for (const field of fields) {
    const raw = input.outputs?.[field.key]?.trim() ?? "";
    if (field.required && !raw) {
      throw new AppError(
        `Field "${field.label}" is required before resolving ${step.stepKey} — later steps depend on it.`,
        { code: "VALIDATION_ERROR", statusCode: 400 },
      );
    }
    if (raw) provided[field.key] = raw;
  }

  if (step.stepKey === "allocate_project_number" && provided.projectNumber) {
    const parsed = parseProjectNumber(provided.projectNumber);
    if (!parsed) {
      throw new AppError(`Project number "${provided.projectNumber}" is not valid.`, {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }
    provided.projectNumber = parsed.raw;
    await updateProjectSetupRun(run.id, { projectNumber: parsed.raw });
  }

  const resolvedAt = new Date().toISOString();
  const outputJson: Record<string, unknown> = {
    ...step.outputJson,
    mode: "live",
    executed: true,
    manuallyResolved: true,
    ...provided,
    manualResolution: {
      note,
      resolvedBy: input.resolvedBy,
      resolvedByEmail: input.resolvedByEmail ?? null,
      resolvedAt,
      providedOutputs: provided,
    },
  };

  await updateProjectSetupStep(step.id, {
    status: "complete",
    outputJson,
    error: null,
    finishedAt: resolvedAt,
  });

  for (const other of steps) {
    if (other.id === step.id) continue;
    if (other.status === "failed" || other.status === "running") {
      await updateProjectSetupStep(other.id, {
        status: "pending",
        error: null,
        startedAt: null,
        finishedAt: null,
      });
    }
  }

  await updateProjectSetupRun(run.id, {
    status: "confirmed",
    error: null,
    finishedAt: null,
  });

  const { jobId } = await enqueueProjectSetupRun(run.id);
  return { runId: run.id, stepId: step.id, jobId };
}
