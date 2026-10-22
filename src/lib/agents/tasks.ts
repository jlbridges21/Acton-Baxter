/**
 * Durable task records for delegated work, plus the derived per-agent runtime status
 * the AI Office displays.
 *
 * State transitions are validated and applied with a conditional update on the current
 * status, so two workers can never both move the same task (no duplicate side effects).
 */

import "server-only";

import { agentDb, eq, inList, isUniqueViolation, selectOne, type Filter } from "./store";
import {
  TERMINAL_TASK_STATUSES,
  type RuntimeState,
  type RuntimeStatusRow,
  type TaskChannel,
  type TaskEventRow,
  type TaskRow,
  type TaskStatus,
} from "./types";

export const TASK_LEASE_MS = 3 * 60_000;

const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["completed", "failed", "awaiting_approval", "queued", "cancelled"],
  awaiting_approval: ["completed", "cancelled", "failed"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED[from].includes(to);
}

export class TaskTransitionError extends Error {
  constructor(taskId: string, to: TaskStatus) {
    super(`Task ${taskId} cannot move to ${to} from its current state.`);
    this.name = "TaskTransitionError";
  }
}

export type CreateTaskInput = {
  idempotencyKey: string | null;
  parentTaskId?: string | null;
  initiatingUserId: string | null;
  initiatingUserLabel: string;
  channel: TaskChannel;
  conversationId?: string | null;
  assigningAgentId: string | null;
  assignedAgentId: string;
  configVersionId: string | null;
  taskType: string;
  title: string;
  instructions: string;
  delegationDepth: number;
  routing: Record<string, unknown>;
  allowedContext: Record<string, unknown>;
  sensitivity: "internal" | "confidential";
  maxAttempts?: number;
};

/** Create a task, or return the existing one for the same idempotency key. */
export async function createTask(
  input: CreateTaskInput,
): Promise<{ task: TaskRow; created: boolean }> {
  if (input.idempotencyKey) {
    const existing = await selectOne<TaskRow>("ai_tasks", {
      filters: [eq("idempotency_key", input.idempotencyKey)],
    });
    if (existing) return { task: existing, created: false };
  }
  try {
    const [task] = await agentDb().insert<TaskRow>("ai_tasks", {
      idempotency_key: input.idempotencyKey,
      parent_task_id: input.parentTaskId ?? null,
      initiating_user_id: input.initiatingUserId,
      initiating_user_label: input.initiatingUserLabel,
      channel: input.channel,
      conversation_id: input.conversationId ?? null,
      assigning_agent_id: input.assigningAgentId,
      assigned_agent_id: input.assignedAgentId,
      config_version_id: input.configVersionId,
      task_type: input.taskType,
      title: input.title.slice(0, 200),
      instructions: input.instructions,
      status: "queued",
      delegation_depth: input.delegationDepth,
      attempts: 0,
      max_attempts: input.maxAttempts ?? 2,
      lease_expires_at: null,
      routing: input.routing,
      allowed_context: input.allowedContext,
      result: null,
      error_code: null,
      error_message: null,
      approval_state: "none",
      model_provider: null,
      model_name: null,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      sensitivity: input.sensitivity,
      cancel_requested: false,
      started_at: null,
      completed_at: null,
    });
    await appendTaskEvent(task!.id, "created", "Assignment created.", {
      assignedAgentId: input.assignedAgentId,
    });
    await refreshRuntimeStatus(input.assignedAgentId);
    if (input.assigningAgentId) await refreshRuntimeStatus(input.assigningAgentId);
    return { task: task!, created: true };
  } catch (error) {
    if (input.idempotencyKey && isUniqueViolation(error)) {
      const existing = await selectOne<TaskRow>("ai_tasks", {
        filters: [eq("idempotency_key", input.idempotencyKey)],
      });
      if (existing) return { task: existing, created: false };
    }
    throw error;
  }
}

export async function getTask(id: string): Promise<TaskRow | null> {
  return selectOne<TaskRow>("ai_tasks", { filters: [eq("id", id)] });
}

