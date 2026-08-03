import { DEFAULT_GOVERNANCE_SECTION_CONTENT } from "./section-meta";

/**
 * Distilled Acton Culture Guide — compact runtime rules.
 * Compiled-in fallback — do not delete; used when DB content is unavailable.
 */
export function buildCultureRuntimeBlock(): string {
  return DEFAULT_GOVERNANCE_SECTION_CONTENT.culture;
}
