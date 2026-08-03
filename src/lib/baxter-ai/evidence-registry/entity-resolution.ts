/**
 * Central entity-resolution step.
 * Calls each source's existing extractors and returns a comparable structure —
 * does not replace GHL/PEM/Rulebook detectors.
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

export type EntityType =
  "ghl_contact" | "ghl_opportunity" | "pem_prospect" | "rulebook_step_or_role" | "none";

export type EntityCandidate = {
  type: EntityType;
  name: string | null;
  confidence: number;
  /** Which extractor produced this candidate. */
  via: "ghl" | "pem" | "rulebook" | "history" | "arbitration";
};

export type EntityResolutionResult = {
  /** Highest-confidence candidate when unambiguous; null when none or tied across types. */
  primary: EntityCandidate | null;
  candidates: EntityCandidate[];
  /** True when ≥2 different entity types score within 0.15 of each other. */
  ambiguousAcrossTypes: boolean;
  extractedName: string | null;
  isFollowUp: boolean;
};

const OPPORTUNITY_SHAPE =
  /\b(opportunity|deal|project)\b|\b(status|stage)\s+of\b|\bwhat(?:'s|\s+is)\s+going\s+on\s+with\b/i;

/**
 * Resolve what the question is centrally about, before expensive source retrieval.
 */
export function resolveQuestionEntity(input: {
  question: string;
  history?: BaxterHistoryMessage[];
  preferredSource?: PreferredEntitySource | null;
}): EntityResolutionResult {
  const question = input.question.trim();
  const history = input.history ?? [];
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
      // Insights / general CRM still GHL-scoped but not a person entity
      type = name ? "ghl_contact" : "none";
    }
    if (type !== "none") {
      candidates.push({
        type,
        name,
        confidence: ghl.confidence,
        via: "ghl",
      });
    } else if (name) {
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
    // Name extracted but PEM intent not yet record_lookup — still a soft PEM candidate
    // when the question looks person/status shaped (collision class with GHL "opportunity").
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

  // When GHL extracted a person from an opportunity-shaped question, also surface PEM
  // as a comparable candidate so arbitration can try both (the proof-point collision).
  const ghlOpp = candidates.find((c) => c.type === "ghl_opportunity" && c.name);
  if (ghlOpp?.name) {
    const existingPem = candidates.find(
      (c) => c.type === "pem_prospect" && c.name?.toLowerCase() === ghlOpp.name!.toLowerCase(),
    );
    if (existingPem) {
      // Keep within 0.15 of typical GHL opportunity confidence (0.85).
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

  candidates.sort((a, b) => b.confidence - a.confidence);

  const top = candidates[0] ?? null;
  const rival = candidates.find((c) => c.type !== top?.type);
  const ambiguousAcrossTypes = Boolean(
    top && rival && Math.abs(top.confidence - rival.confidence) <= 0.15,
  );

  const primary = !top || top.confidence < 0.4 ? null : ambiguousAcrossTypes ? null : top;

  const extractedName =
    primary?.name ||
    candidates.find((c) => c.name)?.name ||
    extractPriorEntitiesFromHistory(history)[0] ||
    null;

  return {
    primary,
    candidates,
    ambiguousAcrossTypes,
    extractedName,
    isFollowUp: ctx.isFollowUp || ctx.hasPronounReference,
  };
}
