import { jsonError, jsonOk } from "@/lib/api";
import { APPROVAL_ACTION_LABELS, listApprovals } from "@/lib/agents/approvals";
import { requireAiContext } from "@/lib/agents/http";
import { listResolvedAgents } from "@/lib/agents/registry";
import { accessByAgent } from "@/lib/agents/views";
import type { ApprovalStatus } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

/** Approvals visible to people with "approve" access on the agent (admins implicitly). */
export async function GET(request: Request) {
  try {
    const ctx = await requireAiContext();
    const statusParam = new URL(request.url).searchParams.get("status") ?? "pending";
    const access = await accessByAgent(ctx.requester);
    const agentIds = [...access.entries()]
      .filter(([, set]) => set.has("approve"))
      .map(([id]) => id);
    if (agentIds.length === 0) return jsonOk({ approvals: [], canApprove: false });
    const agents = new Map((await listResolvedAgents()).map((a) => [a.row.id, a]));
    const status = (
      ["pending", "approved", "rejected", "cancelled"].includes(statusParam)
        ? statusParam
        : "pending"
    ) as ApprovalStatus;
    const rows = await listApprovals({ status, agentIds, limit: 100 });
    return jsonOk({
      canApprove: true,
      approvals: rows.map((a) => ({
        id: a.id,
        taskId: a.task_id,
        agentName: agents.get(a.agent_id)?.row.display_name ?? "Agent",
        agentSlug: agents.get(a.agent_id)?.row.slug ?? null,
        avatarUrl: agents.get(a.agent_id)?.row.avatar_url ?? null,
        actionType: a.action_type,
        actionLabel: APPROVAL_ACTION_LABELS[a.action_type] ?? a.action_type,
        title: a.title,
        summary: a.summary,
        payload: a.payload,
        status: a.status,
        decisionNote: a.decision_note,
        decidedAt: a.decided_at,
        createdAt: a.created_at,
      })),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/approvals");
  }
}
