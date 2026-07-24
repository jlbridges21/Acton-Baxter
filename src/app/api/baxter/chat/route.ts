import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { baxterChatRequestSchema } from "@/lib/baxter-ai/schemas";
import { EMPLOYEE_SAFE_CHAT_ERROR } from "@/lib/baxter-ai/errors";

export async function POST(request: Request) {
  try {
    const env = getEnv();
    if (!env.BAXTER_CHAT_ENABLED) {
      throw new AppError("Baxter chat is currently disabled.", {
        code: "BAXTER_CHAT_DISABLED",
        statusCode: 503,
        expose: true,
      });
    }

    const user = await requireActiveUser();
    const rate = checkRateLimit(`baxter-chat:${user.id}`, { limit: 20, windowMs: 60_000 });
    if (!rate.allowed) {
      throw new AppError("Too many Baxter questions. Please try again shortly.", {
        code: "RATE_LIMITED",
        statusCode: 429,
        expose: true,
      });
    }

    const body = await request.json();
    const parsed = baxterChatRequestSchema.parse(body);

    const result = await answerBaxterQuestion({
      question: parsed.question,
      conversationId: parsed.conversationId,
      userId: user.id,
      userName: user.profile.full_name ?? user.email,
      channel: "web",
    });

    return jsonOk({
      conversationId: result.conversationId,
      message: {
        id: result.messageId,
        answer: result.answer,
        confidence: result.confidence,
        insufficientKnowledge: result.insufficientKnowledge,
        sources: result.sources,
      },
    });
  } catch (error) {
    // Never expose provider/stack details to employees.
    if (error instanceof AppError && error.expose) {
      return jsonError(error, "POST /api/baxter/chat");
    }
    const safe = new AppError(EMPLOYEE_SAFE_CHAT_ERROR, {
      code: "BAXTER_CHAT_FAILED",
      statusCode: 502,
      expose: true,
      cause: error,
    });
    return jsonError(safe, "POST /api/baxter/chat");
  }
}
