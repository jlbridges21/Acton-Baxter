/**
 * Human approval queue for agent-proposed actions (communication drafts, review flags).
 *
 * Phase 1 never executes an external side effect on approval: approving a communication
 * draft marks it ready for a person to send themselves. There is no send integration.
 */

import "server-only";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { appendTaskEvent, getTask, transitionTask } from "./tasks";
import { agentDb, eq, inList, selectOne, type Filter } from "./store";
import type { ApprovalRow, ApprovalStatus } from "./types";

export const APPROVAL_ACTION_LABELS: Record<string, string> = {
  employee_communication: "Employee communication draft",
  human_review: "Needs human review",
};

export async function createApproval(input: {
  taskId: string | null;
  agentId: string;
  actionType: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  requestedForUserId: string | null;
}): Promise<ApprovalRow> {
  const [row] = await agentDb().insert<ApprovalRow>("ai_approval_requests", {
    task_id: input.taskId,
    agent_id: input.agentId,
    action_type: input.actionType,
    title: input.title.slice(0, 200),
    summary: input.summary.slice(0, 1000),
    payload: input.payload,
    status: "pending",
    requested_for_user_id: input.requestedForUserId,
    decided_by: null,
    decided_at: null,
    decision_note: null,
  });
  return row!;
}

export async function getApproval(id: string): Promise<ApprovalRow | null> {
  return selectOne<ApprovalRow>("ai_approval_requests", { filters: [eq("id", id)] });
}

export async function listApprovals(options: {
  status?: ApprovalStatus | ApprovalStatus[];
  agentIds?: string[];
  taskId?: string;
  limit?: number;
}): Promise<ApprovalRow[]> {
  const filters: Filter[] = [];
  if (options.status) {
    filters.push(
      Array.isArray(options.status)
        ? inList("status", options.status)
        : eq("status", options.status),
    );
  }
  if (options.agentIds) filters.push(inList("agent_id", options.agentIds));
  if (options.taskId) filters.push(eq("task_id", options.taskId));
  return agentDb().select<ApprovalRow>("ai_approval_requests", {
    filters,
    order: { col: "created_at", ascending: false },
    limit: options.limit ?? 100,
  });
}

export async function decideApproval(input: {
  id: string;
  decision: "approved" | "rejected";
  userId: string;
  note: string | null;
  /** Optional human edits to a draft before approving. */
  editedPayload?: { subject?: string; body?: string };
}): Promise<ApprovalRow> {
  const approval = await getApproval(input.id);
  if (!approval) throw new NotFoundError("Approval request not found");
  if (approval.status !== "pending") throw new ValidationError("This request was already decided.");
  // Sam Operations actions: CEO/COO only, bound to the exact payload, never edited in place.
  const isOps = approval.action_type.startsWith("ops.");
  if (isOps) {
    if (input.editedPayload)
      throw new ValidationError(
        "Sam's actions can't be edited during approval. Reject it and ask for a revised request.",
      );
    const { handleOpsApprovalDecision } = await import("@/lib/ops/actions");
    await handleOpsApprovalDecision(approval, input.decision, input.userId);
  }
  const payload = { ...approval.payload };
  if (input.editedPayload?.subject !== undefined)
    payload.subject = input.editedPayload.subject.slice(0, 300);
  if (input.editedPayload?.body !== undefined)
    payload.body = input.editedPayload.body.slice(0, 20_000);
  // Conditional on pending so two reviewers cannot both decide.
  const [updated] = await agentDb().update<ApprovalRow>(
    "ai_approval_requests",
    [eq("id", input.id), eq("status", "pending")],
    {
      status: input.decision,
      decided_by: input.userId,
      decided_at: new Date().toISOString(),
      decision_note: input.note?.slice(0, 1000) ?? null,
      payload,
    },
  );
  if (!updated) throw new ValidationError("This request was already decided.");
  if (isOps) {
    const { afterOpsApprovalDecision } = await import("@/lib/ops/actions");
    await afterOpsApprovalDecision(approval.id, input.decision, input.userId);
  }

  if (approval.task_id) {
    await appendTaskEvent(
      approval.task_id,
      `approval_${input.decision}`,
      `${APPROVAL_ACTION_LABELS[approval.action_type] ?? "Request"} ${input.decision}.`,
      { approvalId: approval.id },
    );
    await settleTaskApprovals(approval.task_id);
  }
  return updated;
}

/** When a task's last pending approval is decided, close the task out. */
async function settleTaskApprovals(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task || task.status !== "awaiting_approval") return;
  const approvals = await listApprovals({ taskId });
  if (approvals.some((a) => a.status === "pending")) return;
  const anyRejected = approvals.some((a) => a.status === "rejected");
  await transitionTask(
    taskId,
    "completed",
    { approval_state: anyRejected ? "rejected" : "approved" },
    {
      from: ["awaiting_approval"],
    },
  );
}
