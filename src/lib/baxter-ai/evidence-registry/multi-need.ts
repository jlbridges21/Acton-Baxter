/**
 * Multi-need compound questions — resolve each distinct information need against
 * its own source, then compose one honest answer.
 *
 * A deterministic short-circuit from one source must satisfy only its part;
 * it must not terminate resolution of the other parts.
 */

import type { BaxterContextItem, BaxterHistoryMessage } from "@/lib/baxter-ai/types";
import {
  hasMultipleInformationNeeds,
  type SemanticInformationNeed,
  type SemanticQuestionClassification,
} from "@/lib/baxter-ai/semantic-question-classification";
import { resolveQuestionEntity } from "./entity-resolution";
import {
  sourceKeyToPreferred,
  writeEntityArbitration,
  type PreferredEntitySource,
} from "./conversation-arbitration";
import type {
  EvidenceSource,
  EvidenceSourceKey,
  EvidenceSourceResult,
  RegistryEarlyAnswer,
} from "./types";

const PART_SHORT_CIRCUIT = 0.7;

export type MultiNeedSourceHint = SemanticInformationNeed["sourceHint"];

export type MultiNeedPartResolution = {
  need: SemanticInformationNeed;
  status: "answered" | "clarification" | "unresolved";
  answer: string | null;
  items: BaxterContextItem[];
  sourceKey: EvidenceSourceKey | "slack" | "knowledge" | "none";
  softMiss?: boolean;
  nextGhlState?: EvidenceSourceResult["nextGhlState"];
  nextPemState?: EvidenceSourceResult["nextPemState"];
};

export type MultiNeedExternalResolver = (need: SemanticInformationNeed) => Promise<{
  answer: string | null;
  items?: BaxterContextItem[];
  softMiss?: boolean;
} | null>;

export type MultiNeedResolvers = {
  slack?: MultiNeedExternalResolver;
  knowledge?: MultiNeedExternalResolver;
};

const SOURCE_LABEL: Record<MultiNeedSourceHint, string> = {
  pem: "the PEM NEAT",
  ghl: "GoHighLevel",
  slack: "Slack",
  knowledge: "the Knowledge Base",
  rulebook: "the Process Rulebook",
  unknown: "available sources",
};

function hintToEntityTypeGuess(
  hint: MultiNeedSourceHint,
): SemanticQuestionClassification["entityTypeGuess"] {
  switch (hint) {
    case "pem":
      return "pem_prospect";
    case "ghl":
      return "ghl_opportunity";
    case "rulebook":
      return "rulebook_step_or_role";
    default:
      return "unknown";
  }
}

function hintToPreferred(hint: MultiNeedSourceHint): PreferredEntitySource | null {
  switch (hint) {
    case "pem":
      return "pem";
    case "ghl":
      return "ghl";
    case "slack":
      return "slack";
    default:
      return null;
  }
}

function hintPrefersSource(hint: MultiNeedSourceHint, key: EvidenceSourceKey): boolean {
  if (hint === "pem") return key === "pem_neat" || key === "pem_aggregate";
  if (hint === "ghl") return key === "ghl";
  if (hint === "rulebook") return key === "rulebook";
  return false;
}

function sourceLabelForKey(key: EvidenceSourceKey | "slack" | "knowledge" | "none"): string {
  if (key === "pem_neat" || key === "pem_aggregate") return "PEM NEAT";
  if (key === "ghl") return "GoHighLevel";
  if (key === "rulebook") return "Process Rulebook";
  if (key === "customer_dossier") return "Customer Center";
  if (key === "project_registry") return "Master Project Log";
  if (key === "slack") return "Slack";
  if (key === "knowledge") return "Knowledge Base";
  return "sources";
}

function trimPartAnswer(answer: string): string {
  return answer.trim();
}

function unresolvedLine(need: SemanticInformationNeed): string {
  const name = need.entityName?.trim() || "that";
  const label = SOURCE_LABEL[need.sourceHint];
  const q = need.partQuestion.toLowerCase();
  if (need.sourceHint === "ghl") {
    if (/\b(stage|pipeline)\b/i.test(q)) {
      return `I couldn’t find a current pipeline stage for ${name} in ${label}.`;
    }
    return `I couldn’t find that for ${name} in ${label}.`;
  }
  if (need.sourceHint === "pem") {
    return `I couldn’t find that in ${name}'s PEM NEAT.`;
  }
  if (need.sourceHint === "slack") {
    return `I couldn’t find recent Slack activity for ${name}.`;
  }
  if (need.sourceHint === "knowledge") {
    return `I couldn’t find that in ${label}.`;
  }
  return `I couldn’t find that for ${name} in ${label}.`;
}

