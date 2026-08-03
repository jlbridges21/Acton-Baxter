/**
 * Rulebook evidence source wrapper — detectRulebookIntent / retrieveRulebookEvidence unchanged.
 */

import { detectRulebookIntent, retrieveRulebookEvidence } from "@/lib/rulebook/evidence";
import type { EvidenceSource, EvidenceSourceResult } from "../types";

export const rulebookEvidenceSource: EvidenceSource = {
  key: "rulebook",

  canHandle(input) {
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
