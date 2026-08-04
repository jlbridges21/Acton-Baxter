/**
 * Central entity-resolution step.
 * Semantic classification is the primary signal when available and confident;
 * regex extractors remain the fallback / secondary path.
 */

import { detectGhlIntent } from "@/lib/baxter-ai/ghl-intent";
import { detectRulebookIntent } from "@/lib/rulebook/evidence";
import { detectPemIntent, parsePemEntityQuery } from "@/lib/baxter-data/pem-neats/intent";
import {
  extractPriorEntitiesFromHistory,
  decideConversationContext,
} from "@/lib/baxter-ai/conversation-context";
import type { BaxterHistoryMessage } from "@/lib/baxter-ai/types";
import type { PreferredEntitySource } from "./conversation-arbitration";
import { isPlausibleCrmEntityCandidate } from "./entity-plausibility";
import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";
import {
  isNonEntitySemanticType,
  isSemanticRoutingConfident,
  type SemanticQuestionClassification,
  type SemanticQuestionType,
} from "@/lib/baxter-ai/semantic-question-classification";

export type EntityType =
  "ghl_contact" | "ghl_opportunity" | "pem_prospect" | "rulebook_step_or_role" | "none";

export type EntityCandidate = {
  type: EntityType;
  name: string | null;
  confidence: number;
  /** Which extractor produced this candidate. */
  via: "ghl" | "pem" | "rulebook" | "history" | "arbitration" | "semantic";
};

export type EntityResolutionResult = {
  /** Highest-confidence candidate when unambiguous; null when none or tied across types. */
  primary: EntityCandidate | null;
  candidates: EntityCandidate[];
  /** True when ≥2 different entity types score within 0.15 of each other. */
  ambiguousAcrossTypes: boolean;
  extractedName: string | null;
  isFollowUp: boolean;
  /** Semantic routing result when provided (may be skipped/fallback). */
  semantic: SemanticQuestionClassification | null;
  /**
   * When true, entity-lookup sources (GHL / PEM / Rulebook / dossier) must not claim —
   * question is capability/procedural/conversational per semantic classifier.
   */
  skipEntityLookup: boolean;
  /** Effective question type from semantic when confident; otherwise null. */
  questionType: SemanticQuestionType | null;
};

