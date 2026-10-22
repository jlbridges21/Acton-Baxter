/**
 * Onboarding workflow templates and per-hire progress tracking.
 *
 * Data minimization: an onboarding instance stores only a display name, role/title,
 * and start date — no contact details, IDs, pay, or documents.
 */

import "server-only";

import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { agentDb, eq, inList, selectOne } from "./store";

export type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  is_placeholder: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TemplateStepRow = {
  id: string;
  template_id: string;
  position: number;
  title: string;
  description: string | null;
  responsible_label: string | null;
  due_offset_days: number;
  required_document: string | null;
  completion_requirement: string | null;
  depends_on_step_id: string | null;
  notification_template: string | null;
  created_at: string;
};

export type InstanceRow = {
  id: string;
  template_id: string | null;
  template_name: string;
  employee_display_name: string;
  employee_role: string | null;
  start_date: string | null;
  status: "active" | "completed" | "cancelled";
  owner_user_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InstanceStepStatus = "pending" | "in_progress" | "done" | "skipped" | "blocked";

export type InstanceStepRow = {
  id: string;
  instance_id: string;
  template_step_id: string | null;
  position: number;
  title: string;
  description: string | null;
  responsible_label: string | null;
  due_date: string | null;
  required_document: string | null;
  completion_requirement: string | null;
  depends_on_position: number | null;
  status: InstanceStepStatus;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const templateStepInputSchema = z.object({
  title: z.string().trim().min(1, "Every step needs a title.").max(200),
  description: optionalText(2000),
  responsible_label: optionalText(120),
  due_offset_days: z.number().int().min(-365).max(365).default(0),
  required_document: optionalText(300),
  completion_requirement: optionalText(300),
  /** 1-based position of the step this one depends on (must come earlier). */
  depends_on_position: z.number().int().min(1).nullable().optional(),
  notification_template: optionalText(4000),
});
export type TemplateStepInput = z.infer<typeof templateStepInputSchema>;

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
  steps: z.array(templateStepInputSchema).max(60),
});

export async function listTemplates(): Promise<TemplateRow[]> {
  return agentDb().select<TemplateRow>("ai_onboarding_templates", {
    order: { col: "created_at", ascending: false },
  });
}

export async function getTemplate(
  id: string,
): Promise<{ template: TemplateRow; steps: TemplateStepRow[] }> {
  const template = await selectOne<TemplateRow>("ai_onboarding_templates", {
    filters: [eq("id", id)],
  });
  if (!template) throw new NotFoundError("Onboarding template not found");
  const steps = await agentDb().select<TemplateStepRow>("ai_onboarding_template_steps", {
    filters: [eq("template_id", id)],
    order: { col: "position" },
  });
  return { template, steps };
}

function validateDependencies(steps: TemplateStepInput[]) {
  steps.forEach((step, index) => {
    const dep = step.depends_on_position;
    if (dep != null && dep >= index + 1) {
      throw new ValidationError(
        `Step ${index + 1} ("${step.title}") can only depend on an earlier step.`,
      );
    }
  });
}

async function writeSteps(templateId: string, steps: TemplateStepInput[]) {
  const db = agentDb();
  await db.remove("ai_onboarding_template_steps", [eq("template_id", templateId)]);
  const inserted: TemplateStepRow[] = [];
  for (const [index, step] of steps.entries()) {
    const dependsOn = step.depends_on_position ? inserted[step.depends_on_position - 1] : null;
    const [row] = await db.insert<TemplateStepRow>("ai_onboarding_template_steps", {
      template_id: templateId,
      position: index + 1,
      title: step.title,
      description: step.description,
      responsible_label: step.responsible_label,
      due_offset_days: step.due_offset_days,
      required_document: step.required_document,
      completion_requirement: step.completion_requirement,
      depends_on_step_id: dependsOn?.id ?? null,
      notification_template: step.notification_template,
    });
    inserted.push(row!);
  }
  return inserted;
}

export async function createTemplate(
  input: z.infer<typeof templateInputSchema>,
  createdBy: string | null,
): Promise<TemplateRow> {
  validateDependencies(input.steps);
  const [template] = await agentDb().insert<TemplateRow>("ai_onboarding_templates", {
    name: input.name,
    description: input.description,
    status: input.status,
    is_placeholder: false,
    created_by: createdBy,
  });
  await writeSteps(template!.id, input.steps);
  return template!;
}

