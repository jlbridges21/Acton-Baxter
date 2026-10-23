/**
 * Workflow definitions: what administrators build in Sam Operations Studio.
 *
 * A definition is configuration only — a list of steps drawn from a fixed registry of step
 * types, each backed by a real handler in src/lib/ops/engine.ts. Nothing here can carry code.
 * Shared by the server (validation) and the browser (the visual editor).
 */

import { z } from "zod";

/** Roles a step can be assigned to. Concrete people come from leadership decisions. */
export const ASSIGNEE_ROLES = [
  "ceo",
  "coo",
  "leadership",
  "hr_admin",
  "finance_owner",
  "hiring_manager",
  "employee",
  "specific_person",
] as const;
export type AssigneeRole = (typeof ASSIGNEE_ROLES)[number];

export const ROLE_LABELS: Record<AssigneeRole, string> = {
  ceo: "CEO",
  coo: "COO",
  leadership: "CEO or COO",
  hr_admin: "HR administrator",
  finance_owner: "Head of finance",
  hiring_manager: "Hiring manager",
  employee: "The employee",
  specific_person: "A specific person",
};

/**
 * Executable actions. Every one is proposed as an ops_actions row and runs only after a
 * CEO/COO approval bound to its exact payload (or explicit leadership-enabled autonomy).
 */
export const ACTION_TYPES = [
  "send_email",
  "notify_slack",
  "bamboohr_update",
  "calendar_event",
  "docusign_send",
  "drive_file",
  "publish_vacancy",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Platform actions that also need CEO/COO approval (not configurable as workflow steps). */
export const INTERNAL_ACTIONS = [
  "start_workflow",
  "approve_step",
  "publish_workflow",
  "approve_item",
] as const;
export type InternalAction = (typeof INTERNAL_ACTIONS)[number];
export type AnyAction = ActionType | InternalAction;

export const ACTION_LABELS: Record<AnyAction, string> = {
  start_workflow: "Start a workflow (approved employee or business event)",
  approve_step: "Leadership approval step",
  publish_workflow: "Publish a workflow version",
  approve_item: "Approve a survey, template, or vacancy",
  send_email: "Send an email",
  notify_slack: "Send a Slack message",
  bamboohr_update: "Update a BambooHR record",
  calendar_event: "Create or change a calendar event",
  docusign_send: "Send a DocuSign signature request",
  drive_file: "File a document in Google Drive",
  publish_vacancy: "Publish a job listing",
};

/** Step types with implemented handlers. Keep in sync with engine.ts. */
export const STEP_TYPES = {
  manual_task: {
    label: "Task",
    description: "A person completes it and records evidence.",
    human: true,
  },
  checklist: { label: "Checklist", description: "A person ticks off listed items.", human: true },
  collect_information: {
    label: "Collect information",
    description: "A person fills in required fields.",
    human: true,
  },
  upload_document: {
    label: "Upload document",
    description: "A required document is uploaded to private storage.",
    human: true,
  },
  verify_document: {
    label: "Verify document",
    description: "A person confirms an uploaded document is correct.",
    human: true,
  },
  approval: {
    label: "Leadership approval",
    description: "The CEO or COO approves before anything after it runs.",
    human: false,
  },
  access_request: {
    label: "Access request (COO)",
    description: "The COO provisions or removes access and confirms. Sam never grants access.",
    human: true,
  },
  finance_handoff: {
    label: "Finance handoff",
    description: "Routed to the head of finance. Sam never executes finance steps.",
    human: true,
  },
  communication: {
    label: "Communication",
    description: "Sam drafts a message from a template; it sends only after approval.",
    human: false,
  },
  external_action: {
    label: "System update",
    description: "A BambooHR, Drive, calendar, or DocuSign action that runs only after approval.",
    human: false,
  },
  wait_until: {
    label: "Wait until",
    description: "Pauses until a date relative to the start date.",
    human: false,
  },
  escalate: {
    label: "Escalate",
    description: "Notifies leadership (approval-controlled like any message).",
    human: false,
  },
  milestone: {
    label: "Milestone",
    description: "Completes automatically when everything before it is done.",
    human: false,
  },
} as const;
export type StepType = keyof typeof STEP_TYPES;

const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,40}$/, "Use lowercase letters, numbers, dashes, or underscores.");

