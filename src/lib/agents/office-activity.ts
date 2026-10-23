/**
 * Who-is-handing-what-to-whom for the AI Office animation.
 *
 * Returns only agent ids, status, and timestamps — no titles, instructions, or results —
 * so it is as non-sensitive as ai_agent_runtime_status (which already says "Baxter is
 * waiting on a specialist" and "Sam is working"). Task content stays behind the normal
 * visibility checks in listVisibleTasks.
 */

import "server-only";

import type { DelegationSnapshot } from "@/lib/office/task-coordinator";
import { agentDb, inList, type Filter } from "./store";
import type { TaskRow } from "./types";

/** Long enough to animate a result that landed between two slow polls. */
const RECENT_MS = 10 * 60_000;

export async function listOfficeDelegations(now = Date.now()): Promise<DelegationSnapshot[]> {
  const delegated: Filter = { col: "assigning_agent_id", op: "not_null" };
  const db = agentDb();
  const [active, recent] = await Promise.all([
    db.select<TaskRow>("ai_tasks", {
      filters: [delegated, inList("status", ["queued", "running", "awaiting_approval"])],
      order: { col: "created_at", ascending: false },
      limit: 20,
    }),
    db.select<TaskRow>("ai_tasks", {
      filters: [
        delegated,
        inList("status", ["completed", "failed", "cancelled"]),
        { col: "completed_at", op: "gte", value: new Date(now - RECENT_MS).toISOString() },
      ],
      order: { col: "completed_at", ascending: false },
      limit: 20,
    }),
  ]);
  const seen = new Set<string>();
  const out: DelegationSnapshot[] = [];
  for (const t of [...active, ...recent]) {
    if (!t.assigning_agent_id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({
      id: t.id,
      fromAgentId: t.assigning_agent_id,
      toAgentId: t.assigned_agent_id,
      status: t.status,
      createdAt: t.created_at,
      startedAt: t.started_at,
      completedAt: t.completed_at,
    });
  }
  return out;
}
