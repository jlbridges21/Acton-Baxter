import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { decideApproval, getApproval } from "@/lib/agents/approvals";
import { recordAudit } from "@/lib/agents/audit";
import { actorOf, requireAiContext } from "@/lib/agents/http";
import { accessByAgent } from "@/lib/agents/views";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(1000).nullable().optional(),
  subject: z.string().max(300).optional(),
  body: z.string().max(20_000).optional(),
});

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { id } = await params;
    const approval = await getApproval(id);
    const access = await accessByAgent(ctx.requester);
    if (!approval || !access.get(approval.agent_id)?.has("approve"))
      throw new NotFoundError("Approval not found");
    const input = bodySchema.parse(await request.json());
    const updated = await decideApproval({
      id,
      decision: input.decision,
      userId: ctx.user.id,
      note: input.note ?? null,
      editedPayload: { subject: input.subject, body: input.body },
    });
    await recordAudit({
      actor: actorOf(ctx),
      action: `approval.${input.decision}`,
      targetType: "approval",
      targetId: id,
      summary: `${input.decision === "approved" ? "Approved" : "Rejected"}: ${approval.title}`,
      details: { taskId: approval.task_id, actionType: approval.action_type },
    });
    return jsonOk({ approval: { id: updated.id, status: updated.status } });
  } catch (error) {
    return jsonError(error, "POST /api/ai/approvals/[id]");
  }
}
