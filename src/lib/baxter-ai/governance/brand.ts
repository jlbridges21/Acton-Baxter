import { DEFAULT_GOVERNANCE_SECTION_CONTENT } from "./section-meta";

/**
 * Distilled Brand Guide voice — internal teammate edition.
 * Compiled-in fallback — do not delete; used when DB content is unavailable.
 */
export function buildBrandRuntimeBlock(): string {
  return DEFAULT_GOVERNANCE_SECTION_CONTENT.brand;
}
