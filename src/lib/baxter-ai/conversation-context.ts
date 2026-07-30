/**
 * Conversation context policy for Baxter (Prompt 3).
 *
 * True follow-ups inherit prior entities; new subjects / aggregations / time filters reset them.
 */

import type { BaxterHistoryMessage } from "./types";

export type ConversationContextDecision = {
  inheritPriorEntities: boolean;
  reason: string;
  isFollowUp: boolean;
  isNewSubject: boolean;
  isAggregation: boolean;
  hasTimeFilter: boolean;
  hasPronounReference: boolean;
};

/** Pronouns / incomplete references that usually mean a true follow-up. */
const PRONOUN_FOLLOW_UP =
  /\b(she|he|they|them|their|her|his|it|that|those|these)\b|\bwhat about (the |that )?(cost|margin|close|date|agreement|project)\b|\band (the |its |her |his )?(cost|margin|close|date|amount)\b|\bwhen did (she|he|they|it)\b|\btell me more\b|\bthe same\b|\bthat project\b|\bthat one\b/i;

/** Phrases that look like follow-ups but must NOT inherit (e.g. "this year"). */
const FALSE_PRONOUN_CONTEXT =
  /\bthis (year|month|week|quarter)\b|\blast (year|month|week|quarter)\b|\byear to date\b|\bytd\b|\btrailing\b|\bsince\b|\bin 20\d{2}\b|\bq[1-4]\b/i;

/** Aggregation / company totals. */
const AGGREGATION_INTENT =
  /\bhow much (have|did|do) we\b|\bhow many (projects|contracts|deals|pems?|meetings|pem meetings)\b|\bnumber of (pems?|meetings|projects)\b|\btotal (sales|agreement|sold)\b|\baverage agreement\b|\bwe sold\b|\bsold this (year|month)\b|\bsold (in|during)\b|\bkpi\b|\bconversion rate\b/i;

/** Clear new-subject / company-wide questions. */
const NEW_SUBJECT =
  /\bhow much (have|did|do) we (sold|sell)\b|\bwhat (is|are) (our|the)\b|\bwho (manages|handles|owns)\b|\bfeasibility process\b|\bpermitting process\b|\bwarranty\b|\bbuild ready process\b|\bhow many (projects|contracts|pems?|meetings)\b|\bwhat happens\b|\bexplain\b|\bwhat was our kpi\b/i;

const TIME_FILTER =
  /\b(this year|last year|this month|last month|year to date|ytd|trailing 12|since |in 20\d{2}|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

/**
 * Decide whether prior conversation entities should be inherited for retrieval.
 */
export function decideConversationContext(
  question: string,
  history: BaxterHistoryMessage[],
): ConversationContextDecision {
  const trimmed = question.trim();
  if (!trimmed || history.length === 0) {
    return {
      inheritPriorEntities: false,
      reason: "no_history",
      isFollowUp: false,
      isNewSubject: false,
      isAggregation: false,
      hasTimeFilter: false,
      hasPronounReference: false,
    };
  }

  const hasTimeFilter = TIME_FILTER.test(trimmed) || FALSE_PRONOUN_CONTEXT.test(trimmed);
  const isAggregation = AGGREGATION_INTENT.test(trimmed);
  const isNewSubject = NEW_SUBJECT.test(trimmed);
  const rawPronoun = PRONOUN_FOLLOW_UP.test(trimmed);
  // "this year" etc. must not count as pronoun follow-up
  const hasPronounReference = rawPronoun && !FALSE_PRONOUN_CONTEXT.test(trimmed);

  // Explicit new person/customer name that differs from prior (simple heuristic)
  const priorUser = [...history]
    .reverse()
    .find((m) => m.role === "user" && m.content.trim().length > 0);
  const newName = trimmed.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/);
  const priorHadName = priorUser?.content.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/);
  const explicitNewEntity =
    Boolean(newName?.[1]) &&
    Boolean(priorHadName?.[1]) &&
    newName![1]!.toLowerCase() !== priorHadName![1]!.toLowerCase();

  if (
    isAggregation ||
    (hasTimeFilter && !hasPronounReference) ||
    isNewSubject ||
    explicitNewEntity
  ) {
    return {
      inheritPriorEntities: false,
      reason: isAggregation
        ? "aggregation_resets_entity"
        : hasTimeFilter
          ? "time_filter_new_scope"
          : explicitNewEntity
            ? "new_entity_named"
            : "new_subject",
      isFollowUp: false,
      isNewSubject: true,
      isAggregation,
      hasTimeFilter,
      hasPronounReference,
    };
  }

  if (hasPronounReference) {
    return {
      inheritPriorEntities: true,
      reason: "pronoun_follow_up",
      isFollowUp: true,
      isNewSubject: false,
      isAggregation,
      hasTimeFilter,
      hasPronounReference: true,
    };
  }

  // Short incomplete questions often follow up
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 5 && /\b(cost|margin|close|date|agreement|amount|project)\b/i.test(trimmed)) {
    return {
      inheritPriorEntities: true,
      reason: "short_field_follow_up",
      isFollowUp: true,
      isNewSubject: false,
      isAggregation,
      hasTimeFilter,
      hasPronounReference: false,
    };
  }

  return {
    inheritPriorEntities: false,
    reason: "standalone_question",
    isFollowUp: false,
    isNewSubject: false,
    isAggregation,
    hasTimeFilter,
    hasPronounReference: false,
  };
}

import { isReservedConceptName } from "@/lib/baxter/concept-vocabulary";

/**
 * Extract likely person entities from a prior user question for follow-up inheritance.
 */
export function extractPriorEntitiesFromHistory(history: BaxterHistoryMessage[]): string[] {
  const priorUser = [...history]
    .reverse()
    .find((m) => m.role === "user" && m.content.trim().length > 0);
  if (!priorUser) return [];
  const matches = priorUser.content.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) ?? [];
  return Array.from(
    new Set(matches.map((m) => m.trim()).filter((m) => !isReservedConceptName(m))),
  ).slice(0, 3);
}

const UNDERSPECIFIED_FIELD =
  /\b(margin|gross margin|cost|close date|agreement(?: amount)?|contract value|internal cost)\b/i;
const NAMED_ENTITY = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/;

/**
 * Field-only questions with no inherited/named entity need clarification
 * (e.g. after /clear: "What was the margin?").
 */
export function needsEntityClarification(question: string, inheritEntities: string[]): boolean {
  const trimmed = question.trim();
  if (!trimmed) return false;
  if (inheritEntities.length > 0) return false;
  if (NAMED_ENTITY.test(trimmed)) return false;
  if (AGGREGATION_INTENT.test(trimmed) || NEW_SUBJECT.test(trimmed) || TIME_FILTER.test(trimmed)) {
    return false;
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 10) return false;
  return UNDERSPECIFIED_FIELD.test(trimmed);
}

export const ENTITY_CLARIFICATION_PROMPT =
  "Which project or customer are you asking about? For example, tell me the customer name and I’ll look up the margin, cost, or close date.";
