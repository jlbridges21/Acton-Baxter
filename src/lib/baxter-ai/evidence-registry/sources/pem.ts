/**
 * PEM NEAT evidence source wrapper.
 * When a named prospect matches the PEM index but intent is "none",
 * adapt the question so PEM's existing record_lookup path can run (wrap-only).
 * Content-seeking questions pass the original wording for lexical passage search.
 */

import { detectPemIntent } from "@/lib/baxter-data/pem-neats/intent";
import { detectRequestedPemFields, type PemFieldKey } from "@/lib/baxter-data/pem-neats/fields";
import { retrievePemEvidence } from "@/lib/baxter-data/pem-neats/evidence";
import {
  buildPemProspectIndex,
  hasConfidentProspectMatch,
} from "@/lib/baxter-data/pem-neats/prospect-index";
import { readPemConversationState } from "@/lib/baxter-data/pem-neats/conversation-state";
import { isSemanticRoutingConfident } from "@/lib/baxter-ai/semantic-question-classification";
import type { EvidenceSource, EvidenceSourceResult } from "../types";

const OPPORTUNITY_OR_STATUS =
  /\b(opportunity|deal)\b|\b(status|stage)\s+of\b|\bwhat(?:'s|\s+is)\s+the\s+status\b/i;

/** Fields that stay deterministic field-lookup (mirrored from evidence.ts STRICT_FIELD_KEYS). */
const STRICT_FIELD_KEYS = new Set<PemFieldKey>([
  "type_1_pain",
  "type_2_pain",
  "budget",
  "decision_process",
  "schedule",
  "competition",
  "fit",
  "next_steps",
  "outcome",
  "qualification",
  "customer_story",
  "customer_pain",
  "buildertrend",
  "project",
  "salesperson",
]);

/**
 * Build a question PEM's existing intent parser will treat as record_lookup.
 * Only used when the original question wouldn't fire PEM but entity resolution
 * already extracted a person name (GHL opportunity collision class / content search).
 */
export function adaptQuestionForPemLookup(question: string, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return question;
  const intent = detectPemIntent(question);
  if (/\b(pem|neat)\b/i.test(question) && intent.intent === "record_lookup" && intent.nameQuery) {
    // Keep the original wording only when intent already resolved the same person.
    // Otherwise "Look in … neat … open up …" can invent "Open Up" while semantic
    // correctly names Sharon Liu — rewriting is required.
    const intentNorm = intent.nameQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const goodNorm = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      intentNorm === goodNorm ||
      intentNorm.startsWith(goodNorm) ||
      goodNorm.startsWith(intentNorm) ||
      intentNorm.includes(goodNorm) ||
      goodNorm.includes(intentNorm)
    ) {
      return question;
    }
  }
  // Possessive + PEM triggers RECORD_SIGNAL + strong name signal.
  return `Tell me about ${trimmed}'s PEM`;
}

function isSemanticContentSeeking(input: {
  entity: { semantic?: { lookupSpecificity?: string | null; questionType?: string } | null };
}): boolean {
  const semantic = input.entity.semantic;
  return Boolean(semantic && semantic.lookupSpecificity === "content_search");
}

/**
 * When a named PEM prospect is resolved but the question isn't a strict field ask,
 * search transcript/assessment content. Semantic content_search is primary; falling
 * back when the ask is open-ended about that person (not "show me their NEAT").
 */
function looksLikeContentSeekingQuestion(question: string): boolean {
  return (
    /\b(what did|how did|find (?:the )?part|find where|look in .{0,60}\b(?:pem|neat)\b|where (?:did|do) they|show (?:me )?how|disqualif\w*|what am i missing|transcript|said about|handled|objection|got (?:her|him|them) to|share more|open up more|caused (?:her|him|them) to)\b/i.test(
      question,
    ) || /\b(quote|passage|discussed|conversation about)\b/i.test(question)
  );
}

