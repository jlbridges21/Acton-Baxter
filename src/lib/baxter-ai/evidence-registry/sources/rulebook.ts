/**
 * Rulebook evidence source wrapper — detectRulebookIntent / retrieveRulebookEvidence unchanged.
 */

import { detectRulebookIntent, retrieveRulebookEvidence } from "@/lib/rulebook/evidence";
import { isSemanticRoutingConfident } from "@/lib/baxter-ai/semantic-question-classification";
import type { EvidenceSource, EvidenceSourceResult } from "../types";

export const rulebookEvidenceSource: EvidenceSource = {
  key: "rulebook",

  canHandle(input) {
    if (input.entity.skipEntityLookup) {
      return { plausible: false, confidence: 0 };
    }
    const semantic = input.entity.semantic;
    if (isSemanticRoutingConfident(semantic) && semantic!.questionType === "entity_lookup") {
      if (semantic!.entityTypeGuess === "rulebook_step_or_role") {
        return {
          plausible: true,
          confidence: Math.max(0.88, semantic!.confidence),
        };
      }
      if (
        semantic!.entityTypeGuess === "ghl_contact" ||
        semantic!.entityTypeGuess === "ghl_opportunity" ||
        semantic!.entityTypeGuess === "pem_prospect"
      ) {
        return { plausible: false, confidence: 0 };
      }
    }
    const intent = detectRulebookIntent(input.question);
    if (intent === "none") return { plausible: false, confidence: 0 };
    return { plausible: true, confidence: 0.8 };
  },

  async resolve(input): Promise<EvidenceSourceResult | null> {
    const items = await retrieveRulebookEvidence(input.question).catch(() => []);
    if (!items.length) return null;
    return {
      items,
      confidence: 0.8,
      intentLabel: detectRulebookIntent(input.question),
    };
  },
};
