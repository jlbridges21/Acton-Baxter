import "server-only";

import {
  appendAssistantMessage,
  appendUserMessage,
  getOrCreateConversation,
  getRecentConversationHistory,
  resetBaxterConversation,
  toPublicAnswer,
} from "./conversations";
import { retrieveBaxterEvidence } from "./context";
import {
  INSUFFICIENT_KNOWLEDGE_ANSWER,
  GENERAL_KNOWLEDGE_NOTE,
  mapUsedSourceNumbers,
  contextItemToSourceReference,
} from "./citations";
import { getBaxterLlmProvider } from "./openai-provider";
import {
  BaxterConfigError,
  BaxterProviderError,
  employeeFacingErrorMessage,
  logBaxterDiagnostic,
} from "./errors";
import { classifyBaxterQuestion } from "./classify";
import {
  answerFromBaxterIdentity,
  buildBaxterIdentityContext,
  isPromptExtractionAttempt,
  isStandingBehaviorChangeRequest,
  promptExtractionRefusal,
  standingBehaviorChangeResponse,
} from "./identity";
import { getEnv } from "@/lib/env";
import type { BaxterAnswer, BaxterAnswerMode, BaxterQuestionInput } from "./types";
import { draftDirectStructuredAnswer } from "@/lib/knowledge-index";
import {
  baxterHelpText,
  CLEAR_RESPONSE_SLACK,
  CLEAR_RESPONSE_WEB,
  parseChatCommand,
} from "./commands";
import { ENTITY_CLARIFICATION_PROMPT, needsEntityClarification } from "./conversation-context";

/**
 * Shared Baxter answering entry point for web and Slack.
 */
