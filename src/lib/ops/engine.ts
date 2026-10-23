/**
 * Sam Operations workflow engine: versioned templates, pinned instances, and a persisted step
 * state machine. Nothing long-running happens inside an HTTP request — requests change state,
 * and advanceInstance()/sweepOperations() (cron) move workflows forward. Every consequential
 * effect goes through actions.ts (CEO/COO approval bound to the exact payload).
 *
 * Step states: blocked → ready → (in_progress | awaiting_approval | waiting) → completed
 *              plus skipped (leadership override), failed, cancelled.
 */

import "server-only";

import { recordAudit } from "@/lib/agents/audit";
import { loadAuthEmailsByUserIds } from "@/lib/auth/load-profile-display";
import { agentDb, eq, inList, selectOne } from "@/lib/agents/store";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { executeAction, proposeAction, type ActionRow } from "./actions";
import {
  renderTemplate,
  ROLE_LABELS,
  STEP_TYPES,
  validateDefinition,
  workflowDefinitionSchema,
  type DefinitionIssue,
  type StepDefinition,
  type WorkflowDefinition,
} from "./definition";
import { getIntegrationSettings } from "./integrations";
import { getOpsRoles, requireOps, type OpsAccess, type OpsRoles } from "./org";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export type TemplateRow = {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string;
  status: "draft" | "published" | "archived";
  official: boolean;
  published_version_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type VersionRow = {
  id: string;
  template_id: string;
  version: number;
  status: "draft" | "published" | "superseded";
  definition: WorkflowDefinition;
  change_summary: string | null;
  created_by: string | null;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
export type InstanceRow = {
  id: string;
  template_id: string;
  version_id: string;
  entity_id: string | null;
  person_id: string | null;
  subject_label: string;
  status: "pending_approval" | "active" | "paused" | "completed" | "cancelled" | "failed";
  mode: "live" | "test";
  inputs: Record<string, string>;
  start_approval_id: string | null;
  started_by: string | null;
  idempotency_key: string | null;
  processing_until: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
export type StepRow = {
  id: string;
  instance_id: string;
  step_key: string;
  position: number;
  title: string;
  type: StepDefinition["type"];
  stage: string | null;
  config: StepDefinition;
  depends_on: string[];
  status:
    | "blocked"
    | "ready"
    | "in_progress"
    | "awaiting_approval"
    | "waiting"
    | "completed"
    | "skipped"
    | "failed"
    | "cancelled";
  assignee_profile_id: string | null;
  assignee_role: string | null;
  due_at: string | null;
  next_run_at: string | null;
  last_reminded_at: string | null;
  attempts: number;
  last_error: string | null;
  data: Record<string, unknown>;
  evidence: Array<{ kind: string; value: string; by: string | null; at: string }>;
  completed_by: string | null;
  completed_at: string | null;
  override_reason: string | null;
  created_at: string;
  updated_at: string;
};
type PersonRow = {
  id: string;
  entity_id: string | null;
  full_name: string;
  work_email: string | null;
  personal_email: string | null;
  position: string | null;
  department: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  bamboohr_id: string | null;
  profile_id: string | null;
  manager_profile_id: string | null;
};

const DONE = new Set(["completed", "skipped"]);
const DAY = 86_400_000;
const actorOf = (a: OpsAccess, label: string) => ({ userId: a.userId, label });

// ---------------------------------------------------------------------------
// Templates & versions
// ---------------------------------------------------------------------------
export async function listTemplates(): Promise<
  Array<TemplateRow & { latestVersion: VersionRow | null; publishedVersion: VersionRow | null }>
> {
  const [templates, versions] = await Promise.all([
    agentDb().select<TemplateRow>("ops_workflow_templates", { order: { col: "name" } }),
    agentDb().select<VersionRow>("ops_workflow_versions", {
      order: { col: "version", ascending: false },
    }),
  ]);
  return templates.map((t) => {
    const mine = versions.filter((v) => v.template_id === t.id);
    return {
      ...t,
      latestVersion: mine[0] ?? null,
      publishedVersion: mine.find((v) => v.id === t.published_version_id) ?? null,
    };
  });
}

export async function getTemplateDetail(id: string) {
  const template = await selectOne<TemplateRow>("ops_workflow_templates", {
    filters: [eq("id", id)],
  });
  if (!template) throw new NotFoundError("Workflow not found.");
  const versions = await agentDb().select<VersionRow>("ops_workflow_versions", {
    filters: [eq("template_id", id)],
    order: { col: "version", ascending: false },
  });
  return { template, versions };
}

export function parseDefinition(
  raw: unknown,
):
  | { ok: true; definition: WorkflowDefinition; issues: DefinitionIssue[] }
  | { ok: false; issues: DefinitionIssue[] } {
  const parsed = workflowDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 15).map((i) => ({
        message: `${i.path.join(".") || "workflow"}: ${i.message}`,
        severity: "error" as const,
      })),
    };
  }
  return { ok: true, definition: parsed.data, issues: validateDefinition(parsed.data) };
}

export async function createTemplate(input: {
  key: string;
  name: string;
  category: string;
  description: string;
  definition: unknown;
  access: OpsAccess;
  actorLabel: string;
}): Promise<TemplateRow> {
  requireOps(input.access, "configure");
  const parsed = parseDefinition(input.definition);
  if (!parsed.ok) throw new ValidationError(parsed.issues.map((i) => i.message).join("; "));
  if (await selectOne("ops_workflow_templates", { filters: [eq("key", input.key)] }))
    throw new ValidationError("A workflow with that id already exists.");
  const [t] = await agentDb().insert<TemplateRow>("ops_workflow_templates", {
    key: input.key,
    name: input.name.slice(0, 120),
    category: input.category.slice(0, 60),
    description: input.description.slice(0, 1000),
    status: "draft",
    official: false,
    published_version_id: null,
    created_by: input.access.userId,
  });
  await agentDb().insert("ops_workflow_versions", {
    template_id: t!.id,
    version: 1,
    status: "draft",
    definition: parsed.definition,
    change_summary: "Created",
    created_by: input.access.userId,
  });
  await recordAudit({
    actor: actorOf(input.access, input.actorLabel),
    action: "ops.workflow_created",
    targetType: "ops_workflow",
    targetId: t!.id,
    summary: `Created workflow "${t!.name}".`,
  });
  return t!;
}

