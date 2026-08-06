export {
  SUPPORTED_JURISDICTION_KEYS,
  SUPPORTED_JURISDICTIONS,
  detectJurisdictionKeyFromText,
  getJurisdictionDisplayName,
  isSupportedJurisdictionKey,
  resolveJurisdictionKey,
  resolveJurisdictionKeyFromReport,
  type SupportedJurisdiction,
  type SupportedJurisdictionKey,
} from "./keys";

export {
  JURISDICTION_RULE_KEYS,
  JURISDICTION_RULE_KEY_CATALOG,
  defaultUnitForRuleKey,
  getJurisdictionRuleKeyLabel,
  isKnownJurisdictionRuleKey,
  isValidJurisdictionRuleKey,
  type KnownJurisdictionRuleKey,
  type JurisdictionRuleKeyMeta,
} from "./rule-keys";

export {
  KNOWLEDGE_DOC_KINDS,
  type AduCodeHighlights,
  type AduCodeHighlightsDocument,
  type AduCodeHighlightsRule,
  type JurisdictionRule,
  type JurisdictionRuleValueJson,
  type JurisdictionRuleWriteInput,
  type KnowledgeDocKind,
} from "./types";

export {
  associateKnowledgeEntrySchema,
  jurisdictionRuleUpdateSchema,
  jurisdictionRuleWriteSchema,
  knowledgeDocKindSchema,
} from "./schemas";

export {
  createJurisdictionRule,
  deleteJurisdictionRule,
  getJurisdictionRule,
  listJurisdictionRules,
  resetJurisdictionRulesMemoryForTests,
  updateJurisdictionRule,
} from "./rules-store";

export {
  buildAduCodeHighlights,
  formatJurisdictionRuleValue,
  isCodeDocumentEntry,
  listCodeDocumentsForJurisdiction,
} from "./code-highlights";

export { selectRulesForZoning } from "./select-rules";

export {
  buildJurisdictionRuleContextItems,
  looksLikeBuildingCodeQuestion,
  resolveChatJurisdictionKey,
} from "./chat";
