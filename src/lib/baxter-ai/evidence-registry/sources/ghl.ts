/**
 * GHL evidence source wrapper — calls retrieveGhlLiveEvidence unchanged.
 * Soft-misses ("couldn't find a GHL contact") return null so the registry can try PEM/etc.
 */

import { detectGhlIntent } from "@/lib/baxter-ai/ghl-intent";
import { retrieveGhlLiveEvidence } from "@/lib/baxter-ai/ghl-runtime";
import { readGhlConversationState } from "@/lib/baxter-data/ghl/conversation-state";
import { isSemanticRoutingConfident } from "@/lib/baxter-ai/semantic-question-classification";
import type { EvidenceSource, EvidenceSourceResult } from "../types";
import { isPlausibleCrmEntityCandidate, isBaxterMetaHowtoQuestion } from "../entity-plausibility";
import {
  appendProjectSlackActivityToGhlAnswer,
  isProjectFlavoredGhlQuestion,
} from "@/lib/baxter-ai/ghl-project-slack-enrichment";

const GHL_NOT_FOUND =
  /couldn['’]t find a (?:matching )?ghl contact|couldn['’]t find a matching gohighlevel contact/i;

function isSoftMissAnswer(answer: string | null | undefined): boolean {
  if (!answer) return false;
  return GHL_NOT_FOUND.test(answer);
}

function intentEntityNames(intent: ReturnType<typeof detectGhlIntent>): string[] {
  const e = intent.entities;
  return [e.contactName, e.opportunityName, e.contactEmail].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
}