export async function saveTemplate(
  id: string,
  input: z.infer<typeof templateInputSchema> & { is_placeholder?: boolean },
): Promise<TemplateRow> {
  validateDependencies(input.steps);
  await getTemplate(id);
  const [template] = await agentDb().update<TemplateRow>(
    "ai_onboarding_templates",
    [eq("id", id)],
    {
      name: input.name,
      description: input.description,
      status: input.status,
      ...(input.is_placeholder !== undefined ? { is_placeholder: input.is_placeholder } : {}),
    },
  );
  await writeSteps(id, input.steps);
  return template!;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const instanceInputSchema = z.object({
  templateId: z.string().uuid(),
  employeeDisplayName: z.string().trim().min(1, "Enter the new hire's name.").max(120),
  employeeRole: optionalText(120),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  notes: optionalText(2000),
});

export async function createInstance(
  input: z.infer<typeof instanceInputSchema>,
  createdBy: string | null,
): Promise<InstanceRow> {
  const { template, steps } = await getTemplate(input.templateId);
  if (template.status === "archived") throw new ValidationError("This template is archived.");
  if (steps.length === 0) throw new ValidationError("This template has no steps yet.");
  const positionById = new Map(steps.map((s) => [s.id, s.position]));
  const [instance] = await agentDb().insert<InstanceRow>("ai_onboarding_instances", {
    template_id: template.id,
    template_name: template.is_placeholder ? `${template.name}` : template.name,
    employee_display_name: input.employeeDisplayName,
    employee_role: input.employeeRole,
    start_date: input.startDate ?? null,
    status: "active",
    owner_user_id: createdBy,
    notes: input.notes,
    created_by: createdBy,
  });
  await agentDb().insert(
    "ai_onboarding_instance_steps",
    steps.map((s) => ({
      instance_id: instance!.id,
      template_step_id: s.id,
      position: s.position,
      title: s.title,
      description: s.description,
      responsible_label: s.responsible_label,
      due_date: input.startDate ? addDays(input.startDate, s.due_offset_days) : null,
      required_document: s.required_document,
      completion_requirement: s.completion_requirement,
      depends_on_position: s.depends_on_step_id
        ? (positionById.get(s.depends_on_step_id) ?? null)
        : null,
      status: "pending",
      completed_by: null,
      completed_at: null,
    })),
  );
  return instance!;
}

export async function listInstances(options?: { status?: InstanceRow["status"]; ids?: string[] }) {
  return agentDb().select<InstanceRow>("ai_onboarding_instances", {
    filters: [
      ...(options?.status ? [eq("status", options.status)] : []),
      ...(options?.ids ? [inList("id", options.ids)] : []),
    ],
    order: { col: "created_at", ascending: false },
  });
}

export async function getInstance(
  id: string,
): Promise<{ instance: InstanceRow; steps: InstanceStepRow[] }> {
  const instance = await selectOne<InstanceRow>("ai_onboarding_instances", {
    filters: [eq("id", id)],
  });
  if (!instance) throw new NotFoundError("Onboarding record not found");
  const steps = await agentDb().select<InstanceStepRow>("ai_onboarding_instance_steps", {
    filters: [eq("instance_id", id)],
    order: { col: "position" },
  });
  return { instance, steps };
}

export type OnboardingProgress = {
  total: number;
  done: number;
  percent: number;
  nextSteps: InstanceStepRow[];
  overdue: InstanceStepRow[];
};

export function summarizeProgress(
  steps: InstanceStepRow[],
  today = new Date().toISOString().slice(0, 10),
): OnboardingProgress {
  const finished = (s: InstanceStepRow) => s.status === "done" || s.status === "skipped";
  const byPosition = new Map(steps.map((s) => [s.position, s]));
  const ready = steps.filter((s) => {
    if (finished(s)) return false;
    const dep = s.depends_on_position ? byPosition.get(s.depends_on_position) : null;
    return !dep || finished(dep);
  });
  const done = steps.filter(finished).length;
  return {
    total: steps.length,
    done,
    percent: steps.length ? Math.round((done / steps.length) * 100) : 0,
    nextSteps: ready.slice(0, 3),
    overdue: steps.filter((s) => !finished(s) && s.due_date != null && s.due_date < today),
  };
}

export async function updateInstanceStep(
  stepId: string,
  status: InstanceStepStatus,
  userId: string | null,
): Promise<InstanceStepRow> {
  const step = await selectOne<InstanceStepRow>("ai_onboarding_instance_steps", {
    filters: [eq("id", stepId)],
  });
  if (!step) throw new NotFoundError("Step not found");
  const { instance, steps } = await getInstance(step.instance_id);
  if (instance.status !== "active")
    throw new ValidationError("This onboarding is no longer active.");
  if (status === "done" && step.depends_on_position) {
    const dep = steps.find((s) => s.position === step.depends_on_position);
    if (dep && dep.status !== "done" && dep.status !== "skipped") {
      throw new ValidationError(`Finish "${dep.title}" first — this step depends on it.`);
    }
  }
  const finishedNow = status === "done" || status === "skipped";
  const [updated] = await agentDb().update<InstanceStepRow>(
    "ai_onboarding_instance_steps",
    [eq("id", stepId)],
    {
      status,
      completed_by: finishedNow ? userId : null,
      completed_at: finishedNow ? new Date().toISOString() : null,
    },
  );
  const after = steps.map((s) => (s.id === stepId ? updated! : s));
  if (after.every((s) => s.status === "done" || s.status === "skipped")) {
    await agentDb().update("ai_onboarding_instances", [eq("id", instance.id)], {
      status: "completed",
    });
  }
  return updated!;
}

export async function setInstanceStatus(id: string, status: InstanceRow["status"]): Promise<void> {
  await agentDb().update("ai_onboarding_instances", [eq("id", id)], { status });
}
