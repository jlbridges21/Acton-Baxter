/**
 * Evidence registry orchestrator — confidence-ordered, soft-miss aware.
 * Knowledge Base stays outside this registry as the post-registry fallback
 * (always-on lexical/semantic retrieval in context.ts); this module is the
 * single place that decides GHL / Rulebook / PEM order.
 *
 * Semantic question classification feeds resolveQuestionEntity as the primary
 * routing signal; regex extractors remain the fallback when classification
 * is unavailable or ambiguous. Arbitration logic itself is unchanged.
 */

import type { BaxterContextItem, BaxterHistoryMessage } from "@/lib/baxter-ai/types";
import { resolveQuestionEntity } from "./entity-resolution";
import {
  preferredSourceForFollowUp,
  mostRecentEntitySource,
  sourceKeyToPreferred,
  writeEntityArbitration,
} from "./conversation-arbitration";
import { ghlEvidenceSource } from "./sources/ghl";
import { rulebookEvidenceSource } from "./sources/rulebook";
import { pemEvidenceSource } from "./sources/pem";
import { pemAggregateEvidenceSource } from "./sources/pem-aggregate";
import { dossierEvidenceSource } from "./sources/dossier";
import { projectRegistryEvidenceSource } from "./sources/project-registry";
import {
  classifyQuestionSemantically,
  shouldOfferEntitySourceMenu,
  hasMultipleInformationNeeds,
  type ClassifyQuestionSemanticallyOptions,
  type SemanticQuestionClassification,
} from "@/lib/baxter-ai/semantic-question-classification";
import {
  decideEntitySourceClarifyingMenu,
  probeEntitySourceAvailability,
  type ProbeEntitySourcesDeps,
} from "./entity-source-menu";
import {
  readPendingClarification,
  writePendingClarification,
  clearPendingClarification,
  resolvePendingClarificationReply,
  buildInformationCategoryPending,
  type PendingClarificationCategory,
} from "./pending-clarification";
import { resolveMultiNeedQuestion, type MultiNeedResolvers } from "./multi-need";
import type {
  EvidenceSource,
  EvidenceSourceKey,
  EvidenceSourceResult,
  RegistryEarlyAnswer,
  RegistryRunResult,
} from "./types";
import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";

const DEFAULT_SOURCES: EvidenceSource[] = [
  pemAggregateEvidenceSource,
  projectRegistryEvidenceSource,
  ghlEvidenceSource,
  pemEvidenceSource,
  rulebookEvidenceSource,
  dossierEvidenceSource,
];

const SHORT_CIRCUIT_CONFIDENCE = 0.7;

function formatSourceAgnosticNotFound(tried: EvidenceSourceKey[], name: string | null): string {
  const labels: Record<EvidenceSourceKey, string> = {
    ghl: "GHL",
    pem_neat: "PEM",
    pem_aggregate: "PEM NEAT records",
    rulebook: "the Process Rulebook",
    customer_dossier: "the customer center",
    project_registry: "the Master Project Log",
  };
  const unique = [...new Set(tried)];
  const named = name?.trim() || "that";
  if (unique.length === 0) {
    return `I couldn’t find a record matching ${named}.`;
  }
  if (unique.length === 1) {
    return `I couldn’t find ${named} in ${labels[unique[0]!]}.`;
  }
  const parts = unique.map((k) => labels[k]);
  const last = parts.pop();
  return `I couldn’t find ${named} in ${parts.join(", ")} or ${last}.`;
}

function toEarlyFromResult(
  source: EvidenceSourceKey,
  result: EvidenceSourceResult,
  kind: "deterministic" | "clarification",
): RegistryEarlyAnswer {
  const answer =
    kind === "clarification"
      ? (result.clarification ?? result.deterministicAnswer ?? "")
      : (result.deterministicAnswer ?? result.clarification ?? "");
  return {
    kind,
    answer,
    sources: result.items,
    confidence: result.confidence >= 0.85 ? "high" : "medium",
    insufficientKnowledge: result.items.length === 0,
    answerMode:
      kind === "clarification" || result.items.length === 0 ? "clarification" : "grounded",
    modelProvider:
      source === "ghl"
        ? "ghl-resolve"
        : source === "pem_neat" || source === "pem_aggregate"
          ? "pem-neats"
          : source === "customer_dossier"
            ? "customer-dossier"
            : source === "project_registry"
              ? "project-registry"
              : "rulebook",
    modelName:
      kind === "clarification"
        ? "entity-resolution"
        : source === "ghl"
          ? "deterministic-crm"
          : source === "pem_aggregate"
            ? "deterministic-aggregate"
            : source === "pem_neat"
              ? "deterministic-structured"
              : source === "customer_dossier"
                ? "deterministic-dossier"
                : source === "project_registry"
                  ? "deterministic-project-log"
                  : "rulebook-evidence",
    winningSource: source,
  };
}

