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
export {
  classifyQuestionSemantically,
  shouldSkipSemanticClassification,
  isSemanticRoutingConfident,
  isGenericEntityLookup,
  shouldOfferEntitySourceMenu,
  looksLikeOpenEndedEntityInfoAsk,
  SEMANTIC_ROUTING_CONFIDENCE_THRESHOLD,
} from "@/lib/baxter-ai/semantic-question-classification";
export type {
  SemanticQuestionClassification,
  SemanticQuestionType,
  SemanticEntityTypeGuess,
  SemanticLookupSpecificity,
} from "@/lib/baxter-ai/semantic-question-classification";
export {
  decideEntitySourceClarifyingMenu,
  probeEntitySourceAvailability,
} from "./entity-source-menu";
export type { EntitySourceAvailability } from "./entity-source-menu";
