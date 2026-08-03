import { DEFAULT_GOVERNANCE_SECTION_CONTENT } from "./section-meta";

/**
 * Distilled Value Proposition — conditional (sales / customer messaging).
 * Compiled-in fallback — do not delete; used when DB content is unavailable.
 */
export function buildValuePropositionRuntimeBlock(): string {
  return DEFAULT_GOVERNANCE_SECTION_CONTENT.value_proposition;
}

const SALES_OR_VALUE_INTENT =
  /\b(value prop|why (choose |pick )?acton|too expensive|cheaper builder|price objection|follow[- ]?up (email|message)|customer (email|message|draft)|inquiry call|partnership evaluation|pem\b|sales (script|pitch)|what makes acton different|positioning|roi|homeowner)\b/i;

export function questionNeedsValueProposition(question: string): boolean {
  return SALES_OR_VALUE_INTENT.test(question);
}
