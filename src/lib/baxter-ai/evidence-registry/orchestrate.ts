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
  sourceKeyToPreferred,
  writeEntityArbitration,
} from "./conversation-arbitration";
import { ghlEvidenceSource } from "./sources/ghl";
import { rulebookEvidenceSource } from "./sources/rulebook";
import { pemEvidenceSource } from "./sources/pem";
import { dossierEvidenceSource } from "./sources/dossier";
import {
  classifyQuestionSemantically,
  type ClassifyQuestionSemanticallyOptions,
  type SemanticQuestionClassification,
} from "@/lib/baxter-ai/semantic-question-classification";
import type {
  EvidenceSource,
  EvidenceSourceKey,
  EvidenceSourceResult,
  RegistryEarlyAnswer,
  RegistryRunResult,
} from "./types";

const DEFAULT_SOURCES: EvidenceSource[] = [
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
    rulebook: "the Process Rulebook",
    customer_dossier: "the customer center",
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
        : source === "pem_neat"
          ? "pem-neats"
          : source === "customer_dossier"
            ? "customer-dossier"
            : "rulebook",
    modelName:
      kind === "clarification"
        ? "entity-resolution"
        : source === "ghl"
          ? "deterministic-crm"
          : source === "pem_neat"
            ? "deterministic-structured"
            : source === "customer_dossier"
              ? "deterministic-dossier"
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
}): Promise<RegistryRunResult> {
  let metadata: Record<string, unknown> = { ...(input.conversationMetadata ?? {}) };
  const history = input.history ?? [];
  const preferredSource = preferredSourceForFollowUp({
    question: input.question,
    history,
    conversationMetadata: metadata,
  });

  let semantic: SemanticQuestionClassification | null = input.semantic ?? null;
  if (!semantic && !input.semanticOptions?.skipSemantic) {
    semantic = await classifyQuestionSemantically(
      { question: input.question, history },
      input.semanticOptions,
    );
  } else if (!semantic && input.semanticOptions?.skipSemantic) {
    semantic = {
      questionType: "ambiguous",
      entityName: null,
      entityTypeGuess: null,
      confidence: 0,
      source: "skipped",
      latencyMs: 0,
      model: null,
    };
  }

  const entity = resolveQuestionEntity({
    question: input.question,
    history,
    preferredSource,
    semantic,
  });

  const handleInput = {
    question: input.question,
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
    }

    if (result.softMiss) {
      priorMisses.push(source.key);
      if (result.deterministicAnswer || result.clarification) {
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
    diagnostics: {
      entity,
      preferredSource,
      tried,
      semantic: semanticDiag(semantic, false),
    },
  };
}