export async function transitionTask(
  taskId: string,
  to: TaskStatus,
  patch: Partial<TaskRow> = {},
  options?: { from?: TaskStatus[] },
): Promise<TaskRow> {
  const fromStates = (options?.from ?? (Object.keys(ALLOWED) as TaskStatus[])).filter((s) =>
    canTransition(s, to),
  );
  const extra: Partial<TaskRow> = {};
  if (TERMINAL_TASK_STATUSES.has(to)) extra.completed_at = new Date().toISOString();
  if (to !== "running") extra.lease_expires_at = null;
  const [updated] = await agentDb().update<TaskRow>(
    "ai_tasks",
    [eq("id", taskId), inList("status", fromStates)],
    { ...patch, ...extra, status: to },
  );
  if (!updated) throw new TaskTransitionError(taskId, to);
  await refreshRuntimeStatus(updated.assigned_agent_id);
  if (updated.assigning_agent_id) await refreshRuntimeStatus(updated.assigning_agent_id);
  return updated;
}

/**
 * Claim a queued task (or a running task whose lease expired after a crash) for execution.
 * Returns null if another worker owns it or it is finished.
 */
export async function claimTask(taskId: string): Promise<TaskRow | null> {
  const task = await getTask(taskId);
  if (!task) return null;
  const now = new Date();
  const leaseExpired =
    task.status === "running" && (!task.lease_expires_at || new Date(task.lease_expires_at) < now);
  if (task.status !== "queued" && !leaseExpired) return null;
  if (task.cancel_requested) {
    await transitionTask(taskId, "cancelled", {}, { from: [task.status] });
    return null;
  }
  if (task.attempts >= task.max_attempts) {
    await transitionTask(
      taskId,
      "failed",
      {
        error_code: "MAX_ATTEMPTS",
        error_message: "The task was retried the maximum number of times.",
      },
      { from: [task.status] },
    ).catch(() => undefined);
    return null;
  }
  const [claimed] = await agentDb().update<TaskRow>(
    "ai_tasks",
    [eq("id", taskId), eq("status", task.status), eq("attempts", task.attempts)],
    {
      status: "running",
      attempts: task.attempts + 1,
      started_at: task.started_at ?? now.toISOString(),
      lease_expires_at: new Date(now.getTime() + TASK_LEASE_MS).toISOString(),
    },
  );
  if (!claimed) return null;
  await appendTaskEvent(
    taskId,
    "started",
    `${task.attempts > 0 ? "Retry started" : "Work started"} (attempt ${claimed.attempts}).`,
  );
  await refreshRuntimeStatus(claimed.assigned_agent_id);
  if (claimed.assigning_agent_id) await refreshRuntimeStatus(claimed.assigning_agent_id);
  return claimed;
}

export async function patchTask(taskId: string, patch: Partial<TaskRow>): Promise<void> {
  await agentDb().update("ai_tasks", [eq("id", taskId)], patch);
}

export async function appendTaskEvent(
  taskId: string,
  eventType: string,
  message: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await agentDb().insert("ai_task_events", {
    task_id: taskId,
    event_type: eventType,
    message: message.slice(0, 500),
    data,
  });
}

export async function listTaskEvents(taskId: string): Promise<TaskEventRow[]> {
  return agentDb().select<TaskEventRow>("ai_task_events", {
    filters: [eq("task_id", taskId)],
    order: { col: "created_at" },
  });
}

export async function requestTaskCancel(taskId: string): Promise<TaskRow> {
  const task = await getTask(taskId);
  if (!task) throw new TaskTransitionError(taskId, "cancelled");
  if (task.status === "queued" || task.status === "awaiting_approval") {
    const cancelled = await transitionTask(
      taskId,
      "cancelled",
      { cancel_requested: true },
      { from: [task.status] },
    );
    await appendTaskEvent(taskId, "cancelled", "Cancelled by a person.");
    return cancelled;
  }
  if (task.status === "running") {
    await patchTask(taskId, { cancel_requested: true });
    await appendTaskEvent(
      taskId,
      "cancel_requested",
      "Cancellation requested; the agent will stop at the next step.",
    );
    return { ...task, cancel_requested: true };
  }
  return task;
}

export type TaskListFilters = {
  agentId?: string;
  status?: TaskStatus | TaskStatus[];
  initiatingUserId?: string;
  since?: string;
  limit?: number;
};