/** Save the editor's definition as the draft (creating a new draft version if needed). */
export async function saveDraft(input: {
  templateId: string;
  definition: unknown;
  changeSummary: string;
  meta?: Partial<Pick<TemplateRow, "name" | "description" | "category">>;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const parsed = parseDefinition(input.definition);
  if (!parsed.ok) throw new ValidationError(parsed.issues.map((i) => i.message).join("; "));
  const { template, versions } = await getTemplateDetail(input.templateId);
  if (template.status === "archived")
    throw new ValidationError("Restore the workflow before editing it.");
  if (input.meta)
    await agentDb().update("ops_workflow_templates", [eq("id", template.id)], input.meta);
  const latest = versions[0];
  let version: VersionRow;
  if (latest?.status === "draft") {
    [version] = (await agentDb().update<VersionRow>(
      "ops_workflow_versions",
      [eq("id", latest.id)],
      { definition: parsed.definition, change_summary: input.changeSummary.slice(0, 300) },
    )) as [VersionRow];
  } else {
    [version] = (await agentDb().insert<VersionRow>("ops_workflow_versions", {
      template_id: template.id,
      version: (latest?.version ?? 0) + 1,
      status: "draft",
      definition: parsed.definition,
      change_summary: input.changeSummary.slice(0, 300),
      created_by: input.access.userId,
    })) as [VersionRow];
  }
  await recordAudit({
    actor: actorOf(input.access, input.actorLabel),
    action: "ops.workflow_draft_saved",
    targetType: "ops_workflow",
    targetId: template.id,
    summary: `Saved draft v${version.version} of "${template.name}": ${input.changeSummary.slice(0, 120)}`,
  });
  return { version, issues: parsed.issues };
}

/** Publishing changes what new workflows do, so it needs the CEO or COO. */
export async function requestPublish(input: {
  templateId: string;
  versionId: string;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const { template, versions } = await getTemplateDetail(input.templateId);
  const version = versions.find((v) => v.id === input.versionId);
  if (!version) throw new NotFoundError("Version not found.");
  const issues = validateDefinition(version.definition).filter((i) => i.severity === "error");
  if (issues.length)
    throw new ValidationError(`Fix these first: ${issues.map((i) => i.message).join("; ")}`);
  if (input.access.isLeadership) {
    await publishVersionNow(template.id, version.id, input.access.userId);
    return { published: true as const };
  }
  const action = await proposeAction({
    logicalKey: `publish:${template.id}:${version.id}`,
    actionType: "publish_workflow",
    title: `Publish "${template.name}" v${version.version}`,
    summary: version.change_summary ?? "Workflow changes",
    payload: { templateId: template.id, versionId: version.id, definition: version.definition },
    display: {
      target: `${template.name} (${version.definition.steps.length} steps)`,
      effect:
        "New workflows of this type will follow this version. Running workflows keep their version.",
    },
    mode: "live",
    risk: "medium",
    requestedBy: { userId: input.access.userId, label: input.actorLabel },
  });
  return { published: false as const, actionId: action.id };
}

export async function publishVersionNow(
  templateId: string,
  versionId: string,
  userId: string | null,
) {
  const { template, versions } = await getTemplateDetail(templateId);
  const version = versions.find((v) => v.id === versionId);
  if (!version) throw new NotFoundError("Version not found.");
  for (const v of versions.filter((x) => x.status === "published" && x.id !== versionId)) {
    await agentDb().update("ops_workflow_versions", [eq("id", v.id)], { status: "superseded" });
  }
  await agentDb().update("ops_workflow_versions", [eq("id", versionId)], {
    status: "published",
    published_by: userId,
    published_at: new Date().toISOString(),
  });
  await agentDb().update("ops_workflow_templates", [eq("id", template.id)], {
    status: "published",
    published_version_id: versionId,
  });
  await recordAudit({
    actor: { userId, label: "Leadership" },
    action: "ops.workflow_published",
    targetType: "ops_workflow",
    targetId: template.id,
    summary: `Published "${template.name}" v${version.version}.`,
  });
}

/** Rollback = copy an earlier version forward as a new draft (history is never rewritten). */
export async function rollbackToVersion(input: {
  templateId: string;
  versionId: string;
  access: OpsAccess;
  actorLabel: string;
}) {
  const { versions } = await getTemplateDetail(input.templateId);
  const source = versions.find((v) => v.id === input.versionId);
  if (!source) throw new NotFoundError("Version not found.");
  return saveDraft({
    templateId: input.templateId,
    definition: source.definition,
    changeSummary: `Rolled back to v${source.version}`,
    access: input.access,
    actorLabel: input.actorLabel,
  });
}

export async function setTemplateArchived(
  templateId: string,
  archived: boolean,
  access: OpsAccess,
  actorLabel: string,
) {
  requireOps(access, "configure");
  const { template } = await getTemplateDetail(templateId);
  await agentDb().update("ops_workflow_templates", [eq("id", templateId)], {
    status: archived ? "archived" : template.published_version_id ? "published" : "draft",
  });
  await recordAudit({
    actor: actorOf(access, actorLabel),
    action: archived ? "ops.workflow_archived" : "ops.workflow_restored",
    targetType: "ops_workflow",
    targetId: templateId,
    summary: `${archived ? "Archived" : "Restored"} "${template.name}".`,
  });
}

/** Human-readable differences between two definitions. */
export function diffDefinitions(a: WorkflowDefinition, b: WorkflowDefinition): string[] {
  const out: string[] = [];
  const am = new Map(a.steps.map((s) => [s.key, s]));
  const bm = new Map(b.steps.map((s) => [s.key, s]));
  for (const [k, s] of bm) if (!am.has(k)) out.push(`Added step "${s.title}"`);
  for (const [k, s] of am) if (!bm.has(k)) out.push(`Removed step "${s.title}"`);
  for (const [k, s] of bm) {
    const prev = am.get(k);
    if (!prev) continue;
    const changed = (Object.keys(s) as Array<keyof StepDefinition>).filter(
      (f) => JSON.stringify(s[f]) !== JSON.stringify(prev[f]),
    );
    if (changed.length) out.push(`Changed "${s.title}": ${changed.join(", ")}`);
  }
  if (
    a.steps.map((s) => s.key).join() !==
      b.steps
        .filter((s) => am.has(s.key))
        .map((s) => s.key)
        .join() &&
    out.length === 0
  )
    out.push("Reordered steps");
  if (JSON.stringify(a.inputs) !== JSON.stringify(b.inputs))
    out.push("Changed required starting information");
  return out;
}

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------
function addDays(date: string, days: number): string {
  return new Date(new Date(`${date.slice(0, 10)}T17:00:00Z`).getTime() + days * DAY).toISOString();
}

function anchorDate(
  def: WorkflowDefinition,
  instance: Pick<InstanceRow, "inputs" | "created_at">,
): string {
  return def.anchor === "workflow_start"
    ? instance.created_at.slice(0, 10)
    : (instance.inputs[def.anchor] ?? instance.created_at.slice(0, 10));
}

async function resolveAssignee(
  step: StepDefinition,
  roles: OpsRoles,
  person: PersonRow | null,
  inputs: Record<string, string>,
): Promise<{ profileId: string | null; role: string }> {
  switch (step.assignee.role) {
    case "ceo":
      return { profileId: roles.ceo, role: "ceo" };
    case "coo":
      return { profileId: roles.coo, role: "coo" };
    case "finance_owner":
      return { profileId: roles.financeOwner, role: "finance_owner" };
    case "employee":
      return { profileId: person?.profile_id ?? null, role: "employee" };
    case "hiring_manager":
      return {
        profileId:
          inputs.hiring_manager && /^[0-9a-f-]{36}$/i.test(inputs.hiring_manager)
            ? inputs.hiring_manager
            : (person?.manager_profile_id ?? null),
        role: "hiring_manager",
      };
    case "specific_person":
      return { profileId: step.assignee.profileId, role: "specific_person" };
    default:
      return { profileId: null, role: step.assignee.role };
  }
}

/**
 * Start a workflow for an approved employee/business event. The instance waits for a CEO/COO
 * approval before any step runs. Duplicate requests (same idempotency key) return the same instance.
 */
export async function startWorkflow(input: {
  templateId: string;
  entityId: string | null;
  personId: string | null;
  subjectLabel: string;
  inputs: Record<string, string>;
  mode: "live" | "test";
  idempotencyKey?: string;
  access: OpsAccess;
  actorLabel: string;
  /** Approval evidence shown to leadership, e.g. "Offer accepted 10/20 per Jackson". */
  reason: string;
}): Promise<InstanceRow> {
  requireOps(input.access, "configure");
  if (input.idempotencyKey) {
    const existing = await selectOne<InstanceRow>("ops_workflow_instances", {
      filters: [eq("idempotency_key", input.idempotencyKey)],
    });
    if (existing) return existing;
  }
  const { template } = await getTemplateDetail(input.templateId);
  if (template.status !== "published" || !template.published_version_id)
    throw new ValidationError("Only published workflows can be started.");
  const version = (await selectOne<VersionRow>("ops_workflow_versions", {
    filters: [eq("id", template.published_version_id)],
  }))!;
  const def = version.definition;
  const missing = def.inputs
    .filter((i) => i.required && !String(input.inputs[i.key] ?? "").trim())
    .map((i) => i.label);
  if (missing.length)
    throw new ValidationError(`Missing starting information: ${missing.join(", ")}.`);
  if (input.mode === "live" && !input.reason.trim())
    throw new ValidationError("Describe the approved event that starts this workflow.");
  const person = input.personId
    ? await selectOne<PersonRow>("ops_people", { filters: [eq("id", input.personId)] })
    : null;
  const roles = await getOpsRoles();
  const [instance] = await agentDb().insert<InstanceRow>("ops_workflow_instances", {
    template_id: template.id,
    version_id: version.id,
    entity_id: input.entityId,
    person_id: input.personId,
    subject_label: input.subjectLabel.slice(0, 160),
    status: "pending_approval",
    mode: input.mode,
    inputs: input.inputs,
    started_by: input.access.userId,
    idempotency_key: input.idempotencyKey ?? null,
  });
  const anchor = anchorDate(def, instance!);
  for (const [i, s] of def.steps.entries()) {
    const assignee = await resolveAssignee(s, roles, person, input.inputs);
    await agentDb().insert("ops_workflow_steps", {
      instance_id: instance!.id,
      step_key: s.key,
      position: i,
      title: s.title,
      type: s.type,
      stage: s.stage || null,
      config: s,
      depends_on: s.dependsOn,
      status: "blocked",
      assignee_profile_id: assignee.profileId,
      assignee_role: assignee.role,
      due_at: s.dueOffsetDays === null ? null : addDays(anchor, s.dueOffsetDays),
      data: {},
      evidence: [],
    });
  }
  const action = await proposeAction({
    logicalKey: `start:${instance!.id}`,
    actionType: "start_workflow",
    title: `Start ${template.name}: ${input.subjectLabel}`,
    summary: input.reason || "Test run",
    payload: {
      instanceId: instance!.id,
      templateId: template.id,
      version: version.version,
      inputs: input.inputs,
      entityId: input.entityId,
      personId: input.personId,
    },
    display: {
      target: input.subjectLabel,
      effect: `${def.steps.length} steps will begin; every message and system change still needs its own approval.`,
      evidence: [input.reason].filter(Boolean),
    },
    mode: input.mode,
    risk: "medium",
    instanceId: instance!.id,
    entityId: input.entityId,
    requestedBy: { userId: input.access.userId, label: input.actorLabel },
  });
  const [linked] = await agentDb().update<InstanceRow>(
    "ops_workflow_instances",
    [eq("id", instance!.id)],
    { start_approval_id: action.approval_request_id },
  );
  await recordAudit({
    actor: actorOf(input.access, input.actorLabel),
    action: "ops.workflow_requested",
    targetType: "ops_instance",
    targetId: instance!.id,
    summary: `Requested ${template.name} for ${input.subjectLabel} (${input.mode}).`,
  });
  if (action.status === "approved") await executeAction(action.id);
  return linked!;
}

export async function getInstanceDetail(id: string) {
  const instance = await selectOne<InstanceRow>("ops_workflow_instances", {
    filters: [eq("id", id)],
  });
  if (!instance) throw new NotFoundError("Workflow not found.");
  const [steps, actions, template, version] = await Promise.all([
    agentDb().select<StepRow>("ops_workflow_steps", {
      filters: [eq("instance_id", id)],
      order: { col: "position" },
    }),
    agentDb().select<ActionRow>("ops_actions", {
      filters: [eq("instance_id", id)],
      order: { col: "created_at", ascending: false },
    }),
    selectOne<TemplateRow>("ops_workflow_templates", { filters: [eq("id", instance.template_id)] }),
    selectOne<VersionRow>("ops_workflow_versions", { filters: [eq("id", instance.version_id)] }),
  ]);
  return { instance, steps, actions, template, version };
}

/** Merge values available to message templates. */
async function mergeValues(
  instance: InstanceRow,
  person: PersonRow | null,
): Promise<Record<string, string>> {
  const entity = instance.entity_id
    ? await selectOne<{ name: string }>("ops_entities", { filters: [eq("id", instance.entity_id)] })
    : null;
  return {
    ...instance.inputs,
    employee_name: person?.full_name ?? instance.subject_label,
    first_name: (person?.full_name ?? instance.subject_label).split(" ")[0] ?? "",
    position: person?.position ?? instance.inputs.position ?? "",
    start_date: person?.start_date ?? instance.inputs.start_date ?? "",
    end_date: person?.end_date ?? instance.inputs.end_date ?? "",
    entity_name: entity?.name ?? "",
    work_email: person?.work_email ?? "",
  };
}

async function emailsFor(ids: Array<string | null>): Promise<string[]> {
  const real = ids.filter((x): x is string => Boolean(x));
  if (!real.length) return [];
  const map = await loadAuthEmailsByUserIds(real).catch(() => new Map<string, string>());
  return real.map((id) => map.get(id)).filter((x): x is string => Boolean(x));
}

/** Build the action an automated step needs, or explain what's missing. */
async function prepareAutomatedStep(
  step: StepRow,
  instance: InstanceRow,
  person: PersonRow | null,
  roles: OpsRoles,
  actorLabel: string,
): Promise<{ action?: ActionRow; problem?: string }> {
  const cfg = step.config;
  const values = await mergeValues(instance, person);
  const requestedBy = { userId: instance.started_by, label: actorLabel };
  if (step.type === "approval") {
    return {
      action: await proposeAction({
        logicalKey: `step:${step.id}`,
        actionType: "approve_step",
        title: `${step.title} — ${instance.subject_label}`,
        summary: cfg.description || "Leadership approval required to continue.",
        payload: { stepId: step.id, instanceId: instance.id },
        display: {
          target: instance.subject_label,
          effect: "The workflow continues past this step.",
        },
        mode: instance.mode,
        instanceId: instance.id,
        stepId: step.id,
        entityId: instance.entity_id,
        requestedBy,
      }),
    };
  }
  if (step.type === "communication" || step.type === "escalate") {
    const msg = cfg.message;
    const subject = renderTemplate(msg.subject || step.title, values);
    const body = renderTemplate(
      step.type === "escalate"
        ? msg.body || `Escalation: "${step.title}" for ${instance.subject_label} needs attention.`
        : msg.body,
      values,
    );
    const missing = [...new Set([...subject.missing, ...body.missing])];
    if (missing.length)
      return {
        problem: `Missing information for the message: ${missing.join(", ")}. Add it to the workflow's starting information.`,
      };
    const recipient = step.type === "escalate" ? "leadership" : msg.recipient;
    if (msg.channel === "slack" || step.type === "escalate") {
      const profileIds =
        recipient === "leadership"
          ? [roles.ceo, roles.coo]
          : recipient === "finance_owner"
            ? [roles.financeOwner]
            : recipient === "assignee"
              ? [step.assignee_profile_id]
              : recipient === "employee"
                ? [person?.profile_id ?? null]
                : [];
      const ids = profileIds.filter((x): x is string => Boolean(x));
      if (!ids.length)
        return {
          problem: `No Baxter account is set for the ${recipient.replace("_", " ")} recipient.`,
        };
      return {
        action: await proposeAction({
          logicalKey: `step:${step.id}`,
          actionType: "notify_slack",
          title: `Slack: ${subject.text}`,
          summary: body.text.slice(0, 500),
          payload: { profileIds: ids, text: `${subject.text}\n\n${body.text}` },
          display: {
            target: `${ids.length} recipient(s) — ${recipient.replace("_", " ")}`,
            effect: "Sends a Slack direct message.",
          },
          mode: instance.mode,
          instanceId: instance.id,
          stepId: step.id,
          entityId: instance.entity_id,
          requestedBy,
        }),
      };
    }
    const to =
      recipient === "custom"
        ? msg.customRecipient
        : recipient === "employee"
          ? (person?.personal_email ?? person?.work_email ?? "")
          : (
              await emailsFor(
                recipient === "leadership"
                  ? [roles.ceo, roles.coo]
                  : recipient === "finance_owner"
                    ? [roles.financeOwner]
                    : [step.assignee_profile_id],
              )
            ).join(", ");
    if (!to || !/@/.test(to))
      return {
        problem: `No email address is on file for the ${recipient.replace("_", " ")} recipient.`,
      };
    return {
      action: await proposeAction({
        logicalKey: `step:${step.id}`,
        actionType: "send_email",
        title: `Email: ${subject.text}`,
        summary: body.text.slice(0, 500),
        payload: { to, subject: subject.text, body: body.text },
        display: { target: to, effect: "Sends this email." },
        mode: instance.mode,
        instanceId: instance.id,
        stepId: step.id,
        entityId: instance.entity_id,
        requestedBy,
      }),
    };
  }
  if (step.type === "external_action") {
    const type = cfg.action.type;
    const s = cfg.action.settings;
    if (type === "drive_file") {
      const category = s.documentCategory || cfg.documentCategory;
      const [doc] = await agentDb().select<{
        id: string;
        filename: string;
        drive_file_id: string | null;
      }>("ops_documents", {
        filters: [
          ...(instance.person_id
            ? [eq("person_id", instance.person_id)]
            : [eq("instance_id", instance.id)]),
          eq("category", category),
        ],
        order: { col: "version", ascending: false },
        limit: 1,
      });
      if (!doc) return { problem: `No "${category}" document has been uploaded yet.` };
      const folders = ((await getIntegrationSettings("google_drive")).config.folders ??
        {}) as Record<string, string>;
      const entityKey = instance.entity_id
        ? ((
            await selectOne<{ key: string }>("ops_entities", {
              filters: [eq("id", instance.entity_id)],
            })
          )?.key ?? "")
        : "";
      const folderId = folders[`${entityKey}:${s.folder || "employee_documents"}`];
      if (!folderId)
        return {
          problem: `No designated Drive folder is configured for ${entityKey || "this entity"} → ${s.folder || "employee_documents"} (Integrations tab).`,
        };
      const fileName = renderTemplate(
        s.fileName || `{{employee_name}} - ${category} - {{start_date}}`,
        values,
      ).text;
      return {
        action: await proposeAction({
          logicalKey: `step:${step.id}`,
          actionType: "drive_file",
          title: `File "${doc.filename}" in Drive`,
          summary: `${category} for ${instance.subject_label}`,
          payload: { documentId: doc.id, folderId, fileName },
          display: {
            target: `Folder ${folderId}`,
            effect: `Uploads the document as "${fileName}" and verifies its location.`,
          },
          mode: instance.mode,
          risk: "low",
          instanceId: instance.id,
          stepId: step.id,
          entityId: instance.entity_id,
          requestedBy,
        }),
      };
    }
    if (type === "bamboohr_update") {
      if (!person?.bamboohr_id) return { problem: "This person has no BambooHR employee id yet." };
      const field = s.field;
      const value = renderTemplate(s.value || "", values);
      if (!field || !value.text || value.missing.length)
        return {
          problem: `The BambooHR update needs a field and a value${value.missing.length ? ` (missing ${value.missing.join(", ")})` : ""}.`,
        };
      let current: string | null = null;
      try {
        const { bambooGetEmployee } = await import("./integrations");
        current = String((await bambooGetEmployee(person.bamboohr_id, [field]))[field] ?? "");
      } catch {
        current = null;
      }
      return {
        action: await proposeAction({
          logicalKey: `step:${step.id}`,
          actionType: "bamboohr_update",
          title: `BambooHR: set ${field} for ${person.full_name}`,
          summary: s.reason || step.title,
          payload: { employeeId: person.bamboohr_id, changes: { [field]: value.text } },
          display: {
            target: `${person.full_name} (BambooHR #${person.bamboohr_id})`,
            effect: "Updates the record and reads it back to verify.",
            dataChanges: [{ field, current, proposed: value.text }],
            evidence: [s.reason || step.title],
          },
          mode: instance.mode,
          risk: "high",
          instanceId: instance.id,
          stepId: step.id,
          entityId: instance.entity_id,
          requestedBy,
        }),
      };
    }
    if (type === "docusign_send") {
      const category = s.documentCategory || cfg.documentCategory;
      const [doc] = await agentDb().select<{ id: string; filename: string }>("ops_documents", {
        filters: [
          ...(instance.person_id
            ? [eq("person_id", instance.person_id)]
            : [eq("instance_id", instance.id)]),
          eq("category", category),
        ],
        order: { col: "version", ascending: false },
        limit: 1,
      });
      if (!doc) return { problem: `No "${category}" document is ready to send for signature.` };
      const email = person?.personal_email ?? person?.work_email;
      if (!person || !email) return { problem: "The signer's email address is missing." };
      return {
        action: await proposeAction({
          logicalKey: `step:${step.id}`,
          actionType: "docusign_send",
          title: `DocuSign: "${doc.filename}" to ${person.full_name}`,
          summary: step.title,
          payload: {
            documentId: doc.id,
            emailSubject: renderTemplate(s.subject || `Please sign: ${doc.filename}`, values).text,
            signers: [{ name: person.full_name, email }],
          },
          display: {
            target: `${person.full_name} <${email}>`,
            effect: "Sends a DocuSign envelope for signature.",
          },
          mode: instance.mode,
          risk: "high",
          instanceId: instance.id,
          stepId: step.id,
          entityId: instance.entity_id,
          requestedBy,
        }),
      };
    }
    return {
      problem: `"${type}" actions run from their own screens (Recruitment, Contracts), not inside this workflow.`,
    };
  }
  return {};
}

/** Move one workflow forward. Idempotent; safe to call from requests, approvals, and the sweep. */
export async function advanceInstance(instanceId: string, actorLabel = "Sam"): Promise<void> {
  const until = new Date(Date.now() + 60_000).toISOString();
  const now = new Date().toISOString();
  const instance = await selectOne<InstanceRow>("ops_workflow_instances", {
    filters: [eq("id", instanceId)],
  });
  if (!instance || instance.status !== "active") return;
  if (instance.processing_until && instance.processing_until > now) return; // someone else is advancing it
  await agentDb().update("ops_workflow_instances", [eq("id", instanceId)], {
    processing_until: until,
  });
  try {
    const roles = await getOpsRoles();
    const person = instance.person_id
      ? await selectOne<PersonRow>("ops_people", { filters: [eq("id", instance.person_id)] })
      : null;
    const def = (await selectOne<VersionRow>("ops_workflow_versions", {
      filters: [eq("id", instance.version_id)],
    }))!.definition;
    for (let pass = 0; pass < 5; pass++) {
      let changed = false;
      const steps = await agentDb().select<StepRow>("ops_workflow_steps", {
        filters: [eq("instance_id", instanceId)],
        order: { col: "position" },
      });
      const byKey = new Map(steps.map((s) => [s.step_key, s]));
      for (const step of steps) {
        if (
          step.status === "blocked" &&
          step.depends_on.every((k) => DONE.has(byKey.get(k)?.status ?? "completed"))
        ) {
          const human = STEP_TYPES[step.type].human;
          const patch: Partial<StepRow> = { status: human ? "ready" : "in_progress" };
          if (step.type === "wait_until") patch.status = "waiting";
          if (step.type === "wait_until")
            patch.next_run_at = addDays(anchorDate(def, instance), step.config.waitOffsetDays ?? 0);
          await agentDb().update(
            "ops_workflow_steps",
            [eq("id", step.id), eq("status", "blocked")],
            patch,
          );
          changed = true;
          continue;
        }
        if (
          step.status === "waiting" &&
          step.type === "wait_until" &&
          step.next_run_at &&
          step.next_run_at <= now
        ) {
          await completeStepInternal(step, { by: null, note: "Waited until the scheduled date." });
          changed = true;
          continue;
        }
        if (step.status === "in_progress" && step.type === "milestone") {
          await completeStepInternal(step, { by: null, note: "All earlier steps are done." });
          changed = true;
          continue;
        }
        if (
          step.status === "in_progress" &&
          ["approval", "communication", "external_action", "escalate"].includes(step.type) &&
          !step.data.actionId
        ) {
          const prepared = await prepareAutomatedStep(step, instance, person, roles, actorLabel);
          if (prepared.action && prepared.action.status === "rejected") {
            // An identical request was already declined; wait for someone to change the inputs.
            if (!step.last_error)
              await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
                last_error:
                  "Leadership declined this exact request. Change the step or its information to propose it again.",
              });
          } else if (prepared.action) {
            await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
              status: "awaiting_approval",
              data: { ...step.data, actionId: prepared.action.id },
              last_error: null,
            });
            if (prepared.action.status === "approved") await executeAction(prepared.action.id);
            changed = true;
          } else if (prepared.problem && prepared.problem !== step.last_error) {
            await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
              last_error: prepared.problem,
            });
          }
        }
      }
      if (!changed) break;
    }
    const steps = await agentDb().select<StepRow>("ops_workflow_steps", {
      filters: [eq("instance_id", instanceId)],
    });
    if (steps.length && steps.every((s) => DONE.has(s.status))) {
      await agentDb().update(
        "ops_workflow_instances",
        [eq("id", instanceId), eq("status", "active")],
        { status: "completed", completed_at: new Date().toISOString() },
      );
      await recordAudit({
        actor: { userId: null, label: "Sam" },
        action: "ops.workflow_completed",
        targetType: "ops_instance",
        targetId: instanceId,
        summary: `${instance.subject_label}: workflow completed.`,
      });
    }
  } finally {
    await agentDb().update("ops_workflow_instances", [eq("id", instanceId)], {
      processing_until: null,
    });
  }
}