export async function answerBaxterQuestion(input: BaxterQuestionInput): Promise<BaxterAnswer> {
  const question = input.question.trim();
  const command = parseChatCommand(question);

  if (command.type === "clear") {
    const reset = await resetBaxterConversation({
      previousConversationId: input.conversationId,
      userId: input.userId,
      userName: input.userName,
      channel: input.channel,
      externalThreadId: input.externalThreadId,
      externalUserId: input.externalUserId,
    });
    const content = input.channel === "slack" ? CLEAR_RESPONSE_SLACK : CLEAR_RESPONSE_WEB;
    const message = await appendAssistantMessage({
      conversationId: reset.conversation.id,
      content,
      insufficientKnowledge: false,
      confidence: "high",
      modelProvider: "command",
      modelName: "clear",
      sources: [],
      sourceEntryIds: [],
    });
    return toPublicAnswer({
      conversationId: reset.conversation.id,
      messageId: message.id,
      answer: content,
      sources: [],
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "identity",
    });
  }

  if (command.type === "help") {
    const conversation = await getOrCreateConversation({
      userId: input.userId,
      userName: input.userName,
      conversationId: input.conversationId,
      channel: input.channel,
      externalThreadId: input.externalThreadId,
      externalUserId: input.externalUserId,
    });
    await appendUserMessage({ conversationId: conversation.id, content: question });
    const content = baxterHelpText(input.channel);
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content,
      insufficientKnowledge: false,
      confidence: "high",
      modelProvider: "command",
      modelName: "help",
      sources: [],
      sourceEntryIds: [],
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer: content,
      sources: [],
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "identity",
    });
  }

  const questionClass = classifyBaxterQuestion(question);

  const conversation = await getOrCreateConversation({
    userId: input.userId,
    userName: input.userName,
    conversationId: input.conversationId,
    channel: input.channel,
    externalThreadId: input.externalThreadId,
    externalUserId: input.externalUserId,
  });

  await appendUserMessage({
    conversationId: conversation.id,
    content: question,
  });

  if (questionClass === "unsafe_or_disallowed") {
    const answer =
      "I can’t help with that request. Ask me about Acton knowledge, general work questions, or how I can help as Baxter.";
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: answer,
      insufficientKnowledge: false,
      confidence: "high",
      modelProvider: null,
      modelName: null,
      sources: [],
      sourceEntryIds: [],
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer,
      sources: [],
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "clarification",
    });
  }

  if (isPromptExtractionAttempt(question)) {
    const answer = promptExtractionRefusal();
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: answer,
      insufficientKnowledge: false,
      confidence: "high",
      modelProvider: "governance",
      modelName: "runtime",
      sources: [],
      sourceEntryIds: [],
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer,
      sources: [],
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "clarification",
    });
  }

  if (isStandingBehaviorChangeRequest(question)) {
    const answer = standingBehaviorChangeResponse();
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: answer,
      insufficientKnowledge: false,
      confidence: "high",
      modelProvider: "governance",
      modelName: "change-control",
      sources: [],
      sourceEntryIds: [],
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer,
      sources: [],
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "clarification",
    });
  }

  // Fast path: identity questions with no need for OpenAI when KB is empty.
  const historyEarly = await getRecentConversationHistory(conversation.id, {
    limit: 10,
    excludeLastUser: true,
  });
  const evidence = await retrieveBaxterEvidence(question, historyEarly);
  const contextItems = evidence.contextItems;

  // Deterministic structured answer when we have a direct field value
  let direct =
    evidence.structured && !evidence.structured.ambiguous
      ? draftDirectStructuredAnswer(question, evidence.structured)
      : evidence.structured?.ambiguous
        ? evidence.structured.clarificationPrompt
        : null;

  if (direct && evidence.conflicts.length > 0) {
    const conflictLines = evidence.conflicts
      .map(
        (c) =>
          `I found conflicting approved Acton information. One source lists ${c.values[0]} and another lists ${c.values[1]}.`,
      )
      .join(" ");
    direct = `${conflictLines} Please review the cited sources.`;
  }

  if (
    direct &&
    evidence.structured &&
    (evidence.structured.lookups[0]?.directValue ||
      evidence.structured.aggregates[0] ||
      evidence.structured.ambiguous)
  ) {
    const sources = contextItems.slice(0, 1).map((item) => contextItemToSourceReference(item));
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: direct,
      insufficientKnowledge: false,
      confidence: evidence.structured.ambiguous ? "medium" : "high",
      modelProvider: "structured-index",
      modelName: "knowledge-units-v1",
      sources,
      sourceEntryIds: sources.map((s, index) => ({
        id: s.knowledgeEntryId!,
        relevanceScore: contextItems[index]?.relevanceScore ?? null,
        order: index + 1,
      })),
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer: direct,
      sources,
      confidence: evidence.structured.ambiguous ? "medium" : "high",
      insufficientKnowledge: false,
      answerMode: evidence.structured.ambiguous ? "clarification" : "grounded",
    });
  }

  // After /clear or a standalone field question with no entity — ask which project.
  if (
    needsEntityClarification(question, evidence.inheritEntities) &&
    !evidence.structured?.lookups[0]?.directValue &&
    !evidence.structured?.aggregates[0]
  ) {
    const answer = ENTITY_CLARIFICATION_PROMPT;
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: answer,
      insufficientKnowledge: false,
      confidence: "medium",
      modelProvider: "context-policy",
      modelName: "entity-clarification",
      sources: [],
      sourceEntryIds: [],
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer,
      sources: [],
      confidence: "medium",
      insufficientKnowledge: false,
      answerMode: "clarification",
    });
  }

  if (
    questionClass === "baxter_identity" &&
    contextItems.length === 0 &&
    !needsOpenAiForIdentityFollowUp(question)
  ) {
    const answer = answerFromBaxterIdentity(question);
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: answer,
      insufficientKnowledge: false,
      confidence: "high",
      modelProvider: "identity",
      modelName: "built-in",
      sources: [],
      sourceEntryIds: [],
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer,
      sources: [],
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "identity",
    });
  }

  // For identity questions, still call OpenAI when nuance is needed; empty KB is OK.
  if (questionClass === "baxter_identity" && contextItems.length === 0) {
    // identity layer in the prompt remains authoritative
  }

  const history = historyEarly;

  const openaiConfigured = Boolean((getEnv().OPENAI_API_KEY ?? "").trim());

  if (!openaiConfigured) {
    if (
      questionClass === "acton_company_specific" ||
      questionClass === "acton_process_specific" ||
      contextItems.length === 0
    ) {
      const answer =
        questionClass === "general_knowledge" || questionClass === "conversational"
          ? "I can help with general questions once OPENAI_API_KEY is configured. Meanwhile I can still answer from approved Acton knowledge when it is available."
          : [
              INSUFFICIENT_KNOWLEDGE_ANSWER,
              "",
              "I also can’t call OpenAI right now because OPENAI_API_KEY is not configured.",
            ].join("\n");
      const message = await appendAssistantMessage({
        conversationId: conversation.id,
        content: answer,
        insufficientKnowledge: true,
        confidence: "low",
        modelProvider: null,
        modelName: null,
        errorCode: "BAXTER_OPENAI_KEY_MISSING",
        sources: [],
        sourceEntryIds: [],
      });
      return toPublicAnswer({
        conversationId: conversation.id,
        messageId: message.id,
        answer,
        sources: [],
        confidence: "low",
        insufficientKnowledge: true,
        answerMode: "mixed",
        errorCode: "BAXTER_OPENAI_KEY_MISSING",
      });
    }
  }

  try {
    const provider = getBaxterLlmProvider();
    const llm = await provider.generateAnswer({
      question,
      contextItems,
      userName: input.userName,
      channel: input.channel,
      questionClass,
      identityContext: buildBaxterIdentityContext(),
      history,
    });

    let sources = mapUsedSourceNumbers(llm.usedSourceNumbers, contextItems);
    // Never invent sources; only keep mapped ones.
    let answerMode: BaxterAnswerMode = llm.answerMode;
    let insufficientKnowledge = false;
    let answerText = llm.answer.trim();

    if (questionClass === "baxter_identity" && sources.length === 0) {
      answerMode = "identity";
      insufficientKnowledge = false;
      if (!answerText) answerText = answerFromBaxterIdentity(question);
    } else if (
      (questionClass === "acton_company_specific" || questionClass === "acton_process_specific") &&
      sources.length === 0
    ) {
      // Prefer answering with clearly labeled general guidance when the model produced one.
      insufficientKnowledge = !answerText;
      answerMode = answerText ? "mixed" : "mixed";
      if (!answerText) {
        answerText = [
          INSUFFICIENT_KNOWLEDGE_ANSWER,
          "",
          "If helpful, ask me as a general concept question and I can share labeled general guidance.",
        ].join("\n");
      } else if (
        !/general knowledge|general guidance|not an approved acton|couldn.?t find an approved|approved acton source/i.test(
          answerText,
        )
      ) {
        answerText = `${answerText}\n\n${GENERAL_KNOWLEDGE_NOTE}`;
        answerMode = "mixed";
      }
      sources = [];
    } else if (sources.length > 0) {
      answerMode = answerMode === "general" ? "grounded" : answerMode;
      if (answerMode === "identity") answerMode = "grounded";
      insufficientKnowledge = false;
    } else {
      // General / conversational with no sources — answer normally.
      insufficientKnowledge = false;
      if (answerMode === "grounded") answerMode = "general";
      if (
        answerMode === "general" &&
        answerText &&
        !/general knowledge|approved Acton source/i.test(answerText)
      ) {
        // Soft label only when it reads like company advice without sources
        if (/\b(acton|our policy|our process|we require)\b/i.test(answerText)) {
          answerText = `${answerText}\n\n${GENERAL_KNOWLEDGE_NOTE}`;
          answerMode = "mixed";
        }
      }
      sources = [];
    }

    if (!answerText) {
      answerText =
        questionClass === "baxter_identity"
          ? answerFromBaxterIdentity(question)
          : INSUFFICIENT_KNOWLEDGE_ANSWER;
    }

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
      answerMode,
    });
  } catch (error) {
    const errorCode =
      error instanceof BaxterConfigError || error instanceof BaxterProviderError
        ? error.code
        : error instanceof Error && "code" in error
          ? String((error as { code?: string }).code ?? "BAXTER_UNKNOWN_ERROR")
          : "BAXTER_UNKNOWN_ERROR";

    // Identity fallback if OpenAI is down
    if (questionClass === "baxter_identity") {
      const answer = answerFromBaxterIdentity(question);
      const message = await appendAssistantMessage({
        conversationId: conversation.id,
        content: answer,
        insufficientKnowledge: false,
        confidence: "medium",
        modelProvider: "identity",
        modelName: "built-in-fallback",
        errorCode,
        sources: [],
        sourceEntryIds: [],
      });
      logBaxterDiagnostic("answerBaxterQuestion", {
        code: errorCode,
        conversationId: conversation.id,
        userId: input.userId,
        safeMessage: error instanceof Error ? error.message : "identity fallback",
      });
      return toPublicAnswer({
        conversationId: conversation.id,
        messageId: message.id,
        answer,
        sources: [],
        confidence: "medium",
        insufficientKnowledge: false,
        answerMode: "identity",
        errorCode,
      });
    }

    const employeeMessage =
      contextItems.length === 0
        ? [
            INSUFFICIENT_KNOWLEDGE_ANSWER,
            "",
            `I also hit a temporary AI service issue (${errorCode}). Please try again shortly.`,
          ].join("\n")
        : employeeFacingErrorMessage(errorCode);

    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: employeeMessage,
      insufficientKnowledge: contextItems.length === 0,
      confidence: "low",
      modelProvider: null,
      modelName: null,
      errorCode,
      sources: [],
      sourceEntryIds: [],
    });

    logBaxterDiagnostic("answerBaxterQuestion", {
      code: errorCode,
      route: "answerBaxterQuestion",
      userId: input.userId,
      conversationId: conversation.id,
      safeMessage: error instanceof Error ? error.message : "unknown",
    });

    // Prefer a stored assistant reply over throwing when no KB context was available.
    if (contextItems.length === 0) {
      return toPublicAnswer({
        conversationId: conversation.id,
        messageId: message.id,
        answer: employeeMessage,
        sources: [],
        confidence: "low",
        insufficientKnowledge: true,
        answerMode: "mixed",
        errorCode,
      });
    }

    if (error instanceof BaxterConfigError) {
      throw new BaxterConfigError(employeeFacingErrorMessage(errorCode), errorCode);
    }

    throw error;
  }
}

function needsOpenAiForIdentityFollowUp(question: string): boolean {
  // Use OpenAI when the question asks for nuanced comparison or drafting around identity.
  return /\b(compare|draft|write|summarize|in detail|phase 1|not supposed)\b/i.test(question);
}