function semanticDiag(
  semantic: SemanticQuestionClassification | null,
  skippedEntityLookup: boolean,
): RegistryRunResult["diagnostics"]["semantic"] {
  if (!semantic) return undefined;
  return {
    questionType: semantic.questionType,
    confidence: semantic.confidence,
    source: semantic.source,
    latencyMs: semantic.latencyMs,
    model: semantic.model,
    error: semantic.error,
    skippedEntityLookup,
    lookupSpecificity: semantic.lookupSpecificity ?? null,
    informationNeedsCount: semantic.informationNeeds?.length ?? 0,
  };
}

export async function runEvidenceRegistry(input: {
  question: string;
  history?: BaxterHistoryMessage[];
  conversationMetadata?: Record<string, unknown> | null;
  role?: string | null;
  channel?: "web" | "slack";
  ghlConfigured: boolean;
  sources?: EvidenceSource[];
  /** Precomputed semantic classification (answer.ts runs once and passes through). */
  semantic?: SemanticQuestionClassification | null;
  /** Options when semantic is not precomputed — used for tests / standalone registry calls. */
  semanticOptions?: ClassifyQuestionSemanticallyOptions & { skipSemantic?: boolean };
  /** Baxter user id for per-user integrations (e.g. Slack Search on GHL project answers). */
  userId?: string | null;
  externalUserId?: string | null;
  slackTeamId?: string | null;
  /** Test inject for clarifying-menu existence probes. */
  menuProbeDeps?: ProbeEntitySourcesDeps;
  /** Optional Slack / Knowledge resolvers for multi-need compound questions. */
  multiNeedResolvers?: MultiNeedResolvers;
}): Promise<RegistryRunResult> {
  let metadata: Record<string, unknown> = { ...(input.conversationMetadata ?? {}) };
  const history = input.history ?? [];

  // Unified pending-clarification resolution (info menu + mirrored entity disambiguation).
  // Must run before entity extraction so replies inherit the clarified entity.
  let effectiveQuestion = input.question;
  const pending = readPendingClarification(metadata);
  const pendingResolution = resolvePendingClarificationReply({
    question: input.question,
    history,
    pending,
  });
  if (pendingResolution.action === "abandon") {
    metadata = clearPendingClarification(metadata);
    // Also clear PEM entity-disambiguation pending so both mechanisms stay in sync.
    if (pending?.kind === "entity_disambiguation") {
      const { readPemConversationState, writePemConversationState } =
        await import("@/lib/baxter-data/pem-neats/conversation-state");
      const pemState = readPemConversationState(metadata);
      if (pemState.pending) {
        metadata = writePemConversationState(metadata, {
          pending: null,
          active: pemState.active,
        });
      }
    }
  } else if (pendingResolution.action === "continue_with_entity") {
    effectiveQuestion = pendingResolution.enrichedQuestion;
    if (pendingResolution.clearPending) {
      metadata = clearPendingClarification(metadata);
    }
  }

  const preferredSource = preferredSourceForFollowUp({
    question: effectiveQuestion,
    history,
    conversationMetadata: metadata,
  });

  let semantic: SemanticQuestionClassification | null = input.semantic ?? null;
  if (!semantic && !input.semanticOptions?.skipSemantic) {
    semantic = await classifyQuestionSemantically(
      { question: effectiveQuestion, history },
      input.semanticOptions,
    );
  } else if (!semantic && input.semanticOptions?.skipSemantic) {
    semantic = {
      questionType: "ambiguous",
      entityName: null,
      entityTypeGuess: null,
      lookupSpecificity: null,
      informationNeeds: [],
      aggregateQuery: null,
      confidence: 0,
      source: "skipped",
      latencyMs: 0,
      model: null,
    };
  }

  // When continuing a clarification, force the pending entity into semantic name if
  // the classifier produced stopword residue or null.
  if (
    pendingResolution.action === "continue_with_entity" &&
    semantic &&
    semantic.questionType === "entity_lookup"
  ) {
    const cleaned = normalizeEntitySearchName(semantic.entityName);
    if (!cleaned) {
      semantic = {
        ...semantic,
        entityName: pendingResolution.entityName,
        lookupSpecificity:
          semantic.lookupSpecificity === "generic" ? "specific" : semantic.lookupSpecificity,
      };
    }
  }

  const inheritedEntityLabel =
    (pendingResolution.action === "continue_with_entity" ? pendingResolution.entityLabel : null) ||
    mostRecentEntitySource(metadata)?.label ||
    null;

  const entity = resolveQuestionEntity({
    question: effectiveQuestion,
    history,
    preferredSource,
    inheritedEntityLabel,
    semantic,
  });

  const handleInput = {
    question: effectiveQuestion,
    history,
    entity,
    preferredSource,
    conversationMetadata: metadata,
    role: input.role,
    channel: input.channel,
    ghlConfigured: input.ghlConfigured,
    userId: input.userId ?? null,
    externalUserId: input.externalUserId ?? null,
    slackTeamId: input.slackTeamId ?? null,
  };

  // Capability / procedural / conversational — bypass entity-lookup sources entirely.
  if (entity.skipEntityLookup) {
    return {
      earlyAnswer: null,
      contextItems: [],
      conversationMetadata: metadata,
      diagnostics: {
        entity,
        preferredSource,
        tried: [],
        semantic: semanticDiag(semantic, true),
      },
    };
  }

  const sources = input.sources ?? DEFAULT_SOURCES;

  // Compound questions with 2–3 distinct needs: resolve each part independently so a
  // deterministic hit on one source cannot silently drop the other parts.
  if (semantic && hasMultipleInformationNeeds(semantic)) {
    const multi = await resolveMultiNeedQuestion({
      question: effectiveQuestion,
      history,
      conversationMetadata: metadata,
      role: input.role,
      channel: input.channel,
      ghlConfigured: input.ghlConfigured,
      userId: input.userId,
      externalUserId: input.externalUserId,
      slackTeamId: input.slackTeamId,
      semantic,
      sources,
      resolvers: input.multiNeedResolvers,
    });
    if (multi) {
      return {
        earlyAnswer: multi.earlyAnswer,
        contextItems: multi.earlyAnswer.sources,
        conversationMetadata: multi.conversationMetadata,
        diagnostics: {
          entity,
          preferredSource,
          tried: multi.tried,
          semantic: semanticDiag(semantic, false),
        },
      };
    }
  }

  // Open-ended entity ask → clarifying source menu (existence only; no full dumps).
  // Specific entity asks continue through the normal source loop below.
  const entityNameForMenu = entity.extractedName || semantic?.entityName || null;
  if (shouldOfferEntitySourceMenu(effectiveQuestion, semantic) && entityNameForMenu) {
    try {
      const availability = await probeEntitySourceAvailability(
        entityNameForMenu,
        input.menuProbeDeps,
      );
      const decision = decideEntitySourceClarifyingMenu(availability);
      if (decision.kind === "menu") {
        const now = new Date().toISOString();
        if (availability.ghl.contactId) {
          const { writeGhlConversationState } =
            await import("@/lib/baxter-data/ghl/conversation-state");
          metadata = writeGhlConversationState(metadata, {
            contact: {
              id: availability.ghl.contactId,
              displayName: availability.displayName,
              email: availability.ghl.email,
              setAt: now,
            },
            opportunity: null,
            lastRequestedFields: [],
            updatedAt: now,
          });
        }
        if (availability.pem.pemId && availability.pem.prospectName) {
          const { writePemConversationState } =
            await import("@/lib/baxter-data/pem-neats/conversation-state");
          metadata = writePemConversationState(metadata, {
            pending: null,
            active: {
              type: "pem_active",
              activePemId: availability.pem.pemId,
              activeProspectName: availability.pem.prospectName,
              lastRequestedFields: [],
              baseProspectHint: availability.displayName,
            },
          });
        }
        metadata = writeEntityArbitration(metadata, {
          lastSource: availability.ghl.available
            ? "ghl"
            : availability.pem.available
              ? "pem"
              : "slack",
          label: availability.displayName,
          setAt: now,
        });

        const categories: PendingClarificationCategory[] = [];
        if (availability.pem.available) categories.push("pem");
        if (availability.ghl.available) categories.push("ghl");
        if (availability.slack.available) categories.push("slack");
        const cleanName =
          normalizeEntitySearchName(entityNameForMenu) ||
          normalizeEntitySearchName(availability.displayName) ||
          availability.displayName;
        metadata = writePendingClarification(
          metadata,
          buildInformationCategoryPending({
            entityName: cleanName,
            entityLabel: availability.displayName,
            originalQuestion: effectiveQuestion,
            categories,
          }),
        );

        return {
          earlyAnswer: {
            kind: "clarification",
            answer: decision.answer,
            sources: [],
            confidence: "high",
            insufficientKnowledge: false,
            answerMode: "clarification",
            modelProvider: "evidence-registry",
            modelName: "entity-source-menu",
            winningSource: "none",
          },
          contextItems: [],
          conversationMetadata: metadata,
          diagnostics: {
            entity,
            preferredSource,
            tried: [{ key: "ghl", confidence: 1, outcome: "source_menu" }],
            semantic: semanticDiag(semantic, false),
          },
        };
      }
      // skip_single_source / skip_none → fall through to normal retrieval
    } catch {
      // Probe failure must not block specific-path retrieval
    }
  }

  const ranked = sources
    .map((source) => {
      const handle = source.canHandle(handleInput);
      return { source, ...handle };
    })
    .filter((r) => r.plausible)
    .sort((a, b) => b.confidence - a.confidence);

  const tried: RegistryRunResult["diagnostics"]["tried"] = [];
  const priorMisses: EvidenceSourceKey[] = [];
  const softMissAnswers: Array<{ key: EvidenceSourceKey; answer: string }> = [];
  const softMissNotes: string[] = [];
  let mergedItems: BaxterContextItem[] = [];

  for (const { source, confidence } of ranked) {
    const result = await source.resolve({
      ...handleInput,
      conversationMetadata: metadata,
      priorMisses: [...priorMisses],
    });

    if (!result) {
      priorMisses.push(source.key);
      tried.push({ key: source.key, confidence, outcome: "null" });
      continue;
    }

    if (result.nextGhlState !== undefined) {
      const { writeGhlConversationState } =
        await import("@/lib/baxter-data/ghl/conversation-state");
      metadata = writeGhlConversationState(metadata, result.nextGhlState);
    }
    if (result.nextPemState !== undefined && result.nextPemState !== null) {
      const { writePemConversationState } =
        await import("@/lib/baxter-data/pem-neats/conversation-state");
      metadata = writePemConversationState(metadata, result.nextPemState);
      // Mirror PEM entity-disambiguation into the unified pending-clarification record
      // so abandonment / continuity share one mechanism with the information menu.
      if (result.nextPemState.pending?.type === "pem_selection") {
        const { buildEntityDisambiguationPending } = await import("./pending-clarification");
        const p = result.nextPemState.pending;
        metadata = writePendingClarification(
          metadata,
          buildEntityDisambiguationPending({
            entityName:
              normalizeEntitySearchName(p.baseProspectHint) ||
              p.baseProspectHint ||
              entity.extractedName ||
              "prospect",
            entityLabel: p.baseProspectHint || entity.extractedName || "prospect",
            originalQuestion: p.originalQuestion || effectiveQuestion,
            candidateLabels: p.candidateLabels,
          }),
        );
      } else if (!result.nextPemState.pending) {
        // PEM cleared its pending — drop unified entity_disambiguation if present.
        const current = readPendingClarification(metadata);
        if (current?.kind === "entity_disambiguation") {
          metadata = clearPendingClarification(metadata);
        }
      }
    }

    if (result.softMiss) {
      priorMisses.push(source.key);
      const diag = result.diagnostics as { pemSkipReason?: string | null } | undefined;
      const isContentEmpty = diag?.pemSkipReason === "pem_content_no_match";
      if (isContentEmpty && result.deterministicAnswer) {
        // Prospect NEAT was found and searched — keep the honest note for KB composition,
        // but do not treat this as "person not found in PEM" (that would short-circuit KB).
        softMissNotes.push(result.deterministicAnswer);
      } else if (result.deterministicAnswer || result.clarification) {
        softMissAnswers.push({
          key: source.key,
          answer: result.deterministicAnswer || result.clarification || "",
        });
      }
      tried.push({ key: source.key, confidence, outcome: "soft_miss" });
      continue;
    }

    if (result.clarification && result.confidence >= SHORT_CIRCUIT_CONFIDENCE) {
      const preferred = sourceKeyToPreferred(source.key);
      if (preferred) {
        metadata = writeEntityArbitration(metadata, {
          lastSource: preferred,
          label: entity.extractedName,
          setAt: new Date().toISOString(),
        });
      }
      tried.push({ key: source.key, confidence, outcome: "clarification" });
      return {
        earlyAnswer: toEarlyFromResult(source.key, result, "clarification"),
        contextItems: [],
        conversationMetadata: metadata,
        diagnostics: {
          entity,
          preferredSource,
          tried,
          semantic: semanticDiag(semantic, false),
        },
      };
    }

    if (
      result.deterministicAnswer &&
      result.confidence >= SHORT_CIRCUIT_CONFIDENCE &&
      (result.items.length > 0 || result.confidence >= 0.9)
    ) {
      const preferred = sourceKeyToPreferred(source.key);
      if (preferred) {
        metadata = writeEntityArbitration(metadata, {
          lastSource: preferred,
          label: entity.extractedName,
          setAt: new Date().toISOString(),
        });
      }
      tried.push({ key: source.key, confidence, outcome: "deterministic" });
      return {
        earlyAnswer: toEarlyFromResult(source.key, result, "deterministic"),
        contextItems: result.items,
        conversationMetadata: metadata,
        diagnostics: {
          entity,
          preferredSource,
          tried,
          semantic: semanticDiag(semantic, false),
        },
      };
    }

    if (result.items.length > 0) {
      const renumbered = result.items.map((item, index) => ({
        ...item,
        number: mergedItems.length + index + 1,
      }));
      mergedItems = [...mergedItems, ...renumbered].slice(0, 8);
      tried.push({ key: source.key, confidence, outcome: "merged_items" });
      const preferred = sourceKeyToPreferred(source.key);
      if (preferred) {
        metadata = writeEntityArbitration(metadata, {
          lastSource: preferred,
          label: entity.extractedName,
          setAt: new Date().toISOString(),
        });
      }
      if (result.deterministicAnswer && result.confidence >= SHORT_CIRCUIT_CONFIDENCE) {
        tried[tried.length - 1]!.outcome = "deterministic";
        return {
          earlyAnswer: toEarlyFromResult(source.key, result, "deterministic"),
          contextItems: result.items,
          conversationMetadata: metadata,
          diagnostics: {
            entity,
            preferredSource,
            tried,
            semantic: semanticDiag(semantic, false),
          },
        };
      }
      continue;
    }

    priorMisses.push(source.key);
    tried.push({ key: source.key, confidence, outcome: "empty" });
  }

  if (mergedItems.length === 0 && softMissAnswers.length > 0 && priorMisses.length > 0) {
    const answer = formatSourceAgnosticNotFound(
      softMissAnswers.map((s) => s.key),
      entity.extractedName,
    );
    return {
      earlyAnswer: {
        kind: "not_found",
        answer,
        sources: [],
        confidence: "medium",
        insufficientKnowledge: true,
        answerMode: "clarification",
        modelProvider: "evidence-registry",
        modelName: "source-agnostic-not-found",
        winningSource: "none",
      },
      contextItems: [],
      conversationMetadata: metadata,
      softMissNotes: softMissNotes.length ? softMissNotes : undefined,
      diagnostics: {
        entity,
        preferredSource,
        tried,
        semantic: semanticDiag(semantic, false),
      },
    };
  }

  return {
    earlyAnswer: null,
    contextItems: mergedItems,
    conversationMetadata: metadata,
    softMissNotes: softMissNotes.length ? softMissNotes : undefined,
    diagnostics: {
      entity,
      preferredSource,
      tried,
      semantic: semanticDiag(semantic, false),
    },
  };
}