async function completeStepInternal(
  step: StepRow,
  input: {
    by: string | null;
    note?: string;
    data?: Record<string, unknown>;
    evidence?: StepRow["evidence"];
  },
) {
  await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
    status: "completed",
    completed_by: input.by,
    completed_at: new Date().toISOString(),
    data: { ...step.data, ...(input.data ?? {}), ...(input.note ? { note: input.note } : {}) },
    evidence: [...step.evidence, ...(input.evidence ?? [])],
    last_error: null,
  });
}

/** React to an action reaching an end state (called from actions.ts). */
export async function onActionSettled(actionId: string): Promise<void> {
  const action = await selectOne<ActionRow>("ops_actions", { filters: [eq("id", actionId)] });
  if (!action) return;
  if (action.action_type === "start_workflow" && action.instance_id) {
    if (action.status === "succeeded") {
      await agentDb().update(
        "ops_workflow_instances",
        [eq("id", action.instance_id), eq("status", "pending_approval")],
        { status: "active" },
      );
      await advanceInstance(action.instance_id);
    } else if (["rejected", "cancelled"].includes(action.status)) {
      await agentDb().update(
        "ops_workflow_instances",
        [eq("id", action.instance_id), eq("status", "pending_approval")],
        { status: "cancelled" },
      );
      await agentDb().update("ops_workflow_steps", [eq("instance_id", action.instance_id)], {
        status: "cancelled",
      });
    }
    return;
  }
  if (typeof action.payload.register === "string") {
    const { onRegisterActionSettled } = await import("./registers");
    await onRegisterActionSettled(action);
    return;
  }
  if (!action.step_id) return;
  const step = await selectOne<StepRow>("ops_workflow_steps", {
    filters: [eq("id", action.step_id)],
  });
  if (!step || step.data.actionId !== action.id) return;
  if (action.status === "succeeded") {
    await completeStepInternal(step, {
      by: null,
      data: { actionResult: action.result },
      evidence: [
        {
          kind: "action",
          value: `${action.title} — ${action.mode === "test" ? "simulated" : "done"}`,
          by: null,
          at: new Date().toISOString(),
        },
      ],
    });
  } else if (action.status === "manual_required") {
    await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
      last_error: "Needs to be done by hand — see the instructions on the action.",
    });
    return;
  } else if (["rejected", "cancelled", "superseded"].includes(action.status)) {
    const { actionId: _drop, ...rest } = step.data;
    void _drop;
    await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
      status: "in_progress",
      data: rest,
      last_error: `Not approved (${action.status}). Update the step or its information and it will be proposed again.`,
    });
    // Re-proposal waits until someone changes the inputs (no automatic retry loop).
    return;
  } else if (action.status === "failed") {
    await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
      status: "failed",
      last_error: action.last_error,
    });
    return;
  }
  if (action.instance_id) await advanceInstance(action.instance_id);
}

