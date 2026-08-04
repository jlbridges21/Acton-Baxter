/**
 * Plausibility checks for CRM entity names extracted by GHL intent patterns.
 * Keeps the underlying regex extractors intact — only gates high-confidence claims.
 */

import { isBaxterCapabilityMetaHowto } from "@/lib/baxter/capability-intent";

const INSTRUCTIONAL_START = /^(tell|explain|show|describe|walk|help|teach|remind|ask|let|give)\b/i;

/** Question-level: how-to / “use Baxter to…” — not a CRM entity ask. */
export function isBaxterMetaHowtoQuestion(question: string): boolean {
  return isBaxterCapabilityMetaHowto(question);
}

/**
 * True when an extracted "name" looks like a real contact/opportunity label,
 * not an instructional / meta sentence fragment.
 */
export function isPlausibleCrmEntityCandidate(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) return false;

  const words = trimmed.split(" ").filter(Boolean);
  // Opportunity/contact names are short; long captures are almost always sentence fragments.
  if (words.length > 6) return false;

  // Second-person / team meta about using Baxter — never a CRM entity.
  if (
    /\b(use you|use baxter|how do i|how can we|how can they|how they can|how to use|walk me through|walk us through|the team|instead of relying|relying solely)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  if (/\b(you|yourself)\b/i.test(trimmed) && /\b(how|use|help|team|tell)\b/i.test(trimmed)) {
    return false;
  }

  // Imperative lead-ins on multi-word captures ("tell me about…", "explain how…").
  // Short proper-name-ish leftovers after cleaning are still allowed.
  if (INSTRUCTIONAL_START.test(trimmed) && words.length >= 4) {
    return false;
  }

  return true;
}
