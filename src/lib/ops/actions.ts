/**
 * Approval-bound actions: every consequential side effect Sam's workflows can cause.
 *
 * Lifecycle: pending_approval → approved → executing → succeeded | failed | manual_required.
 *   - The approval request carries a SHA-256 of the exact payload. Any material change creates
 *     a new action; the old approval is invalidated (never reused).
 *   - Only the confirmed CEO or COO can approve. Silence or time never approves anything.
 *   - Execution re-checks the approval, the approver's role, and autonomy right before acting.
 *   - Each action executes at most once (conditional claim + unique idempotency key).
 *   - Test mode never calls an external system.
 */

import "server-only";

import { createHash } from "node:crypto";
import { recordAudit } from "@/lib/agents/audit";
import { createApproval } from "@/lib/agents/approvals";
import { SAM_SLUG } from "@/lib/agents/defaults";
import { getResolvedAgent } from "@/lib/agents/registry";
import { agentDb, eq, inList, selectOne } from "@/lib/agents/store";
import type { ApprovalRow } from "@/lib/agents/types";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { ACTION_LABELS, type AnyAction } from "./definition";
import { getOpsDocument, readOpsDocumentBytes, setDocumentStatus } from "./documents";
import {
  bambooUpdateEmployee,
  calendarCreateEvent,
  docusignSend,
  driveUpload,
  gmailSend,
  IntegrationError,
  ManualRequired,
  slackDm,
} from "./integrations";
import { getOpsRoles, type OpsAccess } from "./org";

export type ActionRow = {
  id: string;
  instance_id: string | null;
  step_id: string | null;
  entity_id: string | null;
  action_type: AnyAction;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  risk: "low" | "medium" | "high";
  status:
    | "pending_approval"
    | "approved"
    | "rejected"
    | "executing"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "superseded"
    | "manual_required";
  mode: "live" | "test";
  approval_request_id: string | null;
  approved_via: string | null;
  idempotency_key: string;
  attempts: number;
  last_error: string | null;
  result: Record<string, unknown> | null;
  requested_by: string | null;
  requested_by_label: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
};

const MAX_ATTEMPTS = 5;

/** Deterministic JSON (sorted keys) so the same payload always hashes the same. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function hashAction(actionType: string, payload: unknown, mode: string): string {
  return createHash("sha256").update(stableStringify({ actionType, payload, mode })).digest("hex");
}

/** Leadership-enabled autonomy for this action, if any (revocation takes effect immediately). */
async function autonomyRule(
  actionType: string,
  workflowKey: string | null,
  entityId: string | null,
) {
  const rules = await agentDb().select<{
    id: string;
    workflow_key: string | null;
    entity_id: string | null;
    enabled: boolean;
    revoked_at: string | null;
  }>("ops_autonomy_rules", {
    filters: [eq("action_type", actionType), eq("enabled", true)],
  });
  return (
    rules.find(
      (r) =>
        !r.revoked_at &&
        (!r.workflow_key || r.workflow_key === workflowKey) &&
        (!r.entity_id || r.entity_id === entityId),
    ) ?? null
  );
}

async function workflowKeyFor(instanceId: string | null): Promise<string | null> {
  if (!instanceId) return null;
  const inst = await selectOne<{ template_id: string }>("ops_workflow_instances", {
    filters: [eq("id", instanceId)],
  });
  if (!inst) return null;
  return (
    (
      await selectOne<{ key: string }>("ops_workflow_templates", {
        filters: [eq("id", inst.template_id)],
      })
    )?.key ?? null
  );
}

/**
 * Propose an action. Identical re-proposals return the existing action (idempotent); a changed
 * payload for the same logical action supersedes the old one and needs a fresh approval.
 */
