import { jsonError, jsonOk } from "@/lib/api";
import { publishDraft } from "@/lib/agents/admin";
import { actorOf, requireAgentAccess, requireAiContext } from "@/lib/agents/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgentAccess(ctx, slug, "manage");
    const version = await publishDraft(agent.row.id, actorOf(ctx));
    return jsonOk({ version });
  } catch (error) {
    return jsonError(error, "POST /api/ai/agents/[slug]/publish");
  }
}
