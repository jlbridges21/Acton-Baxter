import { DEFAULT_GOVERNANCE_SECTION_CONTENT } from "./section-meta";

/** Compiled-in fallback — do not delete; used when DB content is unavailable. */
export function buildScopeRuntimeBlock(): string {
  return DEFAULT_GOVERNANCE_SECTION_CONTENT.scope;
}

/** Compiled-in fallback — do not delete; used when DB content is unavailable. */
export function buildChangeControlRuntimeBlock(): string {
  return DEFAULT_GOVERNANCE_SECTION_CONTENT.change_control;
}

/** Compiled-in fallback — do not delete; used when DB content is unavailable. */
export function buildConfidentialityRuntimeBlock(): string {
  return DEFAULT_GOVERNANCE_SECTION_CONTENT.confidentiality;
}

/** Compiled-in fallback — do not delete; used when DB content is unavailable. */
export function buildIdentityRuntimeBlock(): string {
  return DEFAULT_GOVERNANCE_SECTION_CONTENT.identity;
}

/** Compiled-in fallback — do not delete; used when DB content is unavailable. */
export function buildStyleRuntimeBlock(): string {
  return DEFAULT_GOVERNANCE_SECTION_CONTENT.style;
}
