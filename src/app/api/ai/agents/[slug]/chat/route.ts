import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAgentAccess, requireAiContext } from "@/lib/agents/http";
import { runDirectAgentRequest } from "@/lib/agents/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ slug: string }> };

const bodySchema = z.object({
  question: z.string().trim().min(1).max(4000),
  requestId: z.string().trim().min(8).max(80),
});

/** Direct chat with a specialist (requires "Chat directly" access). Baxter uses /api/baxter/chat. */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgentAccess(ctx, slug, "direct_chat");
    if (agent.row.kind === "orchestrator")
      throw new ValidationError("Chat with Baxter from the Baxter chat panel.");
    const rate = checkRateLimit(`agent-chat:${ctx.user.id}`, { limit: 15, windowMs: 60_000 });
    if (!rate.allowed) {
      throw new AppError("Too many requests. Please wait a moment.", {
        code: "RATE_LIMITED",
        statusCode: 429,
        expose: true,
      });
    }
    const body = bodySchema.parse(await request.json());
    const { outcome, task } = await runDirectAgentRequest({
      agent,
      requester: ctx.requester,
      question: body.question,
      requestId: body.requestId,
    });
    return jsonOk({
      taskId: task.id,
      status: task.status,
      ok: outcome.ok,
      result: outcome.ok ? outcome.result : null,
      error: outcome.ok ? null : { code: outcome.code, message: outcome.message },
    });
  } catch (error) {
    return jsonError(error, "POST /api/ai/agents/[slug]/chat");
  }
}
