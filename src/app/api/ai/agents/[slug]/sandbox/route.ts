import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { requireAgentAccess, requireAiContext } from "@/lib/agents/http";
import { runSandbox } from "@/lib/agents/testing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ slug: string }> };

/** Run the agent for real on a test question (draft or published config). Saves nothing. */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgentAccess(ctx, slug, "manage");
    if (agent.row.kind === "orchestrator") {
      throw new ValidationError("Test Baxter's delegation with the Delegation tester instead.");
    }
    const body = z
      .object({ question: z.string().trim().min(1).max(4000), useDraft: z.boolean().default(true) })
      .parse(await request.json());
    const { outcome, task, usedDraft } = await runSandbox({
      agentSlug: slug,
      question: body.question,
      actor: ctx.requester,
      useDraft: body.useDraft,
    });
    return jsonOk({
      taskId: task.id,
      usedDraft,
      ok: outcome.ok,
      result: outcome.ok ? outcome.result : null,
      error: outcome.ok ? null : { code: outcome.code, message: outcome.message },
      usage: {
        inputTokens: task.input_tokens,
        outputTokens: task.output_tokens,
        costUsd: Number(task.estimated_cost_usd),
      },
    });
  } catch (error) {
    return jsonError(error, "POST /api/ai/agents/[slug]/sandbox");
  }
}