function canActOnStep(step: StepRow, access: OpsAccess): boolean {
  if (step.type === "access_request") return access.isCoo; // the COO controls access
  if (step.type === "finance_handoff") return access.isFinanceOwner || access.isLeadership;
  if (step.assignee_profile_id && step.assignee_profile_id === access.userId) return true;
  if (step.assignee_role === "ceo" && access.isCeo) return true;
  if (step.assignee_role === "coo" && access.isCoo) return true;
  if (step.assignee_role === "leadership" && access.isLeadership) return true;
  if (step.assignee_role === "hr_admin" && (access.isHrAdmin || access.isLeadership)) return true;
  return access.isLeadership || access.isHrAdmin;
}

/** A person completes a human step, with the step's requirements enforced. */
export async function completeStep(input: {
  stepId: string;
  access: OpsAccess;
  actorLabel: string;
  data?: Record<string, string>;
  checklistDone?: string[];
  note?: string;
  evidenceUrl?: string;
}): Promise<void> {
  const step = await selectOne<StepRow>("ops_workflow_steps", {
    filters: [eq("id", input.stepId)],
  });
  if (!step) throw new NotFoundError("Step not found.");
  if (!canActOnStep(step, input.access)) {
    throw new AuthorizationError(
      step.type === "access_request"
        ? "Only the COO can complete access steps."
        : step.type === "finance_handoff"
          ? "Only the head of finance or leadership can complete finance steps."
          : "This step is assigned to someone else.",
    );
  }
  if (!["ready", "in_progress", "failed"].includes(step.status) || !STEP_TYPES[step.type].human)
    throw new ValidationError("This step can't be completed by hand right now.");
  const cfg = step.config;
  if (step.type === "collect_information") {
    const missing = cfg.fields
      .filter((f) => f.required && !String(input.data?.[f.key] ?? "").trim())
      .map((f) => f.label);
    if (missing.length) throw new ValidationError(`Fill in: ${missing.join(", ")}.`);
  }
  if (
    step.type === "checklist" &&
    cfg.checklist.some((item) => !(input.checklistDone ?? []).includes(item))
  )
    throw new ValidationError("Tick every checklist item first.");
  if (step.type === "upload_document") {
    const instance = (await selectOne<InstanceRow>("ops_workflow_instances", {
      filters: [eq("id", step.instance_id)],
    }))!;
    const docs = await agentDb().select("ops_documents", {
      filters: [
        ...(instance.person_id
          ? [eq("person_id", instance.person_id)]
          : [eq("instance_id", instance.id)]),
        eq("category", cfg.documentCategory),
      ],
      limit: 1,
    });
    if (!docs.length)
      throw new ValidationError(`Upload the "${cfg.documentCategory}" document first.`);
  }
  if (
    (cfg.evidenceRequired || step.type === "access_request") &&
    !(input.note?.trim() || input.evidenceUrl?.trim())
  ) {
    throw new ValidationError("Add completion evidence (a note or link).");
  }
  const evidence = [
    input.note?.trim()
      ? {
          kind: "note",
          value: input.note.trim().slice(0, 1000),
          by: input.access.userId,
          at: new Date().toISOString(),
        }
      : null,
    input.evidenceUrl?.trim()
      ? {
          kind: "link",
          value: input.evidenceUrl.trim().slice(0, 500),
          by: input.access.userId,
          at: new Date().toISOString(),
        }
      : null,
  ].filter(Boolean) as StepRow["evidence"];
  await completeStepInternal(step, {
    by: input.access.userId,
    data: { ...(input.data ?? {}), checklistDone: input.checklistDone ?? [] },
    evidence,
  });
  if (step.type === "collect_information" && input.data) {
    // Collected values become available to later steps' messages and actions.
    const instance = (await selectOne<InstanceRow>("ops_workflow_instances", {
      filters: [eq("id", step.instance_id)],
    }))!;
    await agentDb().update("ops_workflow_instances", [eq("id", instance.id)], {
      inputs: { ...instance.inputs, ...input.data },
    });
  }
  await recordAudit({
    actor: { userId: input.access.userId, label: input.actorLabel },
    action: "ops.step_completed",
    targetType: "ops_step",
    targetId: step.id,
    summary: `Completed "${step.title}".`,
  });
  await advanceInstance(step.instance_id);
}

