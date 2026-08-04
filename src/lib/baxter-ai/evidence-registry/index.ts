export { resolveQuestionEntity } from "./entity-resolution";
export { isPlausibleCrmEntityCandidate, isBaxterMetaHowtoQuestion } from "./entity-plausibility";
export type { EntityCandidate, EntityResolutionResult, EntityType } from "./entity-resolution";
export {
  mostRecentEntitySource,
  preferredSourceForFollowUp,
  readEntityArbitration,
  writeEntityArbitration,
} from "./conversation-arbitration";
export type { EntityArbitrationRecord, PreferredEntitySource } from "./conversation-arbitration";
export { runEvidenceRegistry } from "./orchestrate";
export { adaptQuestionForPemLookup } from "./sources/pem";
export type {
  EvidenceSource,
  EvidenceSourceKey,
  EvidenceSourceResult,
  RegistryEarlyAnswer,
  RegistryRunResult,
} from "./types";
