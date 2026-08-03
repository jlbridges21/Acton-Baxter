/**
 * PEM NEAT evidence source wrapper — retrievePemEvidence unchanged.
 * When GHL opportunity phrasing extracted a person name but PEM intent is "none",
 * adapt the question so PEM's existing record_lookup path can run (wrap-only).
 */

import { detectPemIntent } from "@/lib/baxter-data/pem-neats/intent";
import { retrievePemEvidence } from "@/lib/baxter-data/pem-neats/evidence";
import {
  buildPemProspectIndex,
  hasConfidentProspectMatch,
} from "@/lib/baxter-data/pem-neats/prospect-index";
import type { EvidenceSource, EvidenceSourceResult } from "../types";

const OPPORTUNITY_OR_STATUS =
  /\b(opportunity|deal)\b|\b(status|stage)\s+of\b|\bwhat(?:'s|\s+is)\s+the\s+status\b/i;

/**
 * Build a question PEM's existing intent parser will treat as record_lookup.
 * Only used when the original question wouldn't fire PEM but entity resolution
 * already extracted a person name (GHL opportunity collision class).
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

export const pemEvidenceSource: EvidenceSource = {
  key: "pem_neat",

  canHandle(input) {
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
    if (name && OPPORTUNITY_OR_STATUS.test(input.question)) {
      return { plausible: true, confidence: 0.7 };
    }

    return { plausible: false, confidence: 0 };
  },

  async resolve(input): Promise<EvidenceSourceResult | null> {
    let question = input.question;
    const intent = detectPemIntent(question);
    const name =
      input.entity.candidates.find((c) => c.type === "pem_prospect")?.name ||
      input.entity.extractedName;

    if (
      intent.intent === "none" &&
      name &&
      (OPPORTUNITY_OR_STATUS.test(question) || input.priorMisses.includes("ghl"))
    ) {
      // Cheap gate: only adapt when a saved PEM prospect matches
      const index = await buildPemProspectIndex({ includeNeedsRegeneration: true }).catch(() => []);
      if (hasConfidentProspectMatch(name, index)) {
        question = adaptQuestionForPemLookup(input.question, name);
      } else {
        return null;
      }
    }

    const pemEvidence = await retrievePemEvidence({
      question,
      history: input.history,
      role: input.role,
      channel: input.channel,
      conversationMetadata: input.conversationMetadata,
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

    if (pemEvidence.deterministicAnswer && pemEvidence.items.length > 0) {
      return {
        items: pemEvidence.items,
        deterministicAnswer: pemEvidence.deterministicAnswer,
        confidence: pemEvidence.answerMode === "not_determinable" ? 0.7 : 0.95,
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
