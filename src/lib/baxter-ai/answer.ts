import "server-only";

import {
  appendAssistantMessage,
  appendUserMessage,
  getOrCreateConversation,
  getRecentConversationHistory,
  resetBaxterConversation,
  toPublicAnswer,
  updateBaxterConversationMetadata,
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
import {
  handleGhlPendingConfirmation,
  handleGhlWriteProposal,
  retrieveGhlLiveEvidence,
} from "./ghl-runtime";
import { createServiceClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/research/db-types";
import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import { ENTITY_CLARIFICATION_PROMPT, needsEntityClarification } from "./conversation-context";
import { answerCapabilityHelp, buildCapabilityPromptBlock } from "@/lib/baxter/capability-help";
import { retrievePemEvidence } from "@/lib/baxter-data/pem-neats";
import { writePemConversationState } from "@/lib/baxter-data/pem-neats/conversation-state";
import { retrieveSlackForAnswer } from "@/lib/baxter-data/slack/orchestrate";
import { writeSlackConversationState } from "@/lib/baxter-data/slack/conversation-state";
import { detectSlackSearchRole } from "@/lib/baxter-data/slack/when";
import { readSlackConversationState } from "@/lib/baxter-data/slack/conversation-state";
import {
  buildSourceAuthorityPromptBlock,
  classifySourceAuthority,
} from "@/lib/baxter-ai/source-authority";
import type { BaxterSourceReference } from "./types";

/**
 * Shared Baxter answering entry point for web and Slack.
 */
export async function answerBaxterQuestion(input: BaxterQuestionInput): Promise<BaxterAnswer> {
  const question = input.question.trim();
  const command = parseChatCommand(question);

  if (command.type === "clear") {
    if (input.conversationId && isGhlConfigured()) {
      const { cancelPendingActionsForConversation } =
        await import("@/lib/connectors/ghl/actions/pending-actions");
      await cancelPendingActionsForConversation(input.conversationId).catch(() => 0);
    }
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

  // GoHighLevel pending confirm/cancel + write proposals (never mutate without confirmation).
  const profile = await loadProfileForGhl(input.userId);
  if (isGhlConfigured()) {
    const pendingHandled = await handleGhlPendingConfirmation({
      question,
      conversationId: conversation.id,
      userId: input.userId,
      externalUserId: input.externalUserId ?? null,
      profile,
    });
    if (pendingHandled.handled) {
      const sources = pendingHandled.sources.map((s) => ({
        title: s.title,
        sourceName: "GoHighLevel",
        category: "GoHighLevel",
        sourceUrl: s.sourceUrl ?? null,
        citationLabel: s.citationLabel,
        sourceKind: "manual" as const,
        openLabel: "GoHighLevel",
        lastUpdated: null,
        relevanceScore: 1,
        availability: "available" as const,
      }));
      const message = await appendAssistantMessage({
        conversationId: conversation.id,
        content: pendingHandled.answer,
        insufficientKnowledge: pendingHandled.insufficientKnowledge,
        confidence: pendingHandled.confidence,
        modelProvider: "ghl-actions",
        modelName: "pending-action",
        sources,
        sourceEntryIds: [],
      });
      return toPublicAnswer({
        conversationId: conversation.id,
        messageId: message.id,
        answer: pendingHandled.answer,
        sources,
        confidence: pendingHandled.confidence,
        insufficientKnowledge: pendingHandled.insufficientKnowledge,
        answerMode: pendingHandled.answerMode,
      });
    }

    const writeHandled = await handleGhlWriteProposal({
      question,
      conversationId: conversation.id,
      userId: input.userId,
      externalUserId: input.externalUserId ?? null,
      channel: input.channel,
      profile,
    });
    if (writeHandled.handled) {
      const sources = writeHandled.sources.map((s) => ({
        title: s.title,
        sourceName: "GoHighLevel",
        category: "GoHighLevel",
        sourceUrl: s.sourceUrl ?? null,
        citationLabel: s.citationLabel,
        sourceKind: "manual" as const,
        openLabel: "GoHighLevel",
        lastUpdated: null,
        relevanceScore: 1,
        availability: "available" as const,
      }));
      const message = await appendAssistantMessage({
        conversationId: conversation.id,
        content: writeHandled.answer,
        insufficientKnowledge: writeHandled.insufficientKnowledge,
        confidence: writeHandled.confidence,
        modelProvider: "ghl-actions",
        modelName: "write-proposal",
        sources,
        sourceEntryIds: [],
      });
      return toPublicAnswer({
        conversationId: conversation.id,
        messageId: message.id,
        answer: writeHandled.answer,
        sources,
        confidence: writeHandled.confidence,
        insufficientKnowledge: writeHandled.insufficientKnowledge,
        answerMode: writeHandled.answerMode,
      });
    }
  }

  // Deterministic capability / how-to / PEM definition answers (no vector search).
  const capabilityHelp = answerCapabilityHelp({
    question,
    role: profile?.role ?? null,
    profile,
  });
  if (capabilityHelp) {
    const sources: BaxterSourceReference[] = capabilityHelp.links.map((link, index) => ({
      title: link.label,
      sourceName: "Baxter",
      category: "Baxter capability",
      sourceUrl: link.href,
      citationLabel: link.label,
      sourceKind: "capability" as const,
      openLabel: link.label,
      lastUpdated: null,
      relevanceScore: 100,
      availability: "available" as const,
      knowledgeEntryId: `capability-${index}-${link.href}`,
    }));
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: capabilityHelp.answer,
      insufficientKnowledge: false,
      confidence: "high",
      modelProvider: "capability-registry",
      modelName: "help",
      sources,
      sourceEntryIds: sources.map((s, index) => ({
        id: s.knowledgeEntryId!,
        relevanceScore: 100,
        order: index + 1,
      })),
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer: capabilityHelp.answer,
      sources,
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "identity",
    });
  }

  // Fast path: identity questions with no need for OpenAI when KB is empty.
  const historyEarly = await getRecentConversationHistory(conversation.id, {
    limit: 10,
    excludeLastUser: true,
  });
  const evidence = await retrieveBaxterEvidence(question, historyEarly);
  let contextItems = evidence.contextItems;

  // Merge live GoHighLevel operational evidence when the question is CRM-related.
  if (isGhlConfigured()) {
    const ghlEvidence = await retrieveGhlLiveEvidence(question).catch(() => null);
    if (ghlEvidence?.ambiguityWarning) {
      const message = await appendAssistantMessage({
        conversationId: conversation.id,
        content: ghlEvidence.ambiguityWarning,
        insufficientKnowledge: false,
        confidence: "medium",
        modelProvider: "ghl-resolve",
        modelName: "entity-resolution",
        sources: [],
        sourceEntryIds: [],
      });
      return toPublicAnswer({
        conversationId: conversation.id,
        messageId: message.id,
        answer: ghlEvidence.ambiguityWarning,
        sources: [],
        confidence: "medium",
        insufficientKnowledge: false,
        answerMode: "clarification",
      });
    }
    if (ghlEvidence?.items.length) {
      const renumbered = ghlEvidence.items.map((item, index) => ({
        ...item,
        number: index + 1,
      }));
      const kbOffset = renumbered.length;
      const kbItems = contextItems.map((item, index) => ({
        ...item,
        number: kbOffset + index + 1,
      }));
      contextItems = [...renumbered, ...kbItems].slice(0, 8);
    }
  }

  // Merge Process Rulebook evidence for responsibility/process questions.
  const { retrieveRulebookEvidence } = await import("@/lib/rulebook");
  const rulebookEvidence = await retrieveRulebookEvidence(question).catch(() => []);
  if (rulebookEvidence.length > 0) {
    const currentOffset = contextItems.length;
    const rulebookItems = rulebookEvidence.map((item, index) => ({
      ...item,
      number: currentOffset + index + 1,
    }));
    contextItems = [...contextItems, ...rulebookItems].slice(0, 8);
  }

  // Merge completed PEM NEAT structured evidence (first-class; not Knowledge Base text).
  const pemEvidence = await retrievePemEvidence({
    question,
    history: historyEarly,
    role: profile?.role ?? null,
    channel: input.channel,
    conversationMetadata: conversation.metadata ?? {},
  }).catch(() => ({
    items: [] as Awaited<ReturnType<typeof retrievePemEvidence>>["items"],
    clarification: null as string | null,
    staleWarning: null as string | null,
    deterministicAnswer: null as string | null,
    answerMode: "none" as const,
    diagnostics: {
      detectedProspect: null,
      candidateCount: 0,
      resolvedPemId: null,
      resolvedPemTitle: null,
      requestedFields: [],
      inheritedFromConversation: false,
      explicitOverride: false,
      answerMode: "none" as const,
    },
    nextConversationState: null,
  }));

  if (pemEvidence.nextConversationState) {
    const nextMeta = writePemConversationState(
      conversation.metadata ?? {},
      pemEvidence.nextConversationState,
    );
    conversation.metadata = nextMeta;
    await updateBaxterConversationMetadata(conversation.id, nextMeta).catch(() => undefined);
  }

  if (pemEvidence.diagnostics.answerMode !== "none") {
    logBaxterDiagnostic("pemEvidence", {
      code: "PEM_RESOLUTION",
      route: "answerBaxterQuestion",
      conversationId: conversation.id,
      safeMessage: JSON.stringify({
        detectedProspect: pemEvidence.diagnostics.detectedProspect,
        candidateCount: pemEvidence.diagnostics.candidateCount,
        resolvedPemId: pemEvidence.diagnostics.resolvedPemId,
        resolvedPemTitle: pemEvidence.diagnostics.resolvedPemTitle,
        requestedFields: pemEvidence.diagnostics.requestedFields,
        inheritedFromConversation: pemEvidence.diagnostics.inheritedFromConversation,
        explicitOverride: pemEvidence.diagnostics.explicitOverride,
        answerMode: pemEvidence.diagnostics.answerMode,
      }),
    });
  }

  if (pemEvidence.clarification) {
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: pemEvidence.clarification,
      insufficientKnowledge: false,
      confidence: "medium",
      modelProvider: "pem-neats",
      modelName: "entity-resolution",
      sources: [],
      sourceEntryIds: [],
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer: pemEvidence.clarification,
      sources: [],
      confidence: "medium",
      insufficientKnowledge: false,
      answerMode: "clarification",
    });
  }

  // Prefer deterministic structured PEM answers (no LLM field guessing).
  if (pemEvidence.deterministicAnswer && pemEvidence.items.length > 0) {
    const item = { ...pemEvidence.items[0]!, number: 1 };
    const sources = [contextItemToSourceReference(item)];
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: pemEvidence.deterministicAnswer,
      insufficientKnowledge: false,
      confidence: pemEvidence.answerMode === "not_determinable" ? "medium" : "high",
      modelProvider: "pem-neats",
      modelName: "deterministic-structured",
      sources,
      sourceEntryIds: [
        {
          id: item.id,
          relevanceScore: item.relevanceScore,
          order: 1,
        },
      ],
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer: pemEvidence.deterministicAnswer,
      sources,
      confidence: pemEvidence.answerMode === "not_determinable" ? "medium" : "high",
      insufficientKnowledge: false,
      answerMode: "grounded",
    });
  }

  if (pemEvidence.items.length > 0) {
    const renumbered = pemEvidence.items.map((item, index) => ({
      ...item,
      number: index + 1,
    }));
    const offset = renumbered.length;
    const rest = contextItems.map((item, index) => ({
      ...item,
      number: offset + index + 1,
    }));
    contextItems = [...renumbered, ...rest].slice(0, 8);
  }

  // Live Slack conversational evidence (authorized before model; not Knowledge).
  const priorSlack = readSlackConversationState(conversation.metadata ?? {});
  const slackRoleEarly = detectSlackSearchRole({
    question,
    hasOtherStrongEvidence: contextItems.length > 0,
    followUpSlackContext: Boolean(priorSlack?.refs.length || priorSlack?.topic),
  });

  const slackRuntime = await retrieveSlackForAnswer({
    question,
    requester: {
      baxterUserId: input.userId,
      slackUserId: input.externalUserId,
      slackTeamId: input.slackTeamId ?? null,
      actionToken: input.slackActionToken ?? null,
      allowPublicOnlyFallback: false,
    },
    conversationMetadata: conversation.metadata ?? {},
    hasOtherStrongEvidence: contextItems.length > 0,
    roleOverride: slackRoleEarly === "skip" ? "skip" : undefined,
  }).catch(() => null);

  if (slackRuntime?.nextConversationState) {
    const nextMeta = writeSlackConversationState(
      conversation.metadata ?? {},
      slackRuntime.nextConversationState,
    );
    conversation.metadata = nextMeta;
    await updateBaxterConversationMetadata(conversation.id, nextMeta).catch(() => undefined);
  }

  if (slackRuntime?.diagnostics.ran) {
    logBaxterDiagnostic("slackEvidence", {
      code: "SLACK_RETRIEVAL",
      route: "answerBaxterQuestion",
      conversationId: conversation.id,
      safeMessage: JSON.stringify({
        role: slackRuntime.diagnostics.role,
        intent: slackRuntime.diagnostics.intent,
        resultCount: slackRuntime.diagnostics.resultCount,
        selectedCount: slackRuntime.diagnostics.selectedCount,
        searchCount: slackRuntime.diagnostics.searchCount,
        incomplete: slackRuntime.diagnostics.incomplete,
        incompleteCode: slackRuntime.diagnostics.incompleteCode,
        authorization: slackRuntime.diagnostics.authorization,
        rateLimited: slackRuntime.diagnostics.rateLimited,
        durationMs: slackRuntime.diagnostics.durationMs,
      }),
    });
  }

  // Primary Slack question with auth/no-results — answer without inventing Slack content.
  if (
    slackRuntime &&
    slackRuntime.diagnostics.role === "primary" &&
    slackRuntime.selected.length === 0 &&
    (slackRuntime.authNote || slackRuntime.noResultsNote || slackRuntime.incompleteNote)
  ) {
    const parts = [
      slackRuntime.authNote,
      slackRuntime.noResultsNote,
      slackRuntime.incompleteNote,
    ].filter(Boolean);
    // If other sources exist, continue to LLM with a Slack note instead of short-circuiting.
    if (contextItems.length === 0 && parts.length) {
      const answer = parts.join("\n\n");
      const message = await appendAssistantMessage({
        conversationId: conversation.id,
        content: answer,
        insufficientKnowledge: !slackRuntime.authNote,
        confidence: "medium",
        modelProvider: "slack-search",
        modelName: "no-results",
        sources: [],
        sourceEntryIds: [],
      });
      return toPublicAnswer({
        conversationId: conversation.id,
        messageId: message.id,
        answer,
        sources: [],
        confidence: "medium",
        insufficientKnowledge: !slackRuntime.authNote,
        answerMode: slackRuntime.authNote ? "clarification" : "grounded",
      });
    }
  }

  if (slackRuntime?.items.length) {
    const slackItems = slackRuntime.items.map((item, index) => ({
      ...item,
      number: index + 1,
    }));
    const offset = slackItems.length;
    const rest = contextItems.map((item, index) => ({
      ...item,
      number: offset + index + 1,
    }));
    // Prefer Slack-first for primary conversational questions; otherwise append.
    contextItems =
      slackRuntime.diagnostics.role === "primary"
        ? [...slackItems, ...rest].slice(0, 12)
        : [...rest, ...slackItems].slice(0, 12);
  }

  // Deterministic structured answer when we have a direct field value
  // Skip when Slack conversational evidence is in play (current-vs-official conflicts need LLM).
  let direct = slackRuntime?.selected.length
    ? null
    : evidence.structured && !evidence.structured.ambiguous
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
    const authority = classifySourceAuthority(question);
    const slackNotes = [
      slackRuntime?.authNote,
      slackRuntime?.incompleteNote,
      slackRuntime?.noResultsNote && slackRuntime.selected.length === 0
        ? slackRuntime.noResultsNote
        : null,
    ]
      .filter(Boolean)
      .join("\n");
    const identityContext =
      questionClass === "baxter_identity"
        ? [
            buildBaxterIdentityContext(),
            "",
            buildCapabilityPromptBlock(profile?.role ?? null),
            "",
            buildSourceAuthorityPromptBlock(authority),
            slackNotes ? `\nSlack retrieval note:\n${slackNotes}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        : [
            buildBaxterIdentityContext(),
            "",
            buildSourceAuthorityPromptBlock(authority),
            slackNotes ? `\nSlack retrieval note:\n${slackNotes}` : null,
          ]
            .filter(Boolean)
            .join("\n");
    const llm = await provider.generateAnswer({
      question,
      contextItems,
      userName: input.userName,
      channel: input.channel,
      questionClass,
      identityContext,
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

async function loadProfileForGhl(userId: string | null): Promise<Profile | null> {
  if (!userId) return null;
  const env = getEnv();
  // Avoid hanging network profile lookups in memory/E2E/unit-test modes.
  if (
    env.E2E_TEST_AUTH_BYPASS ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("example.supabase.co") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
  ) {
    return {
      id: userId,
      full_name: "Test User",
      role: "user",
      department_id: null,
      department_name: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    return (data as Profile | null) ?? null;
  } catch {
    return null;
  }
}