/** Leadership override: skip a step that can't be completed normally, with a recorded reason. */
export async function overrideStep(input: {
  stepId: string;
  reason: string;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "leadership");
  if (input.reason.trim().length < 5)
    throw new ValidationError("Explain why the step is being skipped.");
  const step = await selectOne<StepRow>("ops_workflow_steps", {
    filters: [eq("id", input.stepId)],
  });
  if (!step || DONE.has(step.status)) throw new ValidationError("This step is already finished.");
  await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
    status: "skipped",
    override_reason: input.reason.slice(0, 500),
    completed_by: input.access.userId,
    completed_at: new Date().toISOString(),
  });
  await recordAudit({
    actor: { userId: input.access.userId, label: input.actorLabel },
    action: "ops.step_overridden",
    targetType: "ops_step",
    targetId: step.id,
    summary: `Skipped "${step.title}": ${input.reason.slice(0, 120)}`,
  });
  await advanceInstance(step.instance_id);
}

export async function reassignStep(input: {
  stepId: string;
  profileId: string;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const step = await selectOne<StepRow>("ops_workflow_steps", {
    filters: [eq("id", input.stepId)],
  });
  if (!step) throw new NotFoundError("Step not found.");
  if (step.type === "access_request")
    throw new ValidationError("Access steps always belong to the COO.");
  await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
    assignee_profile_id: input.profileId,
    assignee_role: "specific_person",
  });
  await recordAudit({
    actor: { userId: input.access.userId, label: input.actorLabel },
    action: "ops.step_reassigned",
    targetType: "ops_step",
    targetId: step.id,
    summary: `Reassigned "${step.title}".`,
  });
}