export const stepDefinitionSchema = z.object({
  key,
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000).default(""),
  type: z.enum(Object.keys(STEP_TYPES) as [StepType, ...StepType[]]),
  /** Timeline grouping, e.g. "Before start date". Purely presentational. */
  stage: z.string().trim().max(60).default(""),
  assignee: z
    .object({ role: z.enum(ASSIGNEE_ROLES), profileId: z.string().uuid().nullable().default(null) })
    .default({ role: "hr_admin", profileId: null }),
  dependsOn: z.array(key).max(20).default([]),
  /** Due date: days relative to the workflow's anchor date (negative = before). */
  dueOffsetDays: z.number().int().min(-365).max(365).nullable().default(null),
  reminder: z
    .object({
      everyDays: z.number().int().min(1).max(30).nullable().default(null),
      escalateAfterDays: z.number().int().min(1).max(60).nullable().default(null),
    })
    .default({ everyDays: null, escalateAfterDays: null }),
  evidenceRequired: z.boolean().default(false),
  /** Checklist items, required fields, document category, message template, action config… */
  checklist: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  fields: z
    .array(
      z.object({
        key,
        label: z.string().trim().min(1).max(80),
        required: z.boolean().default(true),
      }),
    )
    .max(30)
    .default([]),
  documentCategory: z.string().trim().max(80).default(""),
  message: z
    .object({
      channel: z.enum(["email", "slack"]).default("email"),
      recipient: z
        .enum(["employee", "assignee", "leadership", "finance_owner", "custom"])
        .default("employee"),
      customRecipient: z.string().max(200).default(""),
      subject: z.string().max(300).default(""),
      body: z.string().max(10_000).default(""),
    })
    .default({
      channel: "email",
      recipient: "employee",
      customRecipient: "",
      subject: "",
      body: "",
    }),
  action: z
    .object({
      type: z.enum(ACTION_TYPES).nullable().default(null),
      /** e.g. BambooHR field mapping keys, Drive folder setting key, template id. */
      settings: z.record(z.string(), z.string().max(500)).default({}),
    })
    .default({ type: null, settings: {} }),
  /** wait_until: days relative to the anchor date. */
  waitOffsetDays: z.number().int().min(-365).max(365).nullable().default(null),
});
export type StepDefinition = z.infer<typeof stepDefinitionSchema>;

