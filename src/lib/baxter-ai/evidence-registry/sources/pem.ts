/**
 * PEM NEAT evidence source wrapper — retrievePemEvidence unchanged.
 * When a named prospect matches the PEM index but intent is "none",
 * adapt the question so PEM's existing record_lookup path can run (wrap-only).
 * Content-seeking questions pass the original wording for lexical passage search.
 */

import { detectPemIntent } from "@/lib/baxter-data/pem-neats/intent";
import { retrievePemEvidence } from "@/lib/baxter-data/pem-neats/evidence";
import {
  buildPemProspectIndex,
  hasConfidentProspectMatch,
} from "@/lib/baxter-data/pem-neats/prospect-index";
import { isSemanticRoutingConfident } from "@/lib/baxter-ai/semantic-question-classification";
import type { EvidenceSource, EvidenceSourceResult } from "../types";

const OPPORTUNITY_OR_STATUS =
  /\b(opportunity|deal)\b|\b(status|stage)\s+of\b|\bwhat(?:'s|\s+is)\s+the\s+status\b/i;

/**
 * Build a question PEM's existing intent parser will treat as record_lookup.
 * Only used when the original question wouldn't fire PEM but entity resolution
 * already extracted a person name (GHL opportunity collision class / content search).
 */
export function adaptQuestionForPemLookup(question: string, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return question;
  if (/\b(pem|neat)\b/i.test(question) && detectPemIntent(question).intent === "record_lookup") {
    return question;
  }
  // Possessive + PEM triggers RECORD_SIGNAL + strong name signal.
  return `Tell me about ${trimmed}'s PEM`;
}

function isContentSeeking(input: {
  entity: { semantic?: { lookupSpecificity?: string | null; questionType?: string } | null };
}): boolean {
  const semantic = input.entity.semantic;
  return Boolean(semantic && semantic.lookupSpecificity === "content_search");
}

export const pemEvidenceSource: EvidenceSource = {
  key: "pem_neat",

  canHandle(input) {
    if (input.entity.skipEntityLookup) {
      return { plausible: false, confidence: 0 };
    }
    const semantic = input.entity.semantic;
    const contentSeeking = isContentSeeking(input);

    if (isSemanticRoutingConfident(semantic) && semantic!.questionType === "entity_lookup") {
      const guess = semantic!.entityTypeGuess;
      if (guess === "pem_prospect") {
        // Content-seeking about a named PEM prospect must outrank Slack/KB soft paths.
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
        // Content-seeking nudges confidence up so PEM is tried before Slack fallback.
        const base = contentSeeking ? 0.86 : Math.min(0.78, Math.max(0.65, semantic!.confidence));
        return {
          plausible: true,
          confidence: contentSeeking ? Math.max(base, semantic!.confidence) : base,
        };
      }
    }

    // Content-search specificity without a confident entity_lookup packet — still claim PEM
    // when a name was extracted (registry entity resolution may have filled extractedName).
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

    // Collision class: person named via GHL opportunity patterns / entity candidates
    const pemCandidate = input.entity.candidates.find((c) => c.type === "pem_prospect" && c.name);
    const name = pemCandidate?.name || input.entity.extractedName;
    if (
      name &&
      (OPPORTUNITY_OR_STATUS.test(input.question) ||
        /\b(project|information|info|details)\b/i.test(input.question))
    ) {
      return { plausible: true, confidence: 0.7 };
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
    const contentSeeking = isContentSeeking(input);

    if (intent.intent === "none" && name) {
      // Adapt only for content-seeking or the GHL-opportunity collision class.
      // Avoid prospect-index scans on every named question (answer-path latency).
      const shouldTryAdapt =
        contentSeeking ||
        OPPORTUNITY_OR_STATUS.test(input.question) ||
        input.priorMisses.includes("ghl");
      if (!shouldTryAdapt) {
        return null;
      }

      const index = await buildPemProspectIndex({ includeNeedsRegeneration: true }).catch(() => []);
      if (hasConfidentProspectMatch(name, index)) {
        resolutionQuestion = adaptQuestionForPemLookup(input.question, name);
      } else {
        return null;
      }
    }

    const pemEvidence = await retrievePemEvidence({
      // Adapted question drives intent/record resolution.
      question: resolutionQuestion,
      // Original wording scores transcript/assessment passages.
      contentSearchQuestion: contentSeeking ? input.question : undefined,
      history: input.history,
      role: input.role,
      channel: input.channel,
      conversationMetadata: input.conversationMetadata,
      contentSeeking,
    }).catch(() => null);

    if (!pemEvidence) return null;

    if (pemEvidence.clarification) {
      // "couldn't find a completed PEM" after GHL also missed → soft if other sources remain;
      // treat as clarification when it's disambiguation / choose-which.
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

    // Content searched but no passages — soft miss so KB/Slack can still answer.
    // Do not short-circuit; keep the honest note on diagnostics for answer composition.
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
        // Content hits must clear the registry short-circuit threshold (≥0.7) so Slack
        // does not preempt a NEAT that actually contains the answer.
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
