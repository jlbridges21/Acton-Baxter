import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { listApprovals } from "@/lib/agents/approvals";
import { requireAiContext } from "@/lib/agents/http";
import { getTask, listTaskEvents } from "@/lib/agents/tasks";
import { taskSummary } from "@/lib/agents/task-format";
import { accessByAgent, canViewTask } from "@/lib/agents/views";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { id } = await params;
    const task = await getTask(id);
    const access = await accessByAgent(ctx.requester);
    // Same 404 for "missing" and "not allowed" so task ids can't be probed.
    if (!task || !canViewTask(ctx.requester, task, access))
      throw new NotFoundError("Task not found");
    const agentAccess = access.get(task.assigned_agent_id) ?? new Set();
    const isOwner = task.initiating_user_id === ctx.requester.userId;
    return jsonOk({
      task: {
        ...taskSummary(task),
        instructions: task.instructions,
        result: task.result,
        errorMessage: task.error_message,
        routing: task.routing,
        cancelRequested: task.cancel_requested,
        maxAttempts: task.max_attempts,
      },
      events: (await listTaskEvents(id)).map((e) => ({
        id: e.id,
        type: e.event_type,
        message: e.message,
        createdAt: e.created_at,
        // Event data holds token counts and tool names only — never document text.
        data: e.data,
      })),
      approvals: (await listApprovals({ taskId: id })).map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        actionType: a.action_type,
      })),
      can: {
        cancel:
          (isOwner || agentAccess.has("manage")) &&
          ["queued", "running", "awaiting_approval"].includes(task.status),
        retry: agentAccess.has("manage") && task.status === "failed",
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/tasks/[id]");
  }
}