function inferContentSeeking(input: {
  question: string;
  entity: { semantic?: { lookupSpecificity?: string | null; questionType?: string } | null };
}): boolean {
  if (isSemanticContentSeeking(input)) return true;

  const fields = detectRequestedPemFields(input.question);
  // Explicit typed field asks stay on the field path (even if phrasing mentions a name).
  if (fields.some((f) => STRICT_FIELD_KEYS.has(f))) return false;

  // Explicit record/summary asks stay on the summary path.
  if (/\b(show|open|pull up|full)\b[\s\S]{0,40}\b(pem|neat)\b/i.test(input.question)) {
    return false;
  }
  if (/\b(summary|overview|tell me about)\b[\s\S]{0,40}\b(pem|neat)\b/i.test(input.question)) {
    return false;
  }

  // Content-seeking shapes (transcript / technique / exchange) — whether or not
  // intent already fired record_lookup (e.g. "Look in Sharon Liu neat and find…").
  if (looksLikeContentSeekingQuestion(input.question)) {
    return fields.length === 0 || (fields.length === 1 && fields[0] === "summary");
  }

  // Adapted opportunity / status / open asks without content cues stay on field/summary.
  return false;
}

export const pemEvidenceSource: EvidenceSource = {
  key: "pem_neat",

  canHandle(input) {
    if (input.entity.skipEntityLookup) {
      return { plausible: false, confidence: 0 };
    }
    const semantic = input.entity.semantic;
    const contentSeeking = isSemanticContentSeeking(input);

    if (isSemanticRoutingConfident(semantic) && semantic!.questionType === "entity_lookup") {
      const guess = semantic!.entityTypeGuess;
      if (guess === "pem_prospect") {
        // Named PEM prospect must outrank Slack/KB soft paths.
        const base = contentSeeking ? 0.94 : 0.9;
        return {
          plausible: true,
          confidence: Math.max(base, semantic!.confidence),
        };
      }
      if (guess === "ghl_contact" || guess === "ghl_opportunity") {
        // Still allow soft PEM claim below for collision class.
      } else if (semantic!.entityName) {
        // unknown / unspecified type — still attempt PEM when we have a name.
        const base = contentSeeking ? 0.86 : Math.min(0.78, Math.max(0.65, semantic!.confidence));
        return {
          plausible: true,
          confidence: contentSeeking ? Math.max(base, semantic!.confidence) : base,
        };
      }
    }

    // Content-search specificity without a confident entity_lookup packet — still claim PEM
    // when a name was extracted.
    if (
      contentSeeking &&
      (input.entity.extractedName ||
        input.entity.candidates.some((c) => c.type === "pem_prospect" && c.name))
    ) {
      return { plausible: true, confidence: 0.9 };
    }

    const intent = detectPemIntent(input.question);
    if (intent.intent === "record_lookup" || intent.intent === "pem_selection_reply") {
      let confidence = 0.88;
      if (input.preferredSource === "pem" && input.entity.isFollowUp) {
        confidence = 0.96;
      }
      return { plausible: true, confidence };
    }

    if (input.preferredSource === "pem" && input.entity.isFollowUp) {
      return { plausible: true, confidence: 0.9 };
    }

    // Collision class / named person: claim PEM so resolve can check the prospect index.
    const pemCandidate = input.entity.candidates.find((c) => c.type === "pem_prospect" && c.name);
    const name = pemCandidate?.name || input.entity.extractedName;
    if (
      name &&
      (OPPORTUNITY_OR_STATUS.test(input.question) ||
        /\b(project|information|info|details)\b/i.test(input.question) ||
        // Possessive / named-person field asks that intent may still mark "none"
        // until RECORD_SIGNAL vocabulary catches up — still try PEM.
        /\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:'s|s')\b/.test(input.question) ||
        Boolean(pemCandidate))
    ) {
      return { plausible: true, confidence: pemCandidate ? 0.82 : 0.7 };
    }

    return { plausible: false, confidence: 0 };
  },

  async resolve(input): Promise<EvidenceSourceResult | null> {
    let resolutionQuestion = input.question;
    const intent = detectPemIntent(resolutionQuestion);
    const name =
      input.entity.candidates.find((c) => c.type === "pem_prospect")?.name ||
      input.entity.extractedName ||
      input.entity.semantic?.entityName ||
      null;
    // Prefer a confident semantic/candidate prospect over a weak intent parse
    // (e.g. coaching narratives where bigram extraction invents "Want To" from
    // "I want to show…" while semantic correctly names Sharon Liu).
    // Do NOT adapt pronoun follow-ups that already have an active PEM in conversation
    // state (e.g. Robert Vertin Test 8 vs Test 2).
    if (name) {
      const index = await buildPemProspectIndex({ includeNeedsRegeneration: true }).catch(() => []);
      if (hasConfidentProspectMatch(name, index)) {
        const inventingBadName =
          Boolean(intent.nameQuery) && !hasConfidentProspectMatch(intent.nameQuery!, index);
        const pemState = readPemConversationState(input.conversationMetadata);
        const missingNameNoActivePem =
          intent.intent === "record_lookup" && !intent.nameQuery && !pemState.active?.activePemId;
        if (intent.intent === "none" || inventingBadName || missingNameNoActivePem) {
          resolutionQuestion = adaptQuestionForPemLookup(input.question, name);
        }
      } else if (intent.intent === "none") {
        return null;
      }
    }

    const contentSeeking = inferContentSeeking({
      question: input.question,
      entity: input.entity,
    });
    const pemEvidence = await retrievePemEvidence({
      // Adapted question drives intent/record resolution.
      question: resolutionQuestion,
      // Original wording scores transcript/assessment passages and field detection.
      contentSearchQuestion: contentSeeking ? input.question : undefined,
      history: input.history,
      role: input.role,
      channel: input.channel,
      conversationMetadata: input.conversationMetadata,
      contentSeeking,
    }).catch(() => null);

    if (!pemEvidence) return null;

    if (pemEvidence.clarification) {
      const isNotFound = /couldn['’]t find a completed pem/i.test(pemEvidence.clarification);
      if (isNotFound && input.priorMisses.length === 0) {
        return {
          items: [],
          clarification: pemEvidence.clarification,
          confidence: 0.2,
          softMiss: true,
          nextPemState: pemEvidence.nextConversationState ?? undefined,
          diagnostics: pemEvidence.diagnostics,
        };
      }
      return {
        items: [],
        clarification: pemEvidence.clarification,
        confidence: isNotFound ? 0.25 : 0.9,
        softMiss: isNotFound,
        nextPemState: pemEvidence.nextConversationState ?? undefined,
        diagnostics: pemEvidence.diagnostics,
      };
    }

    if (
      pemEvidence.answerMode === "not_determinable" &&
      pemEvidence.diagnostics.pemSkipReason === "pem_content_no_match" &&
      pemEvidence.deterministicAnswer
    ) {
      return {
        items: [],
        deterministicAnswer: pemEvidence.deterministicAnswer,
        confidence: 0.3,
        softMiss: true,
        nextPemState: pemEvidence.nextConversationState ?? undefined,
        diagnostics: pemEvidence.diagnostics,
      };
    }

    if (pemEvidence.deterministicAnswer && pemEvidence.items.length > 0) {
      const contentHit = pemEvidence.items.some((i) => (i.tags ?? []).includes("content_search"));
      return {
        items: pemEvidence.items,
        deterministicAnswer: pemEvidence.deterministicAnswer,
        confidence: contentHit ? 0.96 : pemEvidence.answerMode === "not_determinable" ? 0.7 : 0.95,
        nextPemState: pemEvidence.nextConversationState ?? undefined,
        diagnostics: pemEvidence.diagnostics,
      };
    }

    if (pemEvidence.items.length > 0) {
      return {
        items: pemEvidence.items,
        confidence: 0.8,
        nextPemState: pemEvidence.nextConversationState ?? undefined,
        diagnostics: pemEvidence.diagnostics,
      };
    }

    return null;
  },
};