/**
 * Compose a tight multi-part answer. Answered parts keep their deterministic text;
 * unresolved parts get an explicit honest miss (never silent omission).
 */
export function composeMultiNeedAnswer(parts: MultiNeedPartResolution[]): string {
  const blocks: string[] = [];
  for (const part of parts) {
    if (part.status === "answered" || part.status === "clarification") {
      if (part.answer?.trim()) blocks.push(trimPartAnswer(part.answer));
      continue;
    }
    blocks.push(unresolvedLine(part.need));
  }
  return blocks.join("\n\n");
}

async function resolveRegistryPart(input: {
  need: SemanticInformationNeed;
  history: BaxterHistoryMessage[];
  conversationMetadata: Record<string, unknown>;
  role?: string | null;
  channel?: "web" | "slack";
  ghlConfigured: boolean;
  userId?: string | null;
  externalUserId?: string | null;
  slackTeamId?: string | null;
  semantic: SemanticQuestionClassification;
  sources: EvidenceSource[];
}): Promise<MultiNeedPartResolution> {
  const { need, semantic, sources } = input;
  const partSemantic: SemanticQuestionClassification = {
    ...semantic,
    questionType: "entity_lookup",
    entityName: need.entityName ?? semantic.entityName,
    entityTypeGuess: hintToEntityTypeGuess(need.sourceHint),
    lookupSpecificity: need.lookupSpecificity ?? "specific",
    informationNeeds: [],
  };
  const preferred = hintToPreferred(need.sourceHint);
  const entity = resolveQuestionEntity({
    question: need.partQuestion,
    history: input.history,
    preferredSource: preferred,
    semantic: partSemantic,
  });

  const handleInput = {
    question: need.partQuestion,
    history: input.history,
    entity,
    preferredSource: preferred,
    conversationMetadata: input.conversationMetadata,
    role: input.role,
    channel: input.channel,
    ghlConfigured: input.ghlConfigured,
    userId: input.userId ?? null,
    externalUserId: input.externalUserId ?? null,
    slackTeamId: input.slackTeamId ?? null,
  };

  const ranked = sources
    .map((source) => {
      const handle = source.canHandle(handleInput);
      let confidence = handle.confidence;
      if (handle.plausible && hintPrefersSource(need.sourceHint, source.key)) {
        confidence = Math.max(confidence, 0.95);
      }
      // Suppress rival sources when the part has an explicit hint.
      if (
        handle.plausible &&
        need.sourceHint === "pem" &&
        source.key === "ghl" &&
        !/\b(ghl|gohighlevel|crm)\b/i.test(need.partQuestion)
      ) {
        return { source, plausible: false, confidence: 0 };
      }
      if (
        handle.plausible &&
        need.sourceHint === "ghl" &&
        source.key === "pem_neat" &&
        !/\b(pem|neat)\b/i.test(need.partQuestion)
      ) {
        return { source, plausible: false, confidence: 0 };
      }
      return { source, ...handle, confidence };
    })
    .filter((r) => r.plausible)
    .sort((a, b) => b.confidence - a.confidence);

  const priorMisses: EvidenceSourceKey[] = [];
  for (const { source } of ranked) {
    const result = await source.resolve({
      ...handleInput,
      priorMisses: [...priorMisses],
    });
    if (!result) {
      priorMisses.push(source.key);
      continue;
    }
    if (result.softMiss) {
      priorMisses.push(source.key);
      continue;
    }
    if (result.clarification && result.confidence >= PART_SHORT_CIRCUIT) {
      return {
        need,
        status: "clarification",
        answer: result.clarification,
        items: result.items,
        sourceKey: source.key,
        nextGhlState: result.nextGhlState,
        nextPemState: result.nextPemState,
      };
    }
    if (
      result.deterministicAnswer &&
      result.confidence >= PART_SHORT_CIRCUIT &&
      (result.items.length > 0 || result.confidence >= 0.9)
    ) {
      return {
        need,
        status: "answered",
        answer: result.deterministicAnswer,
        items: result.items,
        sourceKey: source.key,
        nextGhlState: result.nextGhlState,
        nextPemState: result.nextPemState,
      };
    }
    if (result.items.length > 0 && result.deterministicAnswer) {
      return {
        need,
        status: "answered",
        answer: result.deterministicAnswer,
        items: result.items,
        sourceKey: source.key,
        nextGhlState: result.nextGhlState,
        nextPemState: result.nextPemState,
      };
    }
    priorMisses.push(source.key);
  }

  return {
    need,
    status: "unresolved",
    answer: null,
    items: [],
    sourceKey: "none",
  };
}