export const ghlEvidenceSource: EvidenceSource = {
  key: "ghl",

  canHandle(input) {
    if (!input.ghlConfigured) return { plausible: false, confidence: 0 };
    // Semantic non-entity routing — never claim.
    if (input.entity.skipEntityLookup) {
      return { plausible: false, confidence: 0 };
    }
    // Primary: trust confident semantic entity-type guess.
    const semantic = input.entity.semantic;
    if (isSemanticRoutingConfident(semantic) && semantic!.questionType === "entity_lookup") {
      const guess = semantic!.entityTypeGuess;
      if (guess === "ghl_contact" || guess === "ghl_opportunity") {
        return {
          plausible: true,
          confidence: Math.max(0.92, semantic!.confidence),
        };
      }
      if (guess === "pem_prospect" || guess === "rulebook_step_or_role") {
        return { plausible: false, confidence: 0 };
      }
      // unknown type but we have a real entity name — still attempt GHL (conservative: try sources).
      if (semantic!.entityName && isPlausibleCrmEntityCandidate(semantic!.entityName)) {
        return {
          plausible: true,
          confidence: Math.min(0.82, Math.max(0.7, semantic!.confidence)),
        };
      }
    }
    // Capability how-tos about Baxter itself are never CRM lookups (regex fallback path).
    if (isBaxterMetaHowtoQuestion(input.question)) {
      return { plausible: false, confidence: 0 };
    }
    const intent = detectGhlIntent(input.question);
    if (intent.intent === "none") {
      // Follow-up preference still allows GHL when CRM entity was last established
      if (input.preferredSource === "ghl" && input.entity.isFollowUp) {
        return { plausible: true, confidence: 0.85 };
      }
      return { plausible: false, confidence: 0 };
    }

    // Lookup intents that hung an entity name on an instructional/meta fragment
    // must not claim the question — keep pattern matching, drop confidence.
    const names = intentEntityNames(intent);
    const isEntityLookup =
      intent.intent === "opportunity_lookup" ||
      intent.intent === "contact_lookup" ||
      intent.intent === "conversation_lookup" ||
      intent.intent === "write_opportunity" ||
      intent.intent === "write_contact" ||
      intent.intent === "write_tag";
    if (
      isEntityLookup &&
      names.length > 0 &&
      names.every((n) => !isPlausibleCrmEntityCandidate(n))
    ) {
      return { plausible: false, confidence: 0 };
    }
    if (
      isEntityLookup &&
      names.length === 0 &&
      (intent.intent === "opportunity_lookup" || intent.intent === "contact_lookup") &&
      !intent.explicitGhl
    ) {
      // Matched opportunity/contact shape but extracted nothing usable — don't claim.
      return { plausible: false, confidence: 0 };
    }

    let confidence = intent.confidence;
    if (input.preferredSource === "ghl" && input.entity.isFollowUp) {
      confidence = Math.max(confidence, 0.95);
    }
    // Explicit GHL mention → strong claim
    if (intent.explicitGhl) confidence = Math.max(confidence, 0.92);
    // When entity resolution also has a strong PEM candidate for the same name,
    // slightly temper GHL so a miss can fall through (still tried first if higher).
    const pemRival = input.entity.candidates.find((c) => c.type === "pem_prospect");
    if (
      pemRival &&
      (intent.intent === "opportunity_lookup" || intent.intent === "contact_lookup") &&
      !intent.explicitGhl
    ) {
      confidence = Math.min(confidence, 0.84);
    }
    return { plausible: true, confidence };
  },

  async resolve(input): Promise<EvidenceSourceResult | null> {
    const activeGhl = readGhlConversationState(input.conversationMetadata);
    const entityNameHint = input.entity.extractedName;
    const ghlEvidence = await retrieveGhlLiveEvidence(input.question, {
      activeGhl,
      entityNameHint,
    }).catch(() => null);
    if (!ghlEvidence) return null;

    if (ghlEvidence.ambiguityWarning) {
      return {
        items: [],
        clarification: ghlEvidence.ambiguityWarning,
        confidence: 0.95,
        nextGhlState: ghlEvidence.nextConversationState ?? undefined,
        diagnostics: ghlEvidence.diagnostics,
        intentLabel: ghlEvidence.intent?.intent ?? null,
      };
    }

    let answer = ghlEvidence.deterministicAnswer ?? null;
    const hasItems = ghlEvidence.items.length > 0;
    const intent = ghlEvidence.intent?.intent;
    const isCrmLookup =
      intent === "contact_lookup" ||
      intent === "opportunity_lookup" ||
      intent === "conversation_lookup";

    const contactId = ghlEvidence.diagnostics?.selectedContactId ?? null;
    if (
      answer &&
      contactId &&
      !isSoftMissAnswer(answer) &&
      isProjectFlavoredGhlQuestion(input.question)
    ) {
      answer = await appendProjectSlackActivityToGhlAnswer({
        ghlAnswer: answer,
        question: input.question,
        ghlContactId: contactId,
        requester: {
          baxterUserId: input.userId ?? null,
          slackUserId: input.externalUserId ?? null,
          slackTeamId: input.slackTeamId ?? null,
        },
      }).catch(() => answer);
    }

    // Soft miss: not found — let other plausible sources try (unless exclusive GHL ask).
    if (isSoftMissAnswer(answer) && !hasItems) {
      if (!ghlEvidence.intent?.explicitGhl) {
        return {
          items: [],
          deterministicAnswer: answer,
          confidence: 0.1,
          softMiss: true,
          nextGhlState: ghlEvidence.nextConversationState ?? undefined,
          diagnostics: ghlEvidence.diagnostics,
          intentLabel: intent ?? null,
        };
      }
      // Explicit "in GHL" ask: keep the GHL not-found as the answer.
      return {
        items: [],
        deterministicAnswer: answer,
        confidence: 0.92,
        softMiss: false,
        nextGhlState: ghlEvidence.nextConversationState ?? undefined,
        diagnostics: ghlEvidence.diagnostics,
        intentLabel: intent ?? null,
      };
    }

    if (answer && (hasItems || isCrmLookup)) {
      return {
        items: ghlEvidence.items,
        deterministicAnswer: answer,
        confidence: hasItems ? 0.95 : isSoftMissAnswer(answer) ? 0.15 : 0.7,
        softMiss: isSoftMissAnswer(answer) && !hasItems,
        nextGhlState: ghlEvidence.nextConversationState ?? undefined,
        diagnostics: ghlEvidence.diagnostics,
        intentLabel: intent ?? null,
      };
    }

    if (hasItems) {
      return {
        items: ghlEvidence.items,
        deterministicAnswer: answer,
        confidence: 0.75,
        nextGhlState: ghlEvidence.nextConversationState ?? undefined,
        diagnostics: ghlEvidence.diagnostics,
        intentLabel: intent ?? null,
      };
    }

    return null;
  },
};