export async function listTasks(filters: TaskListFilters = {}): Promise<TaskRow[]> {
  const f: Filter[] = [];
  if (filters.agentId) f.push(eq("assigned_agent_id", filters.agentId));
  if (filters.status) {
    f.push(
      Array.isArray(filters.status)
        ? inList("status", filters.status)
        : eq("status", filters.status),
    );
  }
  if (filters.initiatingUserId) f.push(eq("initiating_user_id", filters.initiatingUserId));
  if (filters.since) f.push({ col: "created_at", op: "gte", value: filters.since });
  return agentDb().select<TaskRow>("ai_tasks", {
    filters: f,
    order: { col: "created_at", ascending: false },
    limit: filters.limit ?? 100,
  });
}

// ---------------------------------------------------------------------------
// Runtime status (what the AI Office shows) — always derived from real tasks
// ---------------------------------------------------------------------------

const RECENT_FAILURE_MS = 10 * 60_000;

export function deriveRuntimeState(input: {
  ownActive: Array<Pick<TaskRow, "status">>;
  delegatedRunning: number;
  lastTerminal: Pick<TaskRow, "status" | "completed_at"> | null;
  now?: number;
}): RuntimeState {
  const running = input.ownActive.filter((t) => t.status === "running").length;
  const queued = input.ownActive.filter((t) => t.status === "queued").length;
  const awaitingApproval = input.ownActive.filter((t) => t.status === "awaiting_approval").length;
  if (running > 0) return "working";
  if (queued > 0) return "receiving";
  if (input.delegatedRunning > 0) return "awaiting_result";
  if (awaitingApproval > 0) return "awaiting_approval";
  const now = input.now ?? Date.now();
  if (
    input.lastTerminal?.status === "failed" &&
    input.lastTerminal.completed_at &&
    now - new Date(input.lastTerminal.completed_at).getTime() < RECENT_FAILURE_MS
  ) {
    return "failed";
  }
  return "idle";
}

export async function refreshRuntimeStatus(agentId: string): Promise<void> {
  try {
    const db = agentDb();
    const [ownActive, delegated, lastTerminal] = await Promise.all([
      db.select<TaskRow>("ai_tasks", {
        filters: [
          eq("assigned_agent_id", agentId),
          inList("status", ["queued", "running", "awaiting_approval"]),
        ],
        order: { col: "created_at", ascending: false },
        limit: 50,
      }),
      db.select<TaskRow>("ai_tasks", {
        filters: [eq("assigning_agent_id", agentId), inList("status", ["queued", "running"])],
        limit: 50,
      }),
      db.select<TaskRow>("ai_tasks", {
        filters: [
          eq("assigned_agent_id", agentId),
          inList("status", ["completed", "failed", "cancelled"]),
        ],
        order: { col: "completed_at", ascending: false },
        limit: 1,
      }),
    ]);
    const state = deriveRuntimeState({
      ownActive,
      delegatedRunning: delegated.length,
      lastTerminal: lastTerminal[0] ?? null,
    });
    const current =
      ownActive.find((t) => t.status === "running") ?? ownActive[0] ?? delegated[0] ?? null;
    await db.upsert<RuntimeStatusRow>(
      "ai_agent_runtime_status",
      {
        agent_id: agentId,
        state,
        active_task_count: ownActive.length,
        current_task_id: current?.id ?? null,
        last_completed_at: lastTerminal[0]?.completed_at ?? null,
        updated_at: new Date().toISOString(),
      },
      ["agent_id"],
    );
  } catch (error) {
    console.error("[agents.runtime_status.refresh_failed]", {
      agentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function listRuntimeStatuses(): Promise<RuntimeStatusRow[]> {
  return agentDb().select<RuntimeStatusRow>("ai_agent_runtime_status");
}

/** Running tasks whose lease expired (worker crashed or the function timed out). */
export async function listStaleRunningTasks(limit = 20): Promise<TaskRow[]> {
  return agentDb().select<TaskRow>("ai_tasks", {
    filters: [
      eq("status", "running"),
      { col: "lease_expires_at", op: "lt", value: new Date().toISOString() },
    ],
    limit,
  });
}

export async function listQueuedTasks(limit = 10): Promise<TaskRow[]> {
  return agentDb().select<TaskRow>("ai_tasks", {
    filters: [eq("status", "queued")],
    order: { col: "created_at" },
    limit,
  });
}
