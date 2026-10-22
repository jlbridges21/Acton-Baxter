import { jsonError, jsonOk } from "@/lib/api";
import { AuthorizationError } from "@/lib/errors";
import { getConfigState } from "@/lib/agents/admin";
import { requireAgent, requireAiContext } from "@/lib/agents/http";
import { getAgentAccess } from "@/lib/agents/permissions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** Full configuration of earlier versions (for compare/restore). */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgent(slug);
    const access = await getAgentAccess(ctx.requester, agent);
    if (!access.has("manage") && !access.has("view_activity")) {
      throw new AuthorizationError("You can't view this agent's configuration.");
    }
    const id = new URL(request.url).searchParams.get("id");
    const { history } = await getConfigState(agent.row.id);
    return jsonOk({
      versions: history
        .filter((v) => !id || v.id === id)
        .map((v) => ({
          id: v.id,
          version_number: v.version_number,
          status: v.status,
          config: v.config,
        })),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/agents/[slug]/versions");
  }
}
