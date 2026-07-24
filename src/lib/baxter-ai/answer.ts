import "server-only";

import {
  appendAssistantMessage,
  appendUserMessage,
  getOrCreateWebConversation,
  toPublicAnswer,
} from "./conversations";
import { retrieveBaxterContext } from "./context";
import { INSUFFICIENT_KNOWLEDGE_ANSWER, mapUsedSourceNumbers } from "./citations";
import { getBaxterLlmProvider } from "./openai-provider";
import { BaxterConfigError, EMPLOYEE_SAFE_CHAT_ERROR } from "./errors";
import { logServerError } from "@/lib/errors";
import type { BaxterAnswer, BaxterQuestionInput } from "./types";

/**
 * Shared Baxter answering entry point for web (Prompt 3) and future Slack (Prompt 4).
 */
export async function answerBaxterQuestion(input: BaxterQuestionInput): Promise<BaxterAnswer> {
  const question = input.question.trim();
  const conversation = await getOrCreateWebConversation({
    userId: input.userId,
    userName: input.userName,
    conversationId: input.conversationId,
  });

  await appendUserMessage({
    conversationId: conversation.id,
    content: question,
  });

  const contextItems = await retrieveBaxterContext(question);

  if (contextItems.length === 0) {
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: INSUFFICIENT_KNOWLEDGE_ANSWER,
      insufficientKnowledge: true,
      confidence: "low",
      modelProvider: null,
      modelName: null,
      sources: [],
      sourceEntryIds: [],
    });

    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer: INSUFFICIENT_KNOWLEDGE_ANSWER,
      sources: [],
      confidence: "low",
      insufficientKnowledge: true,
    });
  }

  try {
    const provider = getBaxterLlmProvider();
    const llm = await provider.generateAnswer({
      question,
      contextItems,
      userName: input.userName,
      channel: input.channel,
    });

    let sources = mapUsedSourceNumbers(llm.usedSourceNumbers, contextItems);
    const insufficientKnowledge = llm.insufficientKnowledge || sources.length === 0;
    if (insufficientKnowledge) {
      sources = [];
    }

    const answerText =
      llm.answer.trim() ||
      (insufficientKnowledge ? INSUFFICIENT_KNOWLEDGE_ANSWER : EMPLOYEE_SAFE_CHAT_ERROR);

    const sourceEntryIds = sources.map((source, index) => {
      const item = contextItems.find((ctx) => ctx.citationLabel === source.citationLabel);
      return {
        id: item!.id,
        relevanceScore: item?.relevanceScore ?? null,
        order: index + 1,
      };
    });

    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: answerText,
      insufficientKnowledge,
      confidence: insufficientKnowledge ? "low" : llm.confidence,
      modelProvider: llm.modelProvider,
      modelName: llm.modelName,
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      latencyMs: llm.latencyMs,
      sources,
      sourceEntryIds,
    });

    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer: answerText,
      sources,
      confidence: insufficientKnowledge ? "low" : llm.confidence,
      insufficientKnowledge,
    });
  } catch (error) {
    const errorCode =
      error instanceof Error && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_AI_ERROR")
        : "BAXTER_AI_ERROR";

    await appendAssistantMessage({
      conversationId: conversation.id,
      content: EMPLOYEE_SAFE_CHAT_ERROR,
      insufficientKnowledge: false,
      confidence: "low",
      modelProvider: null,
      modelName: null,
      errorCode,
      sources: [],
      sourceEntryIds: [],
    });

    logServerError("answerBaxterQuestion", error);

    if (error instanceof BaxterConfigError) {
      throw error;
    }

    throw error;
  }
}