export async function proposeAction(input: {
  logicalKey: string;
  actionType: AnyAction;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  /** Shown to approvers: recipient/record, expected effect, evidence. */
  display: {
    target: string;
    effect: string;
    evidence?: string[];
    dataChanges?: Array<{ field: string; current: string | null; proposed: string }>;
  };
  risk?: ActionRow["risk"];
  mode: ActionRow["mode"];
  instanceId?: string | null;
  stepId?: string | null;
  entityId?: string | null;
  requestedBy: { userId: string | null; label: string };
}): Promise<ActionRow> {
  const hash = hashAction(input.actionType, input.payload, input.mode);
  const baseKey = `${input.logicalKey}:${hash.slice(0, 16)}`;
  const sameHash = (
    await agentDb().select<ActionRow>("ops_actions", { filters: [eq("payload_hash", hash)] })
  ).filter((a) => a.idempotency_key === baseKey || a.idempotency_key.startsWith(`${baseKey}:`));
  const same = sameHash.find((a) => a.status !== "cancelled" && a.status !== "superseded");
  if (same) return same;
  // The same payload was proposed before and later superseded/cancelled: it needs a fresh approval.
  const idempotencyKey = sameHash.length ? `${baseKey}:${sameHash.length}` : baseKey;

  // A material change: supersede open actions for the same logical key, invalidating approvals.
  const open = await agentDb().select<ActionRow>("ops_actions", {
    filters: [inList("status", ["pending_approval", "approved", "failed"])],
  });
  for (const prev of open.filter((a) => a.idempotency_key.startsWith(`${input.logicalKey}:`))) {
    await agentDb().update("ops_actions", [eq("id", prev.id)], { status: "superseded" });
    if (prev.approval_request_id) {
      await agentDb().update(
        "ai_approval_requests",
        [eq("id", prev.approval_request_id), eq("status", "pending")],
        {
          status: "cancelled",
          invalidated_at: new Date().toISOString(),
          decision_note: "Superseded by a changed request.",
        },
      );
      await agentDb().update("ai_approval_requests", [eq("id", prev.approval_request_id)], {
        invalidated_at: new Date().toISOString(),
      });
    }
  }

  const [action] = await agentDb().insert<ActionRow>("ops_actions", {
    instance_id: input.instanceId ?? null,
    step_id: input.stepId ?? null,
    entity_id: input.entityId ?? null,
    action_type: input.actionType,
    title: input.title.slice(0, 200),
    summary: input.summary.slice(0, 1000),
    payload: input.payload,
    payload_hash: hash,
    risk: input.risk ?? "medium",
    status: "pending_approval",
    mode: input.mode,
    approval_request_id: null,
    approved_via: null,
    idempotency_key: idempotencyKey,
    attempts: 0,
    last_error: null,
    result: null,
    requested_by: input.requestedBy.userId,
    requested_by_label: input.requestedBy.label,
    executed_at: null,
  });

  const rule =
    input.mode === "live"
      ? await autonomyRule(
          input.actionType,
          await workflowKeyFor(input.instanceId ?? null),
          input.entityId ?? null,
        )
      : null;
  if (rule) {
    const [auto] = await agentDb().update<ActionRow>("ops_actions", [eq("id", action!.id)], {
      status: "approved",
      approved_via: `autonomy:${rule.id}`,
    });
    await recordAudit({
      actor: { userId: null, label: "Sam (leadership-enabled autonomy)" },
      action: "ops.action_auto_approved",
      targetType: "ops_action",
      targetId: action!.id,
      summary: `${ACTION_LABELS[input.actionType]} approved by autonomy rule.`,
    });
    return auto!;
  }

  const sam = await getResolvedAgent(SAM_SLUG);
  if (!sam) throw new Error("Sam isn't registered.");
  const approval = await createApproval({
    taskId: null,
    agentId: sam.row.id,
    actionType: `ops.${input.actionType}`,
    title: input.title,
    summary: input.summary,
    payload: {
      opsActionId: action!.id,
      actionLabel: ACTION_LABELS[input.actionType],
      target: input.display.target,
      effect: input.display.effect,
      evidence: input.display.evidence ?? [],
      dataChanges: input.display.dataChanges ?? [],
      preview: input.payload,
      mode: input.mode,
      requestedBy: input.requestedBy.label,
      risk: input.risk ?? "medium",
    },
    requestedForUserId: null,
  });
  await agentDb().update("ai_approval_requests", [eq("id", approval.id)], {
    payload_hash: hash,
    ops_action_id: action!.id,
  });
  const [linked] = await agentDb().update<ActionRow>("ops_actions", [eq("id", action!.id)], {
    approval_request_id: approval.id,
  });
  await recordAudit({
    actor: input.requestedBy,
    action: "ops.action_proposed",
    targetType: "ops_action",
    targetId: action!.id,
    summary: `${ACTION_LABELS[input.actionType]} proposed: ${input.title}`,
    details: { approvalId: approval.id, mode: input.mode },
  });
  return linked!;
}

/**
 * Called from the shared approval queue when an ops.* request is decided. Enforces CEO/COO
 * authority and payload binding, then executes approved actions.
 */
