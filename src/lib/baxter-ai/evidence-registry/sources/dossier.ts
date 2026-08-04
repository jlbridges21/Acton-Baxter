/**
 * Customer Center evidence source — broad "tell me everything" questions only.
 * Does not steal narrow GHL/PEM single-fact questions (those keep higher canHandle scores
 * on their own sources; this source returns plausible:false unless isBroadDossierQuestion).
 */

import { assembleCustomerDossier } from "@/lib/dossier/assemble";
import { formatDossierChatSummary, isBroadDossierQuestion } from "@/lib/dossier/format";
import type { EvidenceSource, EvidenceSourceResult } from "../types";

export const dossierEvidenceSource: EvidenceSource = {
  key: "customer_dossier",

  canHandle(input) {
    if (!isBroadDossierQuestion(input.question)) {
      return { plausible: false, confidence: 0 };
    }
    // High enough to short-circuit ahead of generic CRM contact_lookup on the same phrasing,
    // but only when the broad-dossier gate above passed.
    return { plausible: true, confidence: 0.94 };
  },

  async resolve(input): Promise<EvidenceSourceResult | null> {
    if (!isBroadDossierQuestion(input.question)) return null;

    const name =
      input.entity.extractedName || input.entity.candidates.find((c) => c.name)?.name || null;

    if (!name) {
      return {
        items: [],
        clarification:
          "Who should I pull up in Customer Center? Give me a customer or prospect name.",
        confidence: 0.95,
      };
    }

    try {
      const dossier = await assembleCustomerDossier({
        name,
        role: input.role,
      });

      const answer = formatDossierChatSummary(dossier);
      const now = new Date().toISOString();
      return {
        items: [
          {
            number: 1,
            id: `dossier:${dossier.identity.ghlContactId ?? name}`,
            title: `Customer Center: ${dossier.identity.displayName ?? name}`,
            summary: `Cross-system view for ${dossier.identity.displayName ?? name}`,
            contentExcerpt: answer.slice(0, 2000),
            category: "customer_dossier",
            tags: ["dossier", "customer", "customer-center"],
            sourceName: "Customer Center",
            sourceUrl: dossier.pagePath,
            sourceType: "customer_dossier",
            mimeType: null,
            updatedAt: now,
            citationLabel: "Customer Center",
            relevanceScore: 1,
          },
        ],
        deterministicAnswer: answer,
        confidence: 0.94,
        intentLabel: "customer_dossier",
      };
    } catch (err) {
      return {
        items: [],
        deterministicAnswer: `I couldn’t assemble a Customer Center view for ${name}: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        confidence: 0.5,
        softMiss: true,
      };
    }
  },
};
