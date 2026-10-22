import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { restoreVersion } from "@/lib/agents/admin";
import { actorOf, requireAgentAccess, requireAiContext } from "@/lib/agents/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgentAccess(ctx, slug, "manage");
    const { versionId } = z.object({ versionId: z.string().uuid() }).parse(await request.json());
    const version = await restoreVersion(agent.row.id, versionId, actorOf(ctx));
    return jsonOk({ version });
  } catch (error) {
    return jsonError(error, "POST /api/ai/agents/[slug]/restore");
  }
}
