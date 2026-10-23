/**
 * AI tasks — live, through the AI Workforce's own visibility rule (listVisibleTasks →
 * canViewTask: your own tasks, or tasks of agents you hold "view activity" on).
 * Only the task title, agent, and status are searched — never instructions or results.
 * Confidential tasks are only searchable by the person who started them.
 */

import "server-only";

import type { TaskRow } from "@/lib/agents/types";
import type { SearchContext } from "../context";
import type { ProviderHit, SearchProvider } from "../provider";
import { safeId } from "../safety";

const UUID = /^[0-9a-f-]{36}$/i;

async function visibleTasks(
  ctx: SearchContext,
): Promise<{ tasks: TaskRow[]; agentName: Map<string, string> }> {
  const [{ listVisibleTasks }, { listResolvedAgents }] = await Promise.all([
    import("@/lib/agents/views"),
    import("@/lib/agents/registry"),
  ]);
  const [tasks, agents] = await Promise.all([
    listVisibleTasks(ctx.requester, { limit: 300 }),
    listResolvedAgents(),
  ]);
  return {
    tasks: tasks.filter(
      (t) =>
        !t.parent_task_id &&
        (t.sensitivity !== "confidential" || t.initiating_user_id === ctx.user.id),
    ),
    agentName: new Map(agents.map((a) => [a.row.id, a.row.display_name])),
  };
}

function toHit(t: TaskRow, agentName: Map<string, string>): ProviderHit | null {
  const id = safeId(t.id, UUID);
  if (!id) return null;
  const agent = agentName.get(t.assigned_agent_id) ?? "Agent";
  const status = t.status.replace(/_/g, " ");
  return {
    recordId: id,
    title: t.title || "Untitled task",
    subtitle: `${agent} · ${status}`,
    description: null,
    breadcrumb: ["AI Workspace", "Tasks"],
    url: `/ai/tasks/${id}`,
    icon: "check-square",
    updatedAt: t.updated_at,
    auth: "record",
    match: { title: t.title, fields: [agent, status] },
  };
}

export const tasksProvider: SearchProvider = {
  id: "ai-tasks",
  category: "tasks",
  name: "AI tasks",
  icon: "check-square",
  sourceSystem: "ai_registry",
  description: "Tasks given to Baxter's agents that you can already see in the AI Workspace.",
  searchableFields: [
    { key: "title", label: "Task title", sensitivity: "standard", defaultEnabled: true },
    {
      key: "instructions",
      label: "Instructions",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
    { key: "result", label: "Results", sensitivity: "restricted", defaultEnabled: false },
  ],
  optional: true,
  indexing: "live",
  permissionSummary:
    "Your own tasks, plus tasks of agents you have View activity on. Confidential tasks only for the person who started them.",
  minQueryLength: 2,
  timeoutMs: 2500,
  async canUse() {
    return true;
  },
  async availability() {
    return { available: true };
  },
  async search(ctx) {
    const { tasks, agentName } = await visibleTasks(ctx);
    return {
      hits: tasks.map((t) => toHit(t, agentName)).filter((h): h is ProviderHit => h !== null),
      freshness: { kind: "live" },
    };
  },
  async lookup(ctx, ids) {
    const { tasks, agentName } = await visibleTasks(ctx);
    return tasks
      .filter((t) => ids.includes(t.id))
      .map((t) => toHit(t, agentName))
      .filter((h): h is ProviderHit => h !== null);
  },
};