export async function handleOpsApprovalDecision(
  approval: ApprovalRow & {
    payload_hash?: string | null;
    ops_action_id?: string | null;
    invalidated_at?: string | null;
  },
  decision: "approved" | "rejected",
  deciderId: string,
): Promise<void> {
  const roles = await getOpsRoles();
  if (deciderId !== roles.ceo && deciderId !== roles.coo) {
    throw new AuthorizationError("Only the confirmed CEO or COO can decide Sam's requests.");
  }
  if (approval.invalidated_at)
    throw new ValidationError(
      "This request changed after it was submitted. Review the new request instead.",
    );
  const action = approval.ops_action_id
    ? await selectOne<ActionRow>("ops_actions", { filters: [eq("id", approval.ops_action_id)] })
    : null;
  if (!action) throw new NotFoundError("The action for this request no longer exists.");
  if (action.status !== "pending_approval")
    throw new ValidationError("This action is no longer waiting for approval.");
  if (approval.payload_hash !== action.payload_hash)
    throw new ValidationError(
      "The action changed since approval was requested; a new approval is needed.",
    );
}

/** After the approval row is updated: move the action on (and run it if approved). */
export async function afterOpsApprovalDecision(
  approvalId: string,
  decision: "approved" | "rejected",
  deciderId: string,
): Promise<void> {
  const approval = await selectOne<ApprovalRow & { ops_action_id: string | null }>(
    "ai_approval_requests",
    { filters: [eq("id", approvalId)] },
  );
  if (!approval?.ops_action_id) return;
  const [action] = await agentDb().update<ActionRow>(
    "ops_actions",
    [eq("id", approval.ops_action_id), eq("status", "pending_approval")],
    {
      status: decision === "approved" ? "approved" : "rejected",
      approved_via: decision === "approved" ? `approval:${deciderId}` : null,
    },
  );
  if (!action) return;
  const { onActionSettled } = await import("./engine");
  if (decision === "approved") await executeAction(action.id);
  else await onActionSettled(action.id);
}

/** Re-verify that an approved action may still run. */
async function stillAuthorized(action: ActionRow): Promise<string | null> {
  if (action.approved_via === "test-simulation")
    return action.mode === "test" ? null : "Simulated approvals only apply to test mode.";
  if (action.approved_via?.startsWith("autonomy:")) {
    const rule = await selectOne<{ enabled: boolean; revoked_at: string | null }>(
      "ops_autonomy_rules",
      { filters: [eq("id", action.approved_via.slice(9))] },
    );
    return rule?.enabled && !rule.revoked_at
      ? null
      : "Leadership revoked the autonomy that approved this action.";
  }
  if (!action.approval_request_id) return "No approval on record.";
  const approval = await selectOne<
    ApprovalRow & { payload_hash: string | null; invalidated_at: string | null }
  >("ai_approval_requests", { filters: [eq("id", action.approval_request_id)] });
  if (!approval || approval.status !== "approved") return "The approval is no longer valid.";
  if (
    approval.invalidated_at ||
    approval.payload_hash !== hashAction(action.action_type, action.payload, action.mode)
  )
    return "The action changed after approval.";
  const roles = await getOpsRoles();
  if (approval.decided_by !== roles.ceo && approval.decided_by !== roles.coo)
    return "The approver is no longer the CEO or COO.";
  return null;
}

/** Execute an approved action at most once. Safe to call repeatedly (sweeps, retries, double clicks). */
export async function executeAction(actionId: string): Promise<ActionRow> {
  const current = await selectOne<ActionRow>("ops_actions", { filters: [eq("id", actionId)] });
  if (!current) throw new NotFoundError("Action not found.");
  if (current.status !== "approved") return current;
  const problem = await stillAuthorized(current);
  if (problem) {
    const [cancelled] = await agentDb().update<ActionRow>(
      "ops_actions",
      [eq("id", actionId), eq("status", "approved")],
      { status: "cancelled", last_error: problem },
    );
    return cancelled ?? current;
  }
  // Atomic claim: only one caller moves approved → executing.
  const [claimed] = await agentDb().update<ActionRow>(
    "ops_actions",
    [eq("id", actionId), eq("status", "approved")],
    { status: "executing", attempts: current.attempts + 1 },
  );
  if (!claimed)
    return (await selectOne<ActionRow>("ops_actions", { filters: [eq("id", actionId)] }))!;

  let patch: Partial<ActionRow>;
  try {
    const result =
      claimed.mode === "test"
        ? { dryRun: true, wouldDo: `${ACTION_LABELS[claimed.action_type]}: ${claimed.title}` }
        : await runHandler(claimed);
    patch = {
      status: "succeeded",
      result,
      last_error: null,
      executed_at: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof ManualRequired) {
      patch = {
        status: "manual_required",
        result: { instructions: error.instructions },
        last_error: null,
      };
    } else {
      const retryable = error instanceof IntegrationError ? error.retryable : true;
      patch = {
        status: retryable && claimed.attempts < MAX_ATTEMPTS ? "approved" : "failed",
        last_error: error instanceof Error ? error.message.slice(0, 500) : "Execution failed.",
      };
    }
  }
  const [done] = await agentDb().update<ActionRow>(
    "ops_actions",
    [eq("id", actionId), eq("status", "executing")],
    patch,
  );
  await recordAudit({
    actor: { userId: null, label: "Sam" },
    action: `ops.action_${patch.status}`,
    targetType: "ops_action",
    targetId: actionId,
    summary: `${ACTION_LABELS[claimed.action_type]} — ${patch.status}${patch.last_error ? `: ${patch.last_error}` : ""}`,
    details: { mode: claimed.mode, attempt: claimed.attempts + 1 },
  });
  const { onActionSettled } = await import("./engine");
  await onActionSettled(actionId);
  return done ?? claimed;
}

