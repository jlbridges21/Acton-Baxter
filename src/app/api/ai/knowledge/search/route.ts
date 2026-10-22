import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { requireAgentAccess, requireAiContext } from "@/lib/agents/http";
import { searchAgentKnowledge } from "@/lib/agents/knowledge";
import { getAgentAccess } from "@/lib/agents/permissions";

export const dynamic = "force-dynamic";

/** Lets managers preview what an agent would retrieve for a question (same filters as the agent). */
export async function GET(request: Request) {
  try {
    const ctx = await requireAiContext();
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) throw new ValidationError("Enter a search phrase.");
    const agent = await requireAgentAccess(ctx, url.searchParams.get("agent") ?? "", "manage");
    const { hits, searchedDocuments } = await searchAgentKnowledge({
      agentId: agent.row.id,
      access: await getAgentAccess(ctx.requester, agent),
      query: q.slice(0, 400),
      limit: 8,
    });
    return jsonOk({ hits, searchedDocuments });
  } catch (error) {
    return jsonError(error, "GET /api/ai/knowledge/search");
  }
}
