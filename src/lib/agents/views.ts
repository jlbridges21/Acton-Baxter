/**
 * Read models for the AI Workspace UI: which tasks a person may see, and Mission
 * Control aggregates. Visibility is decided here on the server for every request.
 *
 * Who sees a task's full content (instructions, result, events):
 *   - the person who asked
 *   - anyone with "view_activity" (or higher) on the assigned agent (admins implicitly)
 * Everyone else with workspace access sees only that the agent exists and its state.
 */

import "server-only";

import { listApprovals } from "./approvals";
import { estimateCostUsd } from "./models";
import { getAgentAccess } from "./permissions";
import { listResolvedAgents } from "./registry";
import { listRuntimeStatuses, listTasks, type TaskListFilters } from "./tasks";
import type {
  AccessLevel,
  Requester,
  ResolvedAgent,
  RuntimeStatusRow,
  TaskRow,
  TaskStatus,
} from "./types";

export async function accessByAgent(requester: Requester): Promise<Map<string, Set<AccessLevel>>> {
  const agents = await listResolvedAgents();
  const entries = await Promise.all(
    agents.map(async (a) => [a.row.id, await getAgentAccess(requester, a)] as const),
  );
  return new Map(entries);
}

export function canViewTask(
  requester: Requester,
  task: TaskRow,
  access: Map<string, Set<AccessLevel>>,
): boolean {
  if (requester.userId && task.initiating_user_id === requester.userId) return true;
  return access.get(task.assigned_agent_id)?.has("view_activity") ?? false;
}

export async function listVisibleTasks(requester: Requester, filters: TaskListFilters = {}) {
  const access = await accessByAgent(requester);
  const tasks = await listTasks({ ...filters, limit: Math.min(filters.limit ?? 100, 500) });
  return tasks.filter((t) => canViewTask(requester, t, access));
}

export type AgentCard = {
  id: string;
  slug: string;
  name: string;
  title: string;
  description: string;
  department: string | null;
  departmentColor: string | null;
  avatarUrl: string | null;
  kind: ResolvedAgent["row"]["kind"];
  status: ResolvedAgent["row"]["status"];
  statusLabel: string | null;
  managerName: string | null;
  managerId: string | null;
  model: string;
  provider: string;
  modelSource: string;
  versionNumber: number | null;
  configValid: boolean;
  runtime: Pick<
    RuntimeStatusRow,
    "state" | "active_task_count" | "last_completed_at" | "updated_at"
  > | null;
  desk: ResolvedAgent["row"]["desk"];
  departmentId: string | null;
  access: AccessLevel[];
};

export async function listAgentCards(
  requester: Requester,
  options?: { includeArchived?: boolean },
): Promise<AgentCard[]> {
  const [agents, statuses] = await Promise.all([listResolvedAgents(), listRuntimeStatuses()]);
  const statusById = new Map(statuses.map((s) => [s.agent_id, s]));
  const byId = new Map(agents.map((a) => [a.row.id, a]));
  const access = await accessByAgent(requester);
  return agents
    .filter((a) => options?.includeArchived || a.row.status !== "archived")
    .map((a) => {
      const runtime = statusById.get(a.row.id);
      const manager = a.row.manager_agent_id ? byId.get(a.row.manager_agent_id) : null;
      return {
        id: a.row.id,
        slug: a.row.slug,
        name: a.row.display_name,
        title: a.row.title,
        description: a.row.description,
        department: a.department?.name ?? null,
        departmentColor: a.department?.color ?? null,
        departmentId: a.row.department_id,
        avatarUrl: a.row.avatar_url,
        kind: a.row.kind,
        status: a.row.status,
        statusLabel: a.row.status_label,
        managerName: manager?.row.display_name ?? null,
        managerId: manager?.row.id ?? null,
        model:
          a.config.model.source === "environment" ? "Deployment default" : a.config.model.model,
        provider: a.config.model.source === "environment" ? "environment" : a.config.model.provider,
        modelSource: a.config.model.source,
        versionNumber: a.versionNumber,
        configValid: a.versionId !== null,
        runtime: runtime
          ? {
              state: runtime.state,
              active_task_count: runtime.active_task_count,
              last_completed_at: runtime.last_completed_at,
              updated_at: runtime.updated_at,
            }
          : null,
        desk: a.row.desk ?? {},
        access: [...(access.get(a.row.id) ?? [])],
      };
    });
}

export type MissionControlFilters = {
  agentId?: string;
  departmentId?: string;
  status?: TaskStatus;
  sinceDays: number;
};

export async function getMissionControl(requester: Requester, filters: MissionControlFilters) {
  const since = new Date(Date.now() - filters.sinceDays * 86_400_000).toISOString();
  const cards = await listAgentCards(requester);
  const agentIdsInDept = filters.departmentId
    ? new Set(cards.filter((c) => c.departmentId === filters.departmentId).map((c) => c.id))
    : null;
  const tasks = (
    await listVisibleTasks(requester, {
      since,
      limit: 500,
      agentId: filters.agentId,
      status: filters.status,
    })
  ).filter((t) => !agentIdsInDept || agentIdsInDept.has(t.assigned_agent_id));
  const visibleAgentIds = new Set(tasks.map((t) => t.assigned_agent_id));
  const approvals = await listApprovals({ status: "pending", limit: 200 });
  const access = await accessByAgent(requester);
  const pendingApprovals = approvals.filter((a) => access.get(a.agent_id)?.has("approve"));

  const byModel = new Map<
    string,
    {
      provider: string;
      model: string;
      tasks: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      costKnown: boolean;
    }
  >();
  for (const t of tasks) {
    if (!t.model_name) continue;
    const key = `${t.model_provider}:${t.model_name}`;
    const row = byModel.get(key) ?? {
      provider: t.model_provider ?? "",
      model: t.model_name,
      tasks: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costKnown: estimateCostUsd(t.model_provider ?? "", t.model_name, 1, 1) !== null,
    };
    row.tasks += 1;
    row.inputTokens += t.input_tokens;
    row.outputTokens += t.output_tokens;
    row.costUsd += Number(t.estimated_cost_usd) || 0;
    byModel.set(key, row);
  }
  const count = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;
  return {
    since,
    agents: {
      registered: cards.length,
      active: cards.filter((c) => c.status === "active").length,
      busy: cards.filter((c) => c.runtime && c.runtime.state !== "idle").length,
    },
    tasks: {
      total: tasks.length,
      running: count("running") + count("queued"),
      awaitingApproval: count("awaiting_approval"),
      completed: count("completed"),
      failed: count("failed"),
      cancelled: count("cancelled"),
      delegated: tasks.filter((t) => t.assigning_agent_id).length,
    },
    usage: {
      inputTokens: tasks.reduce((s, t) => s + t.input_tokens, 0),
      outputTokens: tasks.reduce((s, t) => s + t.output_tokens, 0),
      costUsd: tasks.reduce((s, t) => s + (Number(t.estimated_cost_usd) || 0), 0),
      byModel: [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd),
    },
    pendingApprovals: pendingApprovals.length,
    recent: tasks.slice(0, 25),
    failures: tasks.filter((t) => t.status === "failed").slice(0, 10),
    visibleAgentIds: [...visibleAgentIds],
    cards,
  };
}
