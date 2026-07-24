import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { baxterChatRequestSchema } from "@/lib/baxter-ai/schemas";
import { BaxterConfigError, employeeFacingErrorMessage } from "@/lib/baxter-ai/errors";
import { getIdempotentChatAnswer, storeIdempotentChatAnswer } from "@/lib/baxter-ai/idempotency";

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

    if (parsed.clientRequestId) {
      const cached = getIdempotentChatAnswer(user.id, parsed.clientRequestId);
      if (cached) {
        return jsonOk({
          conversationId: cached.conversationId,
          message: {
            id: cached.messageId,
            answer: cached.answer,
            confidence: cached.confidence,
            insufficientKnowledge: cached.insufficientKnowledge,
            sources: cached.sources,
            answerMode: cached.answerMode ?? null,
            errorCode: cached.errorCode ?? null,
          },
          idempotentReplay: true,
        });
      }
    }

    const result = await answerBaxterQuestion({
      question: parsed.question,
      conversationId: parsed.conversationId,
      userId: user.id,
      userName: user.profile.full_name ?? user.email,
      channel: "web",
    });

    if (parsed.clientRequestId) {
      storeIdempotentChatAnswer(user.id, parsed.clientRequestId, result);
    }

    return jsonOk({
      conversationId: result.conversationId,
      message: {
        id: result.messageId,
        answer: result.answer,
        confidence: result.confidence,
        insufficientKnowledge: result.insufficientKnowledge,
        sources: result.sources,
        answerMode: result.answerMode ?? null,
        errorCode: result.errorCode ?? null,
      },
    });
  } catch (error) {
    if (error instanceof BaxterConfigError) {
      return jsonError(
        new AppError(
          error.message.includes("Reference:")
            ? error.message
            : employeeFacingErrorMessage(error.code),
          {
            code: error.code,
            statusCode: error.statusCode,
            expose: true,
          },
        ),
        "POST /api/baxter/chat",
      );
    }
    if (error instanceof AppError && error.expose) {
      return jsonError(error, "POST /api/baxter/chat");
    }
    const code =
      error instanceof Error && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_UNKNOWN_ERROR")
        : "BAXTER_UNKNOWN_ERROR";
    const safe = new AppError(employeeFacingErrorMessage(code), {
      code,
      statusCode: 502,
      expose: true,
      cause: error,
    });
    return jsonError(safe, "POST /api/baxter/chat");
  }
}