const OPPORTUNITY_SHAPE =
  /\b(opportunity|deal|project)\b|\b(status|stage)\s+of\b|\bwhat(?:'s|\s+is)\s+going\s+on\s+with\b/i;

function mapSemanticEntityType(
  guess: SemanticQuestionClassification["entityTypeGuess"],
): EntityType {
  switch (guess) {
    case "ghl_contact":
      return "ghl_contact";
    case "ghl_opportunity":
      return "ghl_opportunity";
    case "pem_prospect":
      return "pem_prospect";
    case "rulebook_step_or_role":
      return "rulebook_step_or_role";
    default:
      return "none";
  }
}

function collectRegexCandidates(input: {
  question: string;
  history: BaxterHistoryMessage[];
  preferredSource?: PreferredEntitySource | null;
}): EntityCandidate[] {
  const question = input.question.trim();
  const history = input.history;
  const candidates: EntityCandidate[] = [];

  const ghl = detectGhlIntent(question);
  if (ghl.intent !== "none" && ghl.confidence > 0) {
    const name =
      ghl.entities.contactName || ghl.entities.opportunityName || ghl.entities.contactEmail || null;
    let type: EntityType = "none";
    if (
      ghl.intent === "opportunity_lookup" ||
      ghl.intent === "opportunity_list" ||
      ghl.intent === "write_opportunity"
    ) {
      type = "ghl_opportunity";
    } else if (
      ghl.intent === "contact_lookup" ||
      ghl.intent === "contact_list" ||
      ghl.intent === "conversation_lookup" ||
      ghl.intent === "write_contact" ||
      ghl.intent === "write_tag"
    ) {
      type = "ghl_contact";
    } else if (ghl.intent !== "pipeline_info" && ghl.intent !== "calendar_query") {
      type = name ? "ghl_contact" : "none";
    }
    if (type !== "none") {
      if (name && !isPlausibleCrmEntityCandidate(name) && !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(name)) {
        // Instructional/meta false positive — skip.
      } else {
        candidates.push({
          type,
          name,
          confidence: ghl.confidence,
          via: "ghl",
        });
      }
    } else if (name && isPlausibleCrmEntityCandidate(name)) {
      candidates.push({
        type: "ghl_contact",
        name,
        confidence: Math.min(ghl.confidence, 0.6),
        via: "ghl",
      });
    }
  }

  const pem = detectPemIntent(question);
  const pemEntity = parsePemEntityQuery(question);
  if (pem.intent === "record_lookup" || pem.intent === "pem_selection_reply") {
    candidates.push({
      type: "pem_prospect",
      name: pem.nameQuery || pemEntity.nameQuery,
      confidence: pem.intent === "record_lookup" ? 0.88 : 0.75,
      via: "pem",
    });
  } else if (pemEntity.nameQuery) {
    const soft =
      OPPORTUNITY_SHAPE.test(question) || /\b(status|stage|budget|pain|outcome)\b/i.test(question);
    if (soft) {
      candidates.push({
        type: "pem_prospect",
        name: pemEntity.nameQuery,
        confidence: 0.55,
        via: "pem",
      });
    }
  }

  const ghlOpp = candidates.find((c) => c.type === "ghl_opportunity" && c.name);
  if (ghlOpp?.name) {
    const existingPem = candidates.find(
      (c) => c.type === "pem_prospect" && c.name?.toLowerCase() === ghlOpp.name!.toLowerCase(),
    );
    if (existingPem) {
      existingPem.confidence = Math.max(existingPem.confidence, 0.72);
    } else {
      candidates.push({
        type: "pem_prospect",
        name: ghlOpp.name,
        confidence: 0.72,
        via: "ghl",
      });
    }
  }

  const rulebook = detectRulebookIntent(question);
  if (rulebook !== "none") {
    candidates.push({
      type: "rulebook_step_or_role",
      name: null,
      confidence: 0.8,
      via: "rulebook",
    });
  }

  const ctx = decideConversationContext(question, history);
  if (ctx.inheritPriorEntities || ctx.hasPronounReference) {
    const prior = extractPriorEntitiesFromHistory(history);
    const preferred = input.preferredSource ?? null;
    if (preferred === "pem" || (!preferred && prior[0])) {
      if (preferred === "pem" || candidates.every((c) => c.type !== "pem_prospect")) {
        candidates.push({
          type: "pem_prospect",
          name: prior[0] ?? null,
          confidence: preferred === "pem" ? 0.9 : 0.5,
          via: preferred === "pem" ? "arbitration" : "history",
        });
      }
    }
    if (preferred === "ghl") {
      candidates.push({
        type: "ghl_contact",
        name: prior[0] ?? null,
        confidence: 0.9,
        via: "arbitration",
      });
    }
  }

  return candidates;
}

/**
 * Resolve what the question is centrally about, before expensive source retrieval.
 * When `semantic` is confident and non-entity, returns skipEntityLookup (no regex claim).
 * When semantic is confident entity_lookup, that name/type is primary; regex is secondary.
 * When semantic is unavailable/ambiguous, regex path runs as before.
 */
export function resolveQuestionEntity(input: {
  question: string;
  history?: BaxterHistoryMessage[];
  preferredSource?: PreferredEntitySource | null;
  semantic?: SemanticQuestionClassification | null;
}): EntityResolutionResult {
  const question = input.question.trim();
  const history = input.history ?? [];
  const semantic = input.semantic ?? null;
  const ctx = decideConversationContext(question, history);
  const isFollowUp = ctx.isFollowUp || ctx.hasPronounReference;

  if (isSemanticRoutingConfident(semantic) && isNonEntitySemanticType(semantic!.questionType)) {
    return {
      primary: null,
      candidates: [],
      ambiguousAcrossTypes: false,
      extractedName: null,
      isFollowUp,
      semantic,
      skipEntityLookup: true,
      questionType: semantic!.questionType,
    };
  }

  const candidates: EntityCandidate[] = [];
  let usedSemanticEntity = false;

  if (
    isSemanticRoutingConfident(semantic) &&
    semantic!.questionType === "entity_lookup" &&
    semantic!.entityName
  ) {
    const cleanedSemanticName =
      normalizeEntitySearchName(semantic!.entityName) || semantic!.entityName;
    const type = mapSemanticEntityType(semantic!.entityTypeGuess);
    if (type !== "none") {
      candidates.push({
        type,
        name: cleanedSemanticName,
        confidence: Math.max(semantic!.confidence, 0.92),
        via: "semantic",
      });
      usedSemanticEntity = true;
    } else {
      // Name known, type unknown — prefer attempting both GHL opportunity + PEM.
      candidates.push({
        type: "ghl_opportunity",
        name: cleanedSemanticName,
        confidence: Math.min(semantic!.confidence, 0.75),
        via: "semantic",
      });
      candidates.push({
        type: "pem_prospect",
        name: cleanedSemanticName,
        confidence: Math.min(semantic!.confidence, 0.72),
        via: "semantic",
      });
      usedSemanticEntity = true;
    }
  }

  // Regex secondary (or primary when semantic unavailable / ambiguous).
  const regexCandidates = collectRegexCandidates({
    question,
    history,
    preferredSource: input.preferredSource,
  });

  if (usedSemanticEntity) {
    const semanticName = (
      normalizeEntitySearchName(semantic!.entityName) ||
      semantic!.entityName ||
      ""
    ).toLowerCase();
    for (const c of regexCandidates) {
      // Keep collision rivals (e.g. PEM for same person) and alternate extractors.
      if (c.via === "semantic") continue;
      const cleanedRegexName = c.name ? normalizeEntitySearchName(c.name) || c.name : null;
      if (
        cleanedRegexName &&
        cleanedRegexName.toLowerCase() === semanticName &&
        c.type === candidates[0]?.type
      ) {
        continue; // duplicate of semantic primary
      }
      candidates.push(
        cleanedRegexName && cleanedRegexName !== c.name ? { ...c, name: cleanedRegexName } : c,
      );
    }
  } else {
    for (const c of regexCandidates) {
      const cleaned = c.name ? normalizeEntitySearchName(c.name) || c.name : null;
      candidates.push(cleaned && cleaned !== c.name ? { ...c, name: cleaned } : c);
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  const top = candidates[0] ?? null;
  const rival = candidates.find((c) => c.type !== top?.type);
  const ambiguousAcrossTypes = Boolean(
    top && rival && Math.abs(top.confidence - rival.confidence) <= 0.15,
  );

  // Semantic entity primary wins ambiguity ties when it was the top signal.
  let primary: EntityCandidate | null =
    !top || top.confidence < 0.4 ? null : ambiguousAcrossTypes ? null : top;
  if (usedSemanticEntity && top?.via === "semantic" && ambiguousAcrossTypes) {
    // Keep ambiguousAcrossTypes true for arbitration (try both), but prefer semantic name.
    primary = null;
  }

  const rawExtractedName =
    (usedSemanticEntity
      ? normalizeEntitySearchName(semantic!.entityName) || semantic!.entityName
      : null) ||
    primary?.name ||
    candidates.find((c) => c.name)?.name ||
    extractPriorEntitiesFromHistory(history)[0] ||
    null;
  const extractedName = rawExtractedName
    ? normalizeEntitySearchName(rawExtractedName) || rawExtractedName
    : null;

  return {
    primary,
    candidates,
    ambiguousAcrossTypes,
    extractedName,
    isFollowUp,
    semantic,
    skipEntityLookup: false,
    questionType:
      isSemanticRoutingConfident(semantic) && semantic!.questionType === "entity_lookup"
        ? "entity_lookup"
        : null,
  };
}