async function runHandler(action: ActionRow): Promise<Record<string, unknown>> {
  const p = action.payload as Record<string, unknown>;
  switch (action.action_type) {
    case "send_email":
      return gmailSend({
        to: String(p.to),
        subject: String(p.subject ?? ""),
        body: String(p.body ?? ""),
        from: p.from ? String(p.from) : undefined,
      });
    case "notify_slack": {
      const sent = [];
      for (const profileId of (p.profileIds as string[]) ?? [])
        sent.push(await slackDm({ profileId, text: String(p.text ?? "") }));
      return { sent: sent.length };
    }
    case "bamboohr_update":
      return bambooUpdateEmployee(String(p.employeeId), p.changes as Record<string, string>);
    case "calendar_event":
      return calendarCreateEvent({
        calendarId: String(p.calendarId),
        summary: String(p.summary),
        description: String(p.description ?? ""),
        start: String(p.start),
        end: String(p.end),
        timeZone: String(p.timeZone),
        attendees: (p.attendees as string[]) ?? [],
        requestId: action.idempotency_key,
      });
    case "docusign_send": {
      const doc = await getOpsDocument(String(p.documentId));
      const bytes = await readOpsDocumentBytes(doc);
      return docusignSend({
        emailSubject: String(p.emailSubject),
        document: {
          name: doc.filename,
          base64: bytes.toString("base64"),
          extension: (/\.([a-z0-9]+)$/i.exec(doc.filename)?.[1] ?? "pdf").toLowerCase(),
        },
        signers: p.signers as Array<{ name: string; email: string }>,
        requestId: action.idempotency_key,
      });
    }
    case "drive_file": {
      const doc = await getOpsDocument(String(p.documentId));
      if (doc.drive_file_id) return { alreadyFiled: doc.drive_file_id };
      const bytes = await readOpsDocumentBytes(doc);
      const file = await driveUpload({
        folderId: String(p.folderId ?? ""),
        name: String(p.fileName ?? doc.filename),
        mimeType: doc.mime_type,
        bytes,
      });
      await setDocumentStatus(doc.id, "filed", { canConfigure: true } as OpsAccess, "Sam", {
        drive_file_id: file.id,
      });
      return file;
    }
    case "publish_vacancy":
      throw new ManualRequired(
        `BetterTeams has no supported API. Publish "${String(p.title)}" in BetterTeams, then record the posting link here.`,
      );
    case "start_workflow":
    case "approve_step":
    case "approve_item":
      // Internal decisions: the approval itself is the effect; the engine reacts in onActionSettled.
      return { approved: true };
    case "publish_workflow": {
      const { publishVersionNow } = await import("./engine");
      await publishVersionNow(String(p.templateId), String(p.versionId), action.requested_by);
      return { published: p.versionId };
    }
  }
}

/** A person retries a failed action (approval is re-checked; nothing runs twice). */
export async function retryAction(actionId: string, access: OpsAccess): Promise<ActionRow> {
  if (!access.canConfigure)
    throw new AuthorizationError("Only HR administrators and leadership can retry actions.");
  const [reset] = await agentDb().update<ActionRow>(
    "ops_actions",
    [eq("id", actionId), eq("status", "failed")],
    { status: "approved", last_error: null },
  );
  if (!reset) throw new ValidationError("Only failed actions can be retried.");
  return executeAction(actionId);
}

