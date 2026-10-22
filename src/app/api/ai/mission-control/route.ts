import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { taskSummary } from "@/lib/agents/task-format";
import { TASK_STATUSES, type TaskStatus } from "@/lib/agents/types";
import { getMissionControl } from "@/lib/agents/views";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireAiContext();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const data = await getMissionControl(ctx.requester, {
      sinceDays: Math.min(Math.max(Number(url.searchParams.get("days") ?? 7) || 7, 1), 365),
      agentId: url.searchParams.get("agent") || undefined,
      departmentId: url.searchParams.get("department") || undefined,
      status:
        status && (TASK_STATUSES as readonly string[]).includes(status)
          ? (status as TaskStatus)
          : undefined,
    });
    return jsonOk({
      ...data,
      recent: data.recent.map(taskSummary),
      failures: data.failures.map(taskSummary),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/mission-control");
  }
}
