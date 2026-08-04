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
  dedupeSourceReferences,
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
import { handleGhlPendingConfirmation, handleGhlWriteProposal } from "./ghl-runtime";
import { shouldSkipSlackForGhlContactField } from "./ghl-intent";
import { createServiceClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/research/db-types";
import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import { ENTITY_CLARIFICATION_PROMPT, needsEntityClarification } from "./conversation-context";
import {
  answerCapabilityHelp,
  answerResourceAccessCheck,
  buildCapabilityPromptBlock,
  shouldPreferKnowledgeForConcept,
} from "@/lib/baxter/capability-help";
import {
  detectConceptQuestion,
  resolveConceptFollowUp,
  resolveRetryQuestion,
} from "@/lib/baxter/concept-vocabulary";
import { pemHelpDefinitionAnswer } from "@/lib/baxter-data/pem-neats/intent";
import { runEvidenceRegistry } from "@/lib/baxter-ai/evidence-registry";
import {
  classifyQuestionSemantically,
  isSemanticRoutingConfident,
} from "@/lib/baxter-ai/semantic-question-classification";
import { questionHasSpecificNamedEntity } from "@/lib/baxter/capability-intent";
import { retrieveSlackForAnswer } from "@/lib/baxter-data/slack/orchestrate";
import { detectSlackSearchIntent, extractChannelMentions } from "@/lib/baxter-data/slack/intent";
import { detectSlackSearchRole } from "@/lib/baxter-data/slack/when";
import {
  isProjectInformationQuestion,
  isProjectStatusQuestion,
} from "@/lib/baxter-data/slack/project-status";
import { writeSlackConversationState } from "@/lib/baxter-data/slack/conversation-state";
import { readSlackConversationState } from "@/lib/baxter-data/slack/conversation-state";
import {
  nonSlackEvidenceSatisfiesQuestion,
  shouldForceSlackDespiteOtherEvidence,
} from "@/lib/baxter-data/slack/source-sufficiency";
import { formatSlackRetrievalStatusForModel } from "@/lib/baxter-data/slack/retrieval-status";
import {
  buildSourceAuthorityPromptBlock,
  classifySourceAuthority,
} from "@/lib/baxter-ai/source-authority";
import type { BaxterSourceReference } from "./types";
import { getPublicAppBaseUrl } from "@/lib/slack/config";

function withAbsoluteAppLinks(answer: string, links: Array<{ href: string }>): string {
  const baseUrl = getPublicAppBaseUrl().replace(/\/$/, "");
  let out = answer;
  const paths = [...links.map((l) => l.href).filter((h) => h.startsWith("/"))].sort(
    (a, b) => b.length - a.length,
  );
  for (const path of paths) {
    const absolute = `${baseUrl}${path}`;
    // Replace only relative occurrences of this path.
    let next = "";
    let i = 0;
    while (i < out.length) {
      const idx = out.indexOf(path, i);
      if (idx < 0) {
        next += out.slice(i);
        break;
      }
      const before = out.slice(Math.max(0, idx - baseUrl.length), idx);
      if (before.endsWith(baseUrl) || /https?:\/\/\S*$/i.test(out.slice(0, idx))) {
        next += out.slice(i, idx + path.length);
      } else {
        next += out.slice(i, idx) + absolute;
      }
      i = idx + path.length;
    }
    out = next;
  }
  return out.replaceAll(`${baseUrl}${baseUrl}`, baseUrl);
}

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

  // Resolve "try again" / "how do I make one?" against prior turns before routing.
  const historyForRouting = await getRecentConversationHistory(conversation.id, {
    limit: 12,
    excludeLastUser: true,
  });
  const retryResolved = resolveRetryQuestion(question, [
    ...historyForRouting,
    { role: "user", content: question },
  ]);
  const followUpResolved = resolveConceptFollowUp(retryResolved ?? question, historyForRouting);
  const routingQuestion = followUpResolved ?? retryResolved ?? question;
  const questionClass = classifyBaxterQuestion(routingQuestion);
  const conceptIntent = detectConceptQuestion(routingQuestion);

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

  const preferKnowledgeForConcept = shouldPreferKnowledgeForConcept(routingQuestion);

  // Identity / capability FAQs: answer before semantic routing + Slack (fast path).
  // Prevents "Who is Baxter?" from paying for routing classification or resource checks.
  if (questionClass === "baxter_identity" && !preferKnowledgeForConcept) {
    const identityHelp = answerCapabilityHelp({
      question: routingQuestion,
      role: profile?.role ?? null,
      profile,
    });
    if (identityHelp) {
      const baseUrl = getPublicAppBaseUrl().replace(/\/$/, "");
      const sources: BaxterSourceReference[] = identityHelp.links.map((link, index) => {
        const href = link.href.startsWith("http") ? link.href : `${baseUrl}${link.href}`;
        return {
          title: link.label,
          sourceName: "Baxter",
          category: "Baxter capability",
          sourceUrl: href,
          citationLabel: link.label,
          sourceKind: "capability" as const,
          openLabel: link.label,
          lastUpdated: null,
          relevanceScore: 100,
          availability: "available" as const,
          knowledgeEntryId: `capability-${index}-${link.href}`,
        };
      });
      const helpAnswer = withAbsoluteAppLinks(identityHelp.answer, identityHelp.links);
      const message = await appendAssistantMessage({
        conversationId: conversation.id,
        content: helpAnswer,
        insufficientKnowledge: false,
        confidence: "high",
        modelProvider: "capability-registry",
        modelName: "identity-fast-path",
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
        answer: helpAnswer,
        sources,
        confidence: "high",
        insufficientKnowledge: false,
        answerMode: "identity",
      });
    }
  }

  // Deterministic capability / how-to answers.
  // Definition questions prefer approved Knowledge first (not a canned short-circuit).
  // Specific resource access (e.g. a Google Doc URL) is verified live — never the full overview.
  // Semantic routing runs once here (before capability help + registry) so capability/procedural
  // questions never reach GHL entity matching.
  const semantic = await classifyQuestionSemantically({
    question: routingQuestion,
    history: historyForRouting,
  });
  if (semantic.source === "fallback_unavailable") {
    logBaxterDiagnostic("semanticClassification", {
      code: "SEMANTIC_CLASSIFY_FALLBACK",
      route: "answerBaxterQuestion",
      conversationId: conversation.id,
      safeMessage: semantic.error ?? "fallback to regex entity extraction",
    });
  } else if (semantic.source === "llm") {
    logBaxterDiagnostic("semanticClassification", {
      code: "SEMANTIC_CLASSIFY_OK",
      route: "answerBaxterQuestion",
      conversationId: conversation.id,
      safeMessage: JSON.stringify({
        questionType: semantic.questionType,
        confidence: semantic.confidence,
        latencyMs: semantic.latencyMs,
        model: semantic.model,
      }),
    });
  }

  const resourceAccess = await answerResourceAccessCheck({
    question: routingQuestion,
    role: profile?.role ?? null,
  }).catch(() => null);
  if (resourceAccess) {
    const baseUrl = getPublicAppBaseUrl().replace(/\/$/, "");
    const sources: BaxterSourceReference[] = resourceAccess.links.map((link, index) => {
      const href = link.href.startsWith("http") ? link.href : `${baseUrl}${link.href}`;
      return {
        title: link.label,
        sourceName: "Baxter",
        category: "Baxter capability",
        sourceUrl: href,
        citationLabel: link.label,
        sourceKind: "capability" as const,
        openLabel: link.label,
        lastUpdated: null,
        relevanceScore: 100,
        availability: "available" as const,
        knowledgeEntryId: `capability-access-${index}-${link.href}`,
      };
    });
    const helpAnswer = withAbsoluteAppLinks(resourceAccess.answer, resourceAccess.links);
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: helpAnswer,
      insufficientKnowledge: false,
      confidence: "high",
      modelProvider: "capability-registry",
      modelName: "resource-access",
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
      answer: helpAnswer,
      sources,
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "identity",
    });
  }

  const forceCapabilityHowto =
    isSemanticRoutingConfident(semantic) &&
    semantic.questionType === "capability_howto" &&
    // Never force capability help over a live data / Slack / named-entity ask.
    !questionHasSpecificNamedEntity(routingQuestion) &&
    extractChannelMentions(routingQuestion).length === 0 &&
    !isProjectInformationQuestion(routingQuestion) &&
    !isProjectStatusQuestion(routingQuestion) &&
    detectSlackSearchRole({ question: routingQuestion }) === "skip";

  // Slack Search must not be preempted by capability short-circuit.
  const slackIntentEarly = detectSlackSearchIntent(routingQuestion);
  const slackWouldRunEarly =
    detectSlackSearchRole({ question: routingQuestion }) !== "skip" ||
    extractChannelMentions(routingQuestion).length > 0 ||
    slackIntentEarly === "project_status" ||
    slackIntentEarly === "channel_search" ||
    slackIntentEarly === "latest_update" ||
    slackIntentEarly === "latest_message";
  const semanticWantsEntity =
    isSemanticRoutingConfident(semantic) && semantic.questionType === "entity_lookup";

  const capabilityHelp =
    slackWouldRunEarly || semanticWantsEntity
      ? null
      : answerCapabilityHelp({
          question: routingQuestion,
          role: profile?.role ?? null,
          profile,
          forceCapabilityHowto,
        });
  if (capabilityHelp && !preferKnowledgeForConcept) {
    const baseUrl = getPublicAppBaseUrl().replace(/\/$/, "");
    const sources: BaxterSourceReference[] = capabilityHelp.links.map((link, index) => {
      const href = link.href.startsWith("http") ? link.href : `${baseUrl}${link.href}`;
      return {
        title: link.label,
        sourceName: "Baxter",
        category: "Baxter capability",
        sourceUrl: href,
        citationLabel: link.label,
        sourceKind: "capability" as const,
        openLabel: link.label,
        lastUpdated: null,
        relevanceScore: 100,
        availability: "available" as const,
        knowledgeEntryId: `capability-${index}-${link.href}`,
      };
    });
    const helpAnswer = withAbsoluteAppLinks(capabilityHelp.answer, capabilityHelp.links);
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: helpAnswer,
      insufficientKnowledge: false,
      confidence: "high",
      modelProvider: "capability-registry",
      modelName: forceCapabilityHowto ? "semantic-howto" : "help",
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
      answer: helpAnswer,
      sources,
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "identity",
    });
  }

  // Fast path: identity questions with no need for OpenAI when KB is empty.
  const historyEarly = historyForRouting;
  const evidence = await retrieveBaxterEvidence(routingQuestion, historyEarly);
  let contextItems = evidence.contextItems;

  // Confidence-ordered evidence registry (GHL / PEM / Rulebook). Soft misses do not
  // hard-stop; KB remains the post-registry fallback below.
  // Semantic already computed above — pass through (do not classify twice).
  const registry = await runEvidenceRegistry({
    question: routingQuestion,
    history: historyEarly,
    conversationMetadata: conversation.metadata ?? {},
    role: profile?.role ?? null,
    channel: input.channel,
    ghlConfigured: isGhlConfigured(),
    semantic,
    userId: input.userId,
    externalUserId: input.externalUserId ?? null,
    slackTeamId: input.slackTeamId ?? null,
  });

  if (registry.conversationMetadata) {
    conversation.metadata = registry.conversationMetadata;
    await updateBaxterConversationMetadata(conversation.id, registry.conversationMetadata).catch(
      () => undefined,
    );
  }

  if (registry.diagnostics.tried.length > 0 || registry.diagnostics.semantic) {
    logBaxterDiagnostic("evidenceRegistry", {
      code: "EVIDENCE_REGISTRY",
      route: "answerBaxterQuestion",
      conversationId: conversation.id,
      safeMessage: JSON.stringify({
        preferredSource: registry.diagnostics.preferredSource,
        extractedName: registry.diagnostics.entity.extractedName,
        ambiguous: registry.diagnostics.entity.ambiguousAcrossTypes,
        skipEntityLookup: registry.diagnostics.entity.skipEntityLookup,
        tried: registry.diagnostics.tried,
        semantic: registry.diagnostics.semantic,
      }),
    });
  }

  if (registry.earlyAnswer) {
    const liveProjectLookup =
      isProjectInformationQuestion(routingQuestion) ||
      isProjectStatusQuestion(routingQuestion) ||
      extractChannelMentions(routingQuestion).length > 0;
    // Project / #channel asks: do not short-circuit before Slack Search runs.
    // Stash the registry answer as a fallback after Slack is attempted.
    if (!liveProjectLookup) {
      const early = registry.earlyAnswer;
      const sources = early.sources.map((item) => contextItemToSourceReference(item));
      const message = await appendAssistantMessage({
        conversationId: conversation.id,
        content: early.answer,
        insufficientKnowledge: early.insufficientKnowledge,
        confidence: early.confidence,
        modelProvider: early.modelProvider,
        modelName: early.modelName,
        sources,
        sourceEntryIds: sources.map((s, index) => ({
          id: s.knowledgeEntryId || early.sources[index]?.id || `registry-${index}`,
          relevanceScore: 100,
          order: index + 1,
        })),
      });
      return toPublicAnswer({
        conversationId: conversation.id,
        messageId: message.id,
        answer: early.answer,
        sources,
        confidence: early.confidence,
        insufficientKnowledge: early.insufficientKnowledge,
        answerMode: early.answerMode,
      });
    }
  }

  const deferredRegistryEarly = registry.earlyAnswer;

  if (registry.contextItems.length > 0) {
    const renumbered = registry.contextItems.map((item, index) => ({
      ...item,
      number: index + 1,
    }));
    const offset = renumbered.length;
    const kbItems = contextItems.map((item, index) => ({
      ...item,
      number: offset + index + 1,
    }));
    contextItems = [...renumbered, ...kbItems].slice(0, 8);
  }

  // Concept definitions: if Knowledge missed, fall back to capability/PEM governing copy.
  if (preferKnowledgeForConcept) {
    const conceptTerms = conceptIntent.knowledgeSearchTerms.map((t) => t.toLowerCase());
    const strongKb = contextItems.some((item) => {
      const title = (item.title ?? "").toLowerCase();
      const score = item.relevanceScore ?? 0;
      return (
        score >= 40 &&
        (conceptTerms.some((t) => title === t.toLowerCase() || title.includes(t.toLowerCase())) ||
          /pem\s*neat/i.test(title))
      );
    });
    if (!strongKb) {
      const fallback =
        capabilityHelp ??
        (pemHelpDefinitionAnswer(routingQuestion)
          ? {
              answer: pemHelpDefinitionAnswer(routingQuestion)!,
              links: [
                { label: "Open PEM NEATs", href: "/pem-neats" },
                { label: "Create PEM NEAT", href: "/pem-neats/new" },
              ],
            }
          : null);
      if (fallback) {
        const baseUrl = getPublicAppBaseUrl().replace(/\/$/, "");
        const helpAnswer = withAbsoluteAppLinks(fallback.answer, fallback.links);
        const sources: BaxterSourceReference[] = fallback.links.map((link, index) => {
          const href = link.href.startsWith("http") ? link.href : `${baseUrl}${link.href}`;
          return {
            title: link.label,
            sourceName: "Baxter",
            category: "Baxter capability",
            sourceUrl: href,
            citationLabel: link.label,
            sourceKind: "capability" as const,
            openLabel: link.label,
            lastUpdated: null,
            relevanceScore: 90,
            availability: "available" as const,
            knowledgeEntryId: `capability-fallback-${index}-${link.href}`,
          };
        });
        // Keep any weak KB hits as additional context sources when present
        const kbSources = contextItems
          .slice(0, 2)
          .map((item) => contextItemToSourceReference(item));
        const allSources = [...kbSources, ...sources];
        const message = await appendAssistantMessage({
          conversationId: conversation.id,
          content: helpAnswer,
          insufficientKnowledge: false,
          confidence: "high",
          modelProvider: "capability-registry",
          modelName: "concept-fallback",
          sources: allSources,
          sourceEntryIds: [],
        });
        return toPublicAnswer({
          conversationId: conversation.id,
          messageId: message.id,
          answer: helpAnswer,
          sources: allSources,
          confidence: "high",
          insufficientKnowledge: false,
          answerMode: kbSources.length ? "grounded" : "identity",
        });
      }
    }
  }

  // Live Slack conversational evidence (authorized before model; not Knowledge).
  // Presence of Knowledge ≠ answering the requested dimension (e.g. WHEN / what did X say).
  const priorSlack = readSlackConversationState(conversation.metadata ?? {});
  const knowledgeExcerpts = contextItems.map(
    (item) => `${item.title ?? ""}\n${item.summary ?? ""}\n${item.contentExcerpt ?? ""}`,
  );
  const otherEvidenceSatisfies = nonSlackEvidenceSatisfiesQuestion(
    routingQuestion,
    knowledgeExcerpts,
  );
  // CRM contact-field asks (address/phone/email/…) must not fall through to Slack.
  const skipSlackForGhlContactField = shouldSkipSlackForGhlContactField(routingQuestion);
  const forceSlack =
    !skipSlackForGhlContactField &&
    (Boolean(input.slackRecallForced) || shouldForceSlackDespiteOtherEvidence(routingQuestion));
  const hasOtherStrongEvidence =
    (otherEvidenceSatisfies || skipSlackForGhlContactField) &&
    !forceSlack &&
    contextItems.length > 0;
  const slackRoleEarly = skipSlackForGhlContactField
    ? "skip"
    : input.slackRecallForced
      ? "primary"
      : detectSlackSearchRole({
          question: routingQuestion,
          hasOtherStrongEvidence,
          followUpSlackContext: Boolean(priorSlack?.refs.length || priorSlack?.topic),
        });
  // Slack-origin requests can use bot public-channel history without a separate web OAuth link.
  const allowPublicOnlyFallback =
    input.channel === "slack" || Boolean(input.externalUserId) || forceSlack;

  const slackRuntime = skipSlackForGhlContactField
    ? ({
        items: [],
        selected: [],
        plan: null,
        nextConversationState: null,
        authNote: null,
        noResultsNote: null,
        incompleteNote: null,
        retrievalStatus: {
          status: "skipped",
          intent: null,
          channel: null,
          person: null,
          resultCount: 0,
          credentialPath: null,
          retrievalMethod: null,
          employeeNote: null,
        },
        retrievalStatusPrompt: "",
        diagnostics: {
          role: "skip",
          ran: false,
          intent: null,
          resultCount: 0,
          selectedCount: 0,
          searchCount: 0,
          threadsExpanded: 0,
          incomplete: false,
          incompleteCode: null,
          authorization: "none",
          rateLimited: false,
          durationMs: 0,
          followUpReset: false,
          retrievalStatus: "skipped",
          retrievalMethod: null,
          notes: ["skipped_for_ghl_contact_field"],
        },
      } satisfies Awaited<ReturnType<typeof retrieveSlackForAnswer>>)
    : await retrieveSlackForAnswer({
        question: routingQuestion,
        requester: {
          baxterUserId: input.userId,
          slackUserId: input.externalUserId,
          slackTeamId: input.slackTeamId ?? null,
          actionToken: input.slackActionToken ?? null,
          allowPublicOnlyFallback,
        },
        conversationMetadata: conversation.metadata ?? {},
        hasOtherStrongEvidence,
        roleOverride:
          forceSlack && slackRoleEarly === "skip"
            ? "primary"
            : !otherEvidenceSatisfies && slackRoleEarly === "fallback"
              ? "primary"
              : slackRoleEarly === "skip"
                ? "skip"
                : undefined,
      }).catch((error) => {
        logBaxterDiagnostic("slackEvidence", {
          code: "SLACK_RETRIEVAL_FAILED",
          route: "answerBaxterQuestion",
          conversationId: conversation.id,
          safeMessage:
            error instanceof Error ? error.message.slice(0, 160) : "Slack retrieval failed",
        });
        const retrievalStatus = {
          status: "error" as const,
          intent: null,
          channel: null,
          person: null,
          resultCount: 0,
          credentialPath: null,
          retrievalMethod: null,
          employeeNote:
            "Slack search is temporarily unavailable, so I couldn't check Slack for this question.",
        };
        return {
          items: [],
          selected: [],
          plan: null,
          nextConversationState: null,
          authNote: null,
          noResultsNote: null,
          incompleteNote: retrievalStatus.employeeNote,
          retrievalStatus,
          retrievalStatusPrompt: formatSlackRetrievalStatusForModel(retrievalStatus),
          diagnostics: {
            role: slackRoleEarly === "skip" && forceSlack ? "primary" : slackRoleEarly,
            ran: true,
            intent: null,
            resultCount: 0,
            selectedCount: 0,
            searchCount: 0,
            threadsExpanded: 0,
            incomplete: true,
            incompleteCode: "SLACK_RETRIEVAL_FAILED",
            authorization: "unavailable" as const,
            rateLimited: false,
            durationMs: 0,
            followUpReset: false,
            retrievalStatus: "error" as const,
            retrievalMethod: null,
            notes: ["retrieveSlackForAnswer threw"],
          },
        };
      });

  // Persist follow-up state, including explicit clears after topic reset.
  if (
    slackRuntime &&
    (slackRuntime.nextConversationState || slackRuntime.diagnostics.followUpReset)
  ) {
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
        threadsExpanded: slackRuntime.diagnostics.threadsExpanded,
        incomplete: slackRuntime.diagnostics.incomplete,
        incompleteCode: slackRuntime.diagnostics.incompleteCode,
        authorization: slackRuntime.diagnostics.authorization,
        rateLimited: slackRuntime.diagnostics.rateLimited,
        durationMs: slackRuntime.diagnostics.durationMs,
        followUpReset: slackRuntime.diagnostics.followUpReset,
        retrievalStatus: slackRuntime.diagnostics.retrievalStatus,
        retrievalMethod: slackRuntime.diagnostics.retrievalMethod,
        otherEvidenceSatisfies,
        forceSlack,
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
    // After Slack was attempted: if registry had a deferred early answer (PEM/GHL),
    // include both so the employee sees what was checked.
    if (deferredRegistryEarly && parts.length) {
      const combined = [...parts, deferredRegistryEarly.answer].join("\n\n");
      const sources = deferredRegistryEarly.sources.map((item) =>
        contextItemToSourceReference(item),
      );
      const message = await appendAssistantMessage({
        conversationId: conversation.id,
        content: combined,
        insufficientKnowledge: deferredRegistryEarly.insufficientKnowledge,
        confidence: deferredRegistryEarly.confidence,
        modelProvider: deferredRegistryEarly.modelProvider,
        modelName: `${deferredRegistryEarly.modelName}+slack-checked`,
        sources,
        sourceEntryIds: sources.map((s, index) => ({
          id: s.knowledgeEntryId || deferredRegistryEarly.sources[index]?.id || `registry-${index}`,
          relevanceScore: 100,
          order: index + 1,
        })),
      });
      return toPublicAnswer({
        conversationId: conversation.id,
        messageId: message.id,
        answer: combined,
        sources,
        confidence: deferredRegistryEarly.confidence,
        insufficientKnowledge: deferredRegistryEarly.insufficientKnowledge,
        answerMode: deferredRegistryEarly.answerMode,
      });
    }
    // If other sources exist, continue to LLM with a Slack note instead of short-circuiting.
    if (contextItems.length === 0 && parts.length) {
      const answer = parts.join("\n\n");
      const isAuth = Boolean(slackRuntime.authNote);
      const message = await appendAssistantMessage({
        conversationId: conversation.id,
        content: answer,
        insufficientKnowledge: !isAuth,
        confidence: "medium",
        modelProvider: "slack-search",
        modelName: isAuth ? "auth-required" : "no-results",
        sources: [],
        sourceEntryIds: [],
      });
      return toPublicAnswer({
        conversationId: conversation.id,
        messageId: message.id,
        answer,
        sources: [],
        confidence: "medium",
        insufficientKnowledge: !isAuth,
        // Never label a Slack recall miss as General knowledge.
        answerMode: "clarification",
      });
    }
  }

  // Project-info path: Slack ran (or was primary) with nothing selected — use deferred PEM/GHL.
  if (
    deferredRegistryEarly &&
    (!slackRuntime || slackRuntime.selected.length === 0) &&
    (isProjectInformationQuestion(routingQuestion) ||
      isProjectStatusQuestion(routingQuestion) ||
      extractChannelMentions(routingQuestion).length > 0)
  ) {
    const early = deferredRegistryEarly;
    const slackNote =
      slackRuntime?.noResultsNote ||
      slackRuntime?.authNote ||
      slackRuntime?.incompleteNote ||
      (slackRuntime?.diagnostics.ran
        ? "I checked Slack for a matching project channel/update first."
        : null);
    const answer = slackNote ? `${slackNote}\n\n${early.answer}` : early.answer;
    const sources = early.sources.map((item) => contextItemToSourceReference(item));
    const message = await appendAssistantMessage({
      conversationId: conversation.id,
      content: answer,
      insufficientKnowledge: early.insufficientKnowledge,
      confidence: early.confidence,
      modelProvider: early.modelProvider,
      modelName: slackRuntime?.diagnostics.ran
        ? `${early.modelName}+slack-checked`
        : early.modelName,
      sources,
      sourceEntryIds: sources.map((s, index) => ({
        id: s.knowledgeEntryId || early.sources[index]?.id || `registry-${index}`,
        relevanceScore: 100,
        order: index + 1,
      })),
    });
    return toPublicAnswer({
      conversationId: conversation.id,
      messageId: message.id,
      answer,
      sources,
      confidence: early.confidence,
      insufficientKnowledge: early.insufficientKnowledge,
      answerMode: early.answerMode,
    });
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
      ? draftDirectStructuredAnswer(routingQuestion, evidence.structured)
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
    const answer = await answerFromBaxterIdentity(question);
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
    const authority = classifySourceAuthority(routingQuestion);
    const slackStatusBlock =
      slackRuntime?.retrievalStatusPrompt ??
      (slackRuntime
        ? [
            slackRuntime.authNote,
            slackRuntime.incompleteNote,
            slackRuntime.noResultsNote && slackRuntime.selected.length === 0
              ? slackRuntime.noResultsNote
              : null,
          ]
            .filter(Boolean)
            .join("\n")
        : null);
    const identityContext =
      questionClass === "baxter_identity"
        ? [
            buildBaxterIdentityContext(),
            "",
            buildCapabilityPromptBlock(profile?.role ?? null),
            "",
            buildSourceAuthorityPromptBlock(authority),
            slackStatusBlock ? `\n${slackStatusBlock}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        : [
            buildBaxterIdentityContext(),
            "",
            buildSourceAuthorityPromptBlock(authority),
            slackStatusBlock ? `\n${slackStatusBlock}` : null,
          ]
            .filter(Boolean)
            .join("\n");
    const llm = await provider.generateAnswer({
      question: routingQuestion,
      contextItems,
      userName: input.userName,
      channel: input.channel,
      questionClass,
      identityContext,
      history,
    });

    let sources = dedupeSourceReferences(mapUsedSourceNumbers(llm.usedSourceNumbers, contextItems));
    // Never invent sources; only keep mapped ones.
    let answerMode: BaxterAnswerMode = llm.answerMode;
    let insufficientKnowledge = false;
    let answerText = llm.answer.trim();

    if (questionClass === "baxter_identity" && sources.length === 0) {
      answerMode = "identity";
      insufficientKnowledge = false;
      if (!answerText) answerText = await answerFromBaxterIdentity(question);
    } else if (
      forceSlack &&
      slackRuntime?.diagnostics.role === "primary" &&
      sources.length === 0 &&
      !slackRuntime.selected.length
    ) {
      // Forced /recall with no Slack cites — never fall through to General knowledge.
      answerMode = "clarification";
      insufficientKnowledge = true;
      if (slackRuntime.noResultsNote || slackRuntime.authNote || slackRuntime.incompleteNote) {
        answerText = [
          slackRuntime.authNote,
          slackRuntime.noResultsNote,
          slackRuntime.incompleteNote,
        ]
          .filter(Boolean)
          .join("\n\n");
      }
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
          ? await answerFromBaxterIdentity(question)
          : INSUFFICIENT_KNOWLEDGE_ANSWER;
    }

    // Relational baxter_message_sources expects Knowledge UUIDs — Slack refs live in metadata.sources only.
    const sourceEntryIds = sources
      .map((source, index) => {
        const item = contextItems.find((ctx) => ctx.citationLabel === source.citationLabel);
        return {
          id: item?.id ?? source.knowledgeEntryId ?? "",
          relevanceScore: item?.relevanceScore ?? null,
          order: index + 1,
          sourceKind: source.sourceKind,
        };
      })
      .filter(
        (row) =>
          row.sourceKind !== "slack" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id),
      )
      .map(({ id, relevanceScore, order }) => ({ id, relevanceScore, order }));

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
      const answer = await answerFromBaxterIdentity(question);
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
