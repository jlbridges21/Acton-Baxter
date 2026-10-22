import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/agents/audit";
import { actorOf, requireAiContext } from "@/lib/agents/http";
import { enqueueAgentTaskJob } from "@/lib/agents/jobs";
import { appendTaskEvent, getTask, transitionTask } from "@/lib/agents/tasks";
import { accessByAgent } from "@/lib/agents/views";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Re-queue a failed task for one more background attempt (agent managers only). */
export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { id } = await params;
    const task = await getTask(id);
    const access = await accessByAgent(ctx.requester);
    if (!task || !access.get(task.assigned_agent_id)?.has("manage"))
      throw new NotFoundError("Task not found");
    if (task.status !== "failed") throw new ValidationError("Only failed tasks can be retried.");
    if (task.channel === "sandbox") throw new ValidationError("Run the test again instead.");
    await transitionTask(
      id,
      "queued",
      { max_attempts: task.attempts + 1, error_code: null, error_message: null },
      { from: ["failed"] },
    );
    await appendTaskEvent(id, "retry_requested", "Retry requested by a manager.");
    await enqueueAgentTaskJob(id, { slackTarget: null });
    await recordAudit({
      actor: actorOf(ctx),
      action: "task.retried",
      targetType: "task",
      targetId: id,
      summary: "Manual retry queued.",
    });
    return jsonOk({ status: "queued" });
  } catch (error) {
    return jsonError(error, "POST /api/ai/tasks/[id]/retry");
  }
}
