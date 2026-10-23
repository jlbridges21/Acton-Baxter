import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { listOfficeDelegations } from "@/lib/agents/office-activity";
import { listRuntimeStatuses } from "@/lib/agents/tasks";
import { taskSummary } from "@/lib/agents/task-format";
import { listVisibleTasks } from "@/lib/agents/views";

export const dynamic = "force-dynamic";

/**
 * Lightweight live state for the AI Office (fallback when Realtime is unavailable).
 * Runtime state and delegation pairs (ids/status/timestamps only) are non-sensitive; recent
 * tasks are filtered by visibility.
 */
export async function GET() {
  try {
    const ctx = await requireAiContext();
    const [statuses, recent, delegations] = await Promise.all([
      listRuntimeStatuses(),
      listVisibleTasks(ctx.requester, { limit: 12 }),
      listOfficeDelegations().catch(() => []),
    ]);
    return jsonOk({
      statuses: statuses.map((s) => ({
        agentId: s.agent_id,
        state: s.state,
        activeTaskCount: s.active_task_count,
        lastCompletedAt: s.last_completed_at,
        updatedAt: s.updated_at,
      })),
      recent: recent.map(taskSummary),
      delegations,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/status");
  }
}
