import { jsonError, jsonOk } from "@/lib/api";
import { listAudit } from "@/lib/agents/audit";
import { requireAiContext } from "@/lib/agents/http";
import { assertCanAdministerWorkspace } from "@/lib/agents/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const url = new URL(request.url);
    return jsonOk({
      entries: await listAudit({
        targetType: url.searchParams.get("type") ?? undefined,
        targetId: url.searchParams.get("id") ?? undefined,
        limit: 200,
      }),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/audit");
  }
}
