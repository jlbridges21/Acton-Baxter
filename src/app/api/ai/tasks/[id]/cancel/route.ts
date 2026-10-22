import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/agents/audit";
import { actorOf, requireAiContext } from "@/lib/agents/http";
import { getTask, requestTaskCancel } from "@/lib/agents/tasks";
import { accessByAgent } from "@/lib/agents/views";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { id } = await params;
    const task = await getTask(id);
    const access = await accessByAgent(ctx.requester);
    const allowed =
      task &&
      (task.initiating_user_id === ctx.requester.userId ||
        access.get(task.assigned_agent_id)?.has("manage"));
    if (!task || !allowed) throw new NotFoundError("Task not found");
    const updated = await requestTaskCancel(id);
    await recordAudit({
      actor: actorOf(ctx),
      action: "task.cancel_requested",
      targetType: "task",
      targetId: id,
      summary: "Cancellation requested.",
    });
    return jsonOk({ status: updated.status, cancelRequested: updated.cancel_requested });
  } catch (error) {
    return jsonError(error, "POST /api/ai/tasks/[id]/cancel");
  }
}
