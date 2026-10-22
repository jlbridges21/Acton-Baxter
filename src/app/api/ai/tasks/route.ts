import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { TASK_STATUSES, type TaskStatus } from "@/lib/agents/types";
import { listVisibleTasks } from "@/lib/agents/views";
import { taskSummary } from "@/lib/agents/task-format";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireAiContext();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30) || 30, 1), 365);
    const tasks = await listVisibleTasks(ctx.requester, {
      agentId: url.searchParams.get("agent") ?? undefined,
      status:
        status && (TASK_STATUSES as readonly string[]).includes(status)
          ? (status as TaskStatus)
          : undefined,
      since: new Date(Date.now() - days * 86_400_000).toISOString(),
      limit: 200,
    });
    return jsonOk({ tasks: tasks.map(taskSummary) });
  } catch (error) {
    return jsonError(error, "GET /api/ai/tasks");
  }
}
