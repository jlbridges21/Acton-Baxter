import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { discardDraft, publishProblems, saveDraft } from "@/lib/agents/admin";
import { actorOf, requireAgentAccess, requireAiContext } from "@/lib/agents/http";
import { agentConfigSchema } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const bodySchema = z.object({
  config: z.unknown(),
  changeSummary: z.string().trim().max(300).nullable().optional(),
});

export async function PUT(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgentAccess(ctx, slug, "manage");
    const body = bodySchema.parse(await request.json());
    const draft = await saveDraft({
      agentId: agent.row.id,
      config: body.config,
      changeSummary: body.changeSummary ?? null,
      actor: actorOf(ctx),
    });
    return jsonOk({
      draft,
      problems: publishProblems(agent.row, agentConfigSchema.parse(draft.config)),
    });
  } catch (error) {
    return jsonError(error, "PUT /api/ai/agents/[slug]/draft");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgentAccess(ctx, slug, "manage");
    await discardDraft(agent.row.id, actorOf(ctx));
    return jsonOk({ discarded: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/ai/agents/[slug]/draft");
  }
}