export async function setInstanceStatus(input: {
  instanceId: string;
  status: "paused" | "active" | "cancelled";
  reason: string;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, input.status === "cancelled" ? "leadership" : "configure");
  const instance = await selectOne<InstanceRow>("ops_workflow_instances", {
    filters: [eq("id", input.instanceId)],
  });
  if (!instance) throw new NotFoundError("Workflow not found.");
  const allowedFrom =
    input.status === "paused"
      ? ["active"]
      : input.status === "active"
        ? ["paused"]
        : ["active", "paused", "pending_approval"];
  if (!allowedFrom.includes(instance.status))
    throw new ValidationError(
      `A ${instance.status} workflow can't be ${input.status === "active" ? "resumed" : input.status}.`,
    );
  await agentDb().update("ops_workflow_instances", [eq("id", instance.id)], {
    status: input.status,
  });
  if (input.status === "cancelled") {
    const open = await agentDb().select<ActionRow>("ops_actions", {
      filters: [
        eq("instance_id", instance.id),
        inList("status", ["pending_approval", "approved", "manual_required", "failed"]),
      ],
    });
    for (const a of open) {
      await agentDb().update("ops_actions", [eq("id", a.id)], {
        status: "cancelled",
        last_error: "Workflow cancelled.",
      });
      if (a.approval_request_id)
        await agentDb().update(
          "ai_approval_requests",
          [eq("id", a.approval_request_id), eq("status", "pending")],
          { status: "cancelled", decision_note: "Workflow cancelled." },
        );
    }
    await agentDb().update(
      "ops_workflow_steps",
      [
        eq("instance_id", instance.id),
        inList("status", [
          "blocked",
          "ready",
          "in_progress",
          "awaiting_approval",
          "waiting",
          "failed",
        ]),
      ],
      { status: "cancelled" },
    );
  }
  await recordAudit({
    actor: { userId: input.access.userId, label: input.actorLabel },
    action: `ops.workflow_${input.status}`,
    targetType: "ops_instance",
    targetId: instance.id,
    summary: `${instance.subject_label}: ${input.status}${input.reason ? ` — ${input.reason.slice(0, 120)}` : ""}`,
  });
  if (input.status === "active") await advanceInstance(instance.id);
}

