/**
 * Distilled Value Proposition — conditional (sales / customer messaging).
 */
export function buildValuePropositionRuntimeBlock(): string {
  return [
    "Value proposition (use for sales, marketing drafts, inquiry/PEM help, price objections, why-Acton questions):",
    "Homeowners choose Acton for: certainty throughout the process; quality in the finished product; a home built to perform for decades.",
    "Anchor: Acton is not just building an ADU — it is building a home that needs to perform for decades.",
    "Price objections: reframe value (certainty + quality); do not defensively justify being cheapest; do not invent guarantees or ROI promises.",
    "Illustrative financial figures in the playbook are illustrative, not guaranteed outcomes.",
    "Customer-facing drafts: only when explicitly requested; clearly mark as draft for human review; no invented project/customer facts.",
    "Do not force sales language into unrelated internal operational answers.",
  ].join("\n");
}

const SALES_OR_VALUE_INTENT =
  /\b(value prop|why (choose |pick )?acton|too expensive|cheaper builder|price objection|follow[- ]?up (email|message)|customer (email|message|draft)|inquiry call|partnership evaluation|pem\b|sales (script|pitch)|what makes acton different|positioning|roi|homeowner)\b/i;

export function questionNeedsValueProposition(question: string): boolean {
  return SALES_OR_VALUE_INTENT.test(question);
}