/** Someone did a manual_required action by hand; record who and the evidence. */
export async function completeManualAction(
  actionId: string,
  access: OpsAccess,
  actorLabel: string,
  note: string,
  evidenceUrl?: string,
): Promise<ActionRow> {
  if (!access.canConfigure)
    throw new AuthorizationError(
      "Only HR administrators and leadership can confirm manual actions.",
    );
  if (!note.trim()) throw new ValidationError("Describe what was done.");
  const [row] = await agentDb().update<ActionRow>(
    "ops_actions",
    [eq("id", actionId), eq("status", "manual_required")],
    {
      status: "succeeded",
      executed_at: new Date().toISOString(),
      result: {
        manual: true,
        completedBy: actorLabel,
        note: note.slice(0, 1000),
        evidenceUrl: evidenceUrl ?? null,
      },
    },
  );
  if (!row) throw new ValidationError("This action isn't waiting for manual completion.");
  await recordAudit({
    actor: { userId: access.userId, label: actorLabel },
    action: "ops.action_completed_manually",
    targetType: "ops_action",
    targetId: actionId,
    summary: `Manual completion recorded: ${note.slice(0, 120)}`,
  });
  const { onActionSettled } = await import("./engine");
  await onActionSettled(actionId);
  return row;
}

export async function cancelAction(
  actionId: string,
  access: OpsAccess,
  actorLabel: string,
  reason: string,
): Promise<void> {
  if (!access.canConfigure)
    throw new AuthorizationError("Only HR administrators and leadership can cancel actions.");
  const [row] = await agentDb().update<ActionRow>(
    "ops_actions",
    [
      eq("id", actionId),
      inList("status", ["pending_approval", "approved", "failed", "manual_required"]),
    ],
    { status: "cancelled", last_error: reason.slice(0, 300) },
  );
  if (!row) throw new ValidationError("This action can't be cancelled now.");
  if (row.approval_request_id)
    await agentDb().update(
      "ai_approval_requests",
      [eq("id", row.approval_request_id), eq("status", "pending")],
      { status: "cancelled", decision_note: `Cancelled: ${reason}` },
    );
  await recordAudit({
    actor: { userId: access.userId, label: actorLabel },
    action: "ops.action_cancelled",
    targetType: "ops_action",
    targetId: actionId,
    summary: `Cancelled: ${reason.slice(0, 120)}`,
  });
  const { onActionSettled } = await import("./engine");
  await onActionSettled(actionId);
}

export async function listActions(
  filter: { status?: ActionRow["status"][]; instanceId?: string; limit?: number } = {},
): Promise<ActionRow[]> {
  const filters = [];
  if (filter.status) filters.push(inList("status", filter.status));
  if (filter.instanceId) filters.push(eq("instance_id", filter.instanceId));
  return agentDb().select<ActionRow>("ops_actions", {
    filters,
    order: { col: "created_at", ascending: false },
    limit: filter.limit ?? 200,
  });
}

/** Approved actions waiting to run or retry (used by the background sweep). */
export async function runPendingActions(limit = 20): Promise<number> {
  const due = await agentDb().select<ActionRow>("ops_actions", {
    filters: [eq("status", "approved")],
    order: { col: "updated_at" },
    limit,
  });
  for (const a of due) await executeAction(a.id).catch(() => undefined);
  return due.length;
}

/** Test mode only: an administrator simulates leadership approval to preview a workflow. */
export async function simulateApproval(
  actionId: string,
  access: OpsAccess,
  actorLabel: string,
): Promise<ActionRow> {
  if (!access.canConfigure)
    throw new AuthorizationError("Only workflow administrators can run simulations.");
  const action = await selectOne<ActionRow>("ops_actions", { filters: [eq("id", actionId)] });
  if (!action || action.mode !== "test")
    throw new ValidationError("Simulated approval is only available in test mode.");
  const [row] = await agentDb().update<ActionRow>(
    "ops_actions",
    [eq("id", actionId), eq("status", "pending_approval")],
    { status: "approved", approved_via: "test-simulation" },
  );
  if (!row) throw new ValidationError("This action isn't waiting for approval.");
  if (row.approval_request_id)
    await agentDb().update(
      "ai_approval_requests",
      [eq("id", row.approval_request_id), eq("status", "pending")],
      { status: "cancelled", decision_note: "Test simulation" },
    );
  await recordAudit({
    actor: { userId: access.userId, label: actorLabel },
    action: "ops.test_simulation",
    targetType: "ops_action",
    targetId: actionId,
    summary: "Simulated approval in test mode.",
  });
  return executeAction(actionId);
}