/**
 * Reviewed migration of a running workflow to a newer published version: completed steps keep
 * their history; new steps are added; steps removed from the new version are listed. Preview
 * first (apply=false) and then apply.
 */
export async function migrateInstance(input: {
  instanceId: string;
  apply: boolean;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const { instance, steps, template } = await getInstanceDetail(input.instanceId);
  if (!template?.published_version_id || template.published_version_id === instance.version_id)
    throw new ValidationError("This workflow already uses the latest published version.");
  const target = (await selectOne<VersionRow>("ops_workflow_versions", {
    filters: [eq("id", template.published_version_id)],
  }))!;
  const existing = new Map(steps.map((s) => [s.step_key, s]));
  const added = target.definition.steps.filter((s) => !existing.has(s.key));
  const removed = steps.filter(
    (s) => !target.definition.steps.some((t) => t.key === s.step_key) && !DONE.has(s.status),
  );
  const changed = target.definition.steps.filter(
    (s) => existing.has(s.key) && !DONE.has(existing.get(s.key)!.status),
  );
  const preview = {
    toVersion: target.version,
    added: added.map((s) => s.title),
    removed: removed.map((s) => s.title),
    updated: changed.map((s) => s.title),
  };
  if (!input.apply) return preview;
  const roles = await getOpsRoles();
  const person = instance.person_id
    ? await selectOne<PersonRow>("ops_people", { filters: [eq("id", instance.person_id)] })
    : null;
  for (const [i, s] of target.definition.steps.entries()) {
    const prior = existing.get(s.key);
    const assignee = await resolveAssignee(s, roles, person, instance.inputs);
    if (!prior) {
      await agentDb().insert("ops_workflow_steps", {
        instance_id: instance.id,
        step_key: s.key,
        position: i,
        title: s.title,
        type: s.type,
        stage: s.stage || null,
        config: s,
        depends_on: s.dependsOn,
        status: "blocked",
        assignee_profile_id: assignee.profileId,
        assignee_role: assignee.role,
        due_at:
          s.dueOffsetDays === null
            ? null
            : addDays(anchorDate(target.definition, instance), s.dueOffsetDays),
        data: {},
        evidence: [],
      });
    } else if (!DONE.has(prior.status) && prior.status !== "awaiting_approval") {
      await agentDb().update("ops_workflow_steps", [eq("id", prior.id)], {
        position: i,
        title: s.title,
        type: s.type,
        stage: s.stage || null,
        config: s,
        depends_on: s.dependsOn,
      });
    }
  }
  for (const r of removed)
    await agentDb().update("ops_workflow_steps", [eq("id", r.id)], {
      status: "cancelled",
      override_reason: `Removed in v${target.version}`,
    });
  await agentDb().update("ops_workflow_instances", [eq("id", instance.id)], {
    version_id: target.id,
  });
  await recordAudit({
    actor: { userId: input.access.userId, label: input.actorLabel },
    action: "ops.workflow_migrated",
    targetType: "ops_instance",
    targetId: instance.id,
    summary: `${instance.subject_label}: migrated to v${target.version}.`,
    details: preview,
  });
  await advanceInstance(instance.id);
  return preview;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export async function listInstances(
  access: OpsAccess,
  filter: { status?: InstanceRow["status"][]; category?: string } = {},
) {
  const [instances, templates] = await Promise.all([
    agentDb().select<InstanceRow>("ops_workflow_instances", {
      filters: filter.status ? [inList("status", filter.status)] : [],
      order: { col: "created_at", ascending: false },
      limit: 500,
    }),
    agentDb().select<TemplateRow>("ops_workflow_templates", {}),
  ]);
  const byId = new Map(templates.map((t) => [t.id, t]));
  let visible = instances.filter(
    (i) => !filter.category || byId.get(i.template_id)?.category === filter.category,
  );
  if (!access.canViewAll) {
    // Employees see only workflows that are about them or have a step assigned to them.
    const mine = new Set(
      (
        await agentDb().select<StepRow>("ops_workflow_steps", {
          filters: [eq("assignee_profile_id", access.userId ?? "-")],
        })
      ).map((s) => s.instance_id),
    );
    const own = await selectOne<PersonRow>("ops_people", {
      filters: [eq("profile_id", access.userId ?? "-")],
    });
    visible = visible.filter((i) => mine.has(i.id) || (own && i.person_id === own.id));
  }
  const steps = visible.length
    ? await agentDb().select<StepRow>("ops_workflow_steps", {
        filters: [
          inList(
            "instance_id",
            visible.map((i) => i.id),
          ),
        ],
        limit: 20_000,
      })
    : [];
  const now = new Date().toISOString();
  return visible.map((i) => {
    const mine = steps.filter((s) => s.instance_id === i.id && s.status !== "cancelled");
    const done = mine.filter((s) => DONE.has(s.status)).length;
    return {
      ...i,
      templateName: byId.get(i.template_id)?.name ?? "Workflow",
      category: byId.get(i.template_id)?.category ?? "",
      progress: mine.length ? Math.round((done / mine.length) * 100) : 0,
      stepsDone: done,
      stepsTotal: mine.length,
      overdue: mine.filter((s) => !DONE.has(s.status) && s.due_at && s.due_at < now).length,
      awaitingApproval: mine.filter((s) => s.status === "awaiting_approval").length,
      blocked: mine.filter((s) => s.last_error && !DONE.has(s.status)).length,
      currentStage: mine.find((s) => !DONE.has(s.status))?.stage ?? null,
    };
  });
}

/** Steps waiting on this person (their own, or by role). */
export async function inboxFor(access: OpsAccess) {
  if (!access.userId) return [];
  const open = await agentDb().select<StepRow>("ops_workflow_steps", {
    filters: [inList("status", ["ready", "in_progress", "failed"])],
    limit: 5000,
  });
  const instances = new Map(
    (
      await agentDb().select<InstanceRow>("ops_workflow_instances", {
        filters: [inList("status", ["active", "paused"])],
      })
    ).map((i) => [i.id, i]),
  );
  return open
    .filter((s) => instances.has(s.instance_id) && STEP_TYPES[s.type].human)
    .filter((s) =>
      s.assignee_profile_id
        ? s.assignee_profile_id === access.userId
        : canActOnStep(s, access) &&
          (access.isLeadership ||
            access.isHrAdmin ||
            s.assignee_role !== "hr_admin" ||
            access.isHrAdmin),
    )
    .filter((s) => s.type !== "access_request" || access.isCoo)
    .map((s) => ({
      ...s,
      subjectLabel: instances.get(s.instance_id)!.subject_label,
      mode: instances.get(s.instance_id)!.mode,
      roleLabel:
        ROLE_LABELS[(s.assignee_role ?? "hr_admin") as keyof typeof ROLE_LABELS] ?? s.assignee_role,
    }))
    .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
}

// ---------------------------------------------------------------------------
// Background sweep
// ---------------------------------------------------------------------------
/** Reminders and escalations for overdue human steps (each reminder is itself approval-controlled). */
async function remindOverdueSteps(): Promise<number> {
  const now = Date.now();
  const steps = await agentDb().select<StepRow>("ops_workflow_steps", {
    filters: [inList("status", ["ready", "in_progress"])],
    limit: 5000,
  });
  const instances = new Map(
    (
      await agentDb().select<InstanceRow>("ops_workflow_instances", {
        filters: [eq("status", "active")],
      })
    ).map((i) => [i.id, i]),
  );
  const roles = await getOpsRoles();
  let raised = 0;
  for (const s of steps) {
    const instance = instances.get(s.instance_id);
    if (!instance || !s.due_at || !STEP_TYPES[s.type].human) continue;
    const overdueDays = Math.floor((now - new Date(s.due_at).getTime()) / DAY);
    if (overdueDays < 0) continue;
    const { everyDays, escalateAfterDays } = s.config.reminder;
    const thresholds: Array<{ key: string; leadership: boolean }> = [];
    if (everyDays)
      thresholds.push({
        key: `reminder-${Math.floor(overdueDays / everyDays)}`,
        leadership: false,
      });
    if (escalateAfterDays && overdueDays >= escalateAfterDays)
      thresholds.push({ key: "escalation", leadership: true });
    for (const t of thresholds) {
      try {
        await agentDb().insert("ops_reminders", {
          ref_type: "step",
          ref_id: s.id,
          threshold: t.key,
        });
      } catch {
        continue; // already raised for this threshold
      }
      const recipients = t.leadership
        ? [roles.ceo, roles.coo]
        : [
            s.assignee_profile_id ??
              (s.assignee_role === "coo"
                ? roles.coo
                : s.assignee_role === "finance_owner"
                  ? roles.financeOwner
                  : null),
          ];
      const ids = recipients.filter((x): x is string => Boolean(x));
      if (!ids.length) continue;
      await proposeAction({
        logicalKey: `remind:${s.id}:${t.key}`,
        actionType: "notify_slack",
        title: `${t.leadership ? "Escalation" : "Reminder"}: ${s.title}`,
        summary: `${instance.subject_label}: "${s.title}" was due ${new Date(s.due_at).toLocaleDateString("en-US")} (${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue).`,
        payload: {
          profileIds: ids,
          text: `${t.leadership ? "Escalation" : "Reminder"} — ${instance.subject_label}: "${s.title}" is ${overdueDays} day(s) overdue.`,
        },
        display: {
          target: t.leadership ? "CEO and COO" : "Step owner",
          effect: "Sends a Slack reminder.",
        },
        mode: instance.mode,
        risk: "low",
        instanceId: instance.id,
        entityId: instance.entity_id,
        requestedBy: { userId: null, label: "Sam (scheduled reminder)" },
      });
      raised++;
    }
  }
  return raised;
}

/** Cron entry point: advance workflows, wake waiting steps, retry approved actions, raise reminders. */
export async function sweepOperations(): Promise<Record<string, number>> {
  const active = await agentDb().select<InstanceRow>("ops_workflow_instances", {
    filters: [eq("status", "active")],
    limit: 200,
  });
  for (const i of active) await advanceInstance(i.id).catch(() => undefined);
  const { runPendingActions } = await import("./actions");
  const retried = await runPendingActions();
  const reminders = await remindOverdueSteps();
  const { raiseDateReminders, sweepRegisters } = await import("./registers");
  const dated = await raiseDateReminders();
  const registers = await sweepRegisters();
  return { advanced: active.length, retried, reminders, dated, ...registers };
}
