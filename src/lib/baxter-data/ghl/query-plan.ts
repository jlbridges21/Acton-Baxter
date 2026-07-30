/**
 * Canonical GHL query plan — deterministic before retrieval.
 */
import {
  detectRequestedGhlFields,
  isContactField,
  isOpportunityField,
  isPronounOrStopwordName,
  looksLikePronounFollowUp,
  primaryRequestedField,
  type GhlRequestedField,
} from "./field-aliases";
import { detectGhlIntent, type GhlIntentType } from "@/lib/baxter-ai/ghl-intent";
import { isGhlConversationLookupQuestion } from "./conversation-intent";
import type { GhlConversationContext } from "./conversation-state";

function normalizeQuestion(question: string): string {
  return question
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export type GhlQueryPlan = {
  intent: GhlIntentType | "conversation_lookup";
  entityName: string | null;
  entityEmail: string | null;
  entityPhone: string | null;
  entityContactId: string | null;
  requestedFields: GhlRequestedField[];
  primaryField: GhlRequestedField;
  followupEntityInherited: boolean;
  explicitNewEntity: boolean;
  needsEntityClarification: boolean;
  diagnostics: {
    resolutionMethod: string;
    activeEntityInherited: boolean;
    candidateHint: string | null;
  };
};

function stripOpportunityNoise(name: string): string {
  return name
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\b(opportunity|deal|project|pipeline|stage)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a deterministic plan for GHL retrieval this turn.
 */
export function buildGhlQueryPlan(input: {
  question: string;
  activeGhl?: GhlConversationContext | null;
}): GhlQueryPlan {
  const question = normalizeQuestion(input.question);
  const intent = detectGhlIntent(question);
  const requestedFields = detectRequestedGhlFields(question);
  const primaryField = primaryRequestedField(requestedFields);

  let entityName = intent.entities.contactName || intent.entities.opportunityName || null;
  let entityEmail = intent.entities.contactEmail || null;
  const entityPhone = intent.entities.contactPhone || null;
  let entityContactId: string | null = null;
  let followupEntityInherited = false;
  let explicitNewEntity = Boolean(entityName || entityEmail || entityPhone);
  let needsEntityClarification = false;
  let resolutionMethod = "intent_entities";

  if (entityName) {
    entityName = stripOpportunityNoise(entityName);
    if (isPronounOrStopwordName(entityName)) {
      entityName = null;
      explicitNewEntity = false;
    }
  }

  // Inherit active contact on pronoun / field-only follow-ups
  const pronounFollowUp = looksLikePronounFollowUp(question);
  const active = input.activeGhl?.contact;
  if (
    !entityName &&
    !entityEmail &&
    !entityPhone &&
    active?.id &&
    active.displayName &&
    (pronounFollowUp ||
      requestedFields.some((f) => isContactField(f) || isOpportunityField(f)) ||
      isGhlConversationLookupQuestion(question) ||
      intent.intent === "opportunity_lookup" ||
      intent.intent === "contact_lookup" ||
      intent.intent === "conversation_lookup")
  ) {
    entityName = active.displayName;
    entityContactId = active.id;
    entityEmail = active.email ?? null;
    followupEntityInherited = true;
    resolutionMethod = "active_entity_inherit";
  }

  // Pronoun ask with no active entity → clarify
  if (pronounFollowUp && !followupEntityInherited && !entityName && !entityEmail && !entityPhone) {
    needsEntityClarification = true;
    resolutionMethod = "pronoun_no_active_entity";
  }

  // Prefer conversation lookup when that intent wins
  let planIntent: GhlQueryPlan["intent"] = intent.intent;
  if (isGhlConversationLookupQuestion(question) || intent.intent === "conversation_lookup") {
    planIntent = "conversation_lookup";
  } else if (requestedFields.some(isOpportunityField) || intent.intent === "opportunity_lookup") {
    planIntent = "opportunity_lookup";
  } else if (requestedFields.some(isContactField) || intent.intent === "contact_lookup") {
    planIntent = "contact_lookup";
  }

  // New named person resets inheritance flag for diagnostics
  if (explicitNewEntity && active?.displayName) {
    const named = (entityName || "").toLowerCase();
    const prior = active.displayName.toLowerCase();
    if (named && named !== prior && !prior.includes(named) && !named.includes(prior)) {
      followupEntityInherited = false;
      entityContactId = null; // resolve fresh
      resolutionMethod = "explicit_new_entity";
    }
  }

  return {
    intent: planIntent,
    entityName,
    entityEmail,
    entityPhone,
    entityContactId,
    requestedFields,
    primaryField,
    followupEntityInherited,
    explicitNewEntity,
    needsEntityClarification,
    diagnostics: {
      resolutionMethod,
      activeEntityInherited: followupEntityInherited,
      candidateHint: entityName || entityEmail || entityPhone,
    },
  };
}