export const workflowDefinitionSchema = z.object({
  /** Which input is the anchor for due dates ("start_date" for onboarding, "end_date" for offboarding). */
  anchor: z
    .enum(["start_date", "end_date", "workflow_start", "target_date"])
    .default("workflow_start"),
  inputs: z
    .array(
      z.object({
        key,
        label: z.string().trim().min(1).max(80),
        type: z.enum(["text", "date", "email", "person", "entity"]).default("text"),
        required: z.boolean().default(true),
      }),
    )
    .max(30)
    .default([]),
  /** Legal entities this workflow applies to (keys). Empty = any confirmed entity. */
  entities: z.array(z.string().max(40)).max(10).default([]),
  stages: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  steps: z.array(stepDefinitionSchema).min(1).max(80),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export type DefinitionIssue = { step?: string; message: string; severity: "error" | "warning" };

/** Structural validation beyond the schema: references, cycles, and safety rules. */
export function validateDefinition(def: WorkflowDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const keys = new Set<string>();
  for (const s of def.steps) {
    if (keys.has(s.key))
      issues.push({ step: s.key, message: `Two steps use the id "${s.key}".`, severity: "error" });
    keys.add(s.key);
  }
  for (const s of def.steps) {
    for (const d of s.dependsOn) {
      if (!keys.has(d))
        issues.push({
          step: s.key,
          message: `"${s.title}" depends on a missing step "${d}".`,
          severity: "error",
        });
      if (d === s.key)
        issues.push({
          step: s.key,
          message: `"${s.title}" can't depend on itself.`,
          severity: "error",
        });
    }
    if (s.type === "access_request" && s.assignee.role !== "coo") {
      issues.push({
        step: s.key,
        message: `"${s.title}": access steps must be assigned to the COO (the COO controls access).`,
        severity: "error",
      });
    }
    if (s.type === "finance_handoff" && s.assignee.role !== "finance_owner") {
      issues.push({
        step: s.key,
        message: `"${s.title}": finance steps must be routed to the head of finance.`,
        severity: "error",
      });
    }
    if (s.type === "approval" && !["ceo", "coo", "leadership"].includes(s.assignee.role)) {
      issues.push({
        step: s.key,
        message: `"${s.title}": approvals must come from the CEO or COO.`,
        severity: "error",
      });
    }
    if (s.assignee.role === "specific_person" && !s.assignee.profileId) {
      issues.push({ step: s.key, message: `"${s.title}": choose the person.`, severity: "error" });
    }
    if (s.type === "communication" && !s.message.body.trim()) {
      issues.push({
        step: s.key,
        message: `"${s.title}": add the message text.`,
        severity: "error",
      });
    }
    if (
      s.type === "communication" &&
      s.message.recipient === "custom" &&
      !s.message.customRecipient.trim()
    ) {
      issues.push({
        step: s.key,
        message: `"${s.title}": enter the recipient.`,
        severity: "error",
      });
    }
    if (s.type === "external_action" && !s.action.type) {
      issues.push({
        step: s.key,
        message: `"${s.title}": choose which system action to run.`,
        severity: "error",
      });
    }
    if (s.type === "upload_document" && !s.documentCategory.trim()) {
      issues.push({
        step: s.key,
        message: `"${s.title}": name the document category.`,
        severity: "error",
      });
    }
    if (s.type === "collect_information" && !s.fields.length) {
      issues.push({
        step: s.key,
        message: `"${s.title}": add at least one field.`,
        severity: "error",
      });
    }
    if (s.type === "wait_until" && s.waitOffsetDays === null) {
      issues.push({
        step: s.key,
        message: `"${s.title}": set how many days from the anchor date to wait.`,
        severity: "error",
      });
    }
    if (s.reminder.escalateAfterDays && s.dueOffsetDays === null) {
      issues.push({
        step: s.key,
        message: `"${s.title}": escalation needs a due date.`,
        severity: "warning",
      });
    }
  }
  // Cycle detection (depth-first).
  const graph = new Map(def.steps.map((s) => [s.key, s.dependsOn]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (k: string, path: string[]): boolean => {
    if (state.get(k) === 2) return false;
    if (state.get(k) === 1) {
      issues.push({
        step: k,
        message: `Steps depend on each other in a loop: ${[...path, k].join(" → ")}.`,
        severity: "error",
      });
      return true;
    }
    state.set(k, 1);
    for (const d of graph.get(k) ?? []) if (graph.has(d) && visit(d, [...path, k])) return true;
    state.set(k, 2);
    return false;
  };
  for (const k of graph.keys()) if (visit(k, [])) break;
  if (
    def.steps.some((s) => s.dueOffsetDays !== null || s.type === "wait_until") &&
    def.anchor !== "workflow_start" &&
    !def.inputs.some((i) => i.key === def.anchor && i.type === "date")
  ) {
    issues.push({
      message: `Due dates are relative to "${def.anchor}", so add a required date input with that key.`,
      severity: "error",
    });
  }
  return issues;
}

/** Merge-field rendering for message templates: {{employee_name}}, {{start_date}}, … Unknown fields stay visible. */
export function renderTemplate(
  text: string,
  values: Record<string, string | null | undefined>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, name: string) => {
    const v = values[name.toLowerCase()];
    if (v === undefined || v === null || v === "") {
      missing.add(name.toLowerCase());
      return whole;
    }
    return v;
  });
  return { text: out, missing: [...missing] };
}