export async function resolveMultiNeedQuestion(input: {
  question: string;
  history: BaxterHistoryMessage[];
  conversationMetadata: Record<string, unknown>;
  role?: string | null;
  channel?: "web" | "slack";
  ghlConfigured: boolean;
  userId?: string | null;
  externalUserId?: string | null;
  slackTeamId?: string | null;
  semantic: SemanticQuestionClassification;
  sources: EvidenceSource[];
  resolvers?: MultiNeedResolvers;
}): Promise<{
  earlyAnswer: RegistryEarlyAnswer;
  conversationMetadata: Record<string, unknown>;
  parts: MultiNeedPartResolution[];
  tried: Array<{ key: EvidenceSourceKey; confidence: number; outcome: string }>;
} | null> {
  if (!hasMultipleInformationNeeds(input.semantic)) return null;
  const needs = (input.semantic.informationNeeds ?? []).slice(0, 3);
  let metadata = { ...input.conversationMetadata };
  const parts: MultiNeedPartResolution[] = [];
  const tried: Array<{ key: EvidenceSourceKey; confidence: number; outcome: string }> = [];

  for (const need of needs) {
    if (need.sourceHint === "slack" && input.resolvers?.slack) {
      const ext = await input.resolvers.slack(need);
      if (ext?.answer?.trim()) {
        parts.push({
          need,
          status: "answered",
          answer: ext.answer,
          items: ext.items ?? [],
          sourceKey: "slack",
          softMiss: ext.softMiss,
        });
        continue;
      }
      parts.push({
        need,
        status: "unresolved",
        answer: null,
        items: [],
        sourceKey: "slack",
      });
      continue;
    }
    if (need.sourceHint === "knowledge" && input.resolvers?.knowledge) {
      const ext = await input.resolvers.knowledge(need);
      if (ext?.answer?.trim()) {
        parts.push({
          need,
          status: "answered",
          answer: ext.answer,
          items: ext.items ?? [],
          sourceKey: "knowledge",
          softMiss: ext.softMiss,
        });
        continue;
      }
      parts.push({
        need,
        status: "unresolved",
        answer: null,
        items: [],
        sourceKey: "knowledge",
      });
      continue;
    }

    const part = await resolveRegistryPart({
      need,
      history: input.history,
      conversationMetadata: metadata,
      role: input.role,
      channel: input.channel,
      ghlConfigured: input.ghlConfigured,
      userId: input.userId,
      externalUserId: input.externalUserId,
      slackTeamId: input.slackTeamId,
      semantic: input.semantic,
      sources: input.sources,
    });
    parts.push(part);
    if (
      part.sourceKey === "ghl" ||
      part.sourceKey === "pem_neat" ||
      part.sourceKey === "rulebook"
    ) {
      tried.push({
        key: part.sourceKey,
        confidence: 1,
        outcome: part.status === "unresolved" ? "multi_need_miss" : `multi_need_${part.status}`,
      });
    }
    if (part.nextGhlState !== undefined) {
      const { writeGhlConversationState } =
        await import("@/lib/baxter-data/ghl/conversation-state");
      metadata = writeGhlConversationState(metadata, part.nextGhlState);
    }
    if (part.nextPemState !== undefined && part.nextPemState !== null) {
      const { writePemConversationState } =
        await import("@/lib/baxter-data/pem-neats/conversation-state");
      metadata = writePemConversationState(metadata, part.nextPemState);
    }
    if (part.sourceKey !== "none" && part.sourceKey !== "slack" && part.sourceKey !== "knowledge") {
      const preferred = sourceKeyToPreferred(part.sourceKey);
      if (preferred) {
        metadata = writeEntityArbitration(metadata, {
          lastSource: preferred,
          label: need.entityName ?? input.semantic.entityName,
          setAt: new Date().toISOString(),
        });
      }
    }
  }

  const answered = parts.filter((p) => p.status === "answered" || p.status === "clarification");
  const answer = composeMultiNeedAnswer(parts);
  const items = parts.flatMap((p) => p.items).slice(0, 8);
  const anyAnswered = answered.length > 0;

  return {
    earlyAnswer: {
      kind: anyAnswered ? "deterministic" : "not_found",
      answer,
      sources: items,
      confidence: answered.length === parts.length ? "high" : anyAnswered ? "medium" : "low",
      insufficientKnowledge: !anyAnswered,
      answerMode: anyAnswered ? "grounded" : "clarification",
      modelProvider: "evidence-registry",
      modelName: "multi-need-compose",
      winningSource: "none",
    },
    conversationMetadata: metadata,
    parts,
    tried,
  };
}

/** Test helper — source attribution labels used in composition honesty. */
export function multiNeedSourceLabelForTests(key: Parameters<typeof sourceLabelForKey>[0]): string {
  return sourceLabelForKey(key);
}
