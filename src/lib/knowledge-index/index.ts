export { KNOWLEDGE_INDEX_VERSION } from "./types";
export type {
  KnowledgeQueryPlan,
  StructuredSearchResult,
  ParsedWorkbook,
  KnowledgeUnitRecord,
} from "./types";
export {
  parseWorkbookFromSheets,
  parseSheetGrid,
  detectHeaderRowIndex,
} from "./spreadsheet-parser";
export { planKnowledgeQuery, extractEntities } from "./query-planner";
export { searchStructuredKnowledge } from "./structured-search";
export {
  buildStructuredEvidencePackage,
  structuredHitsToContextItems,
  draftDirectStructuredAnswer,
} from "./evidence";
export { indexKnowledgeEntry, reindexAllKnowledgeEntries } from "./reindex";
export { chunkDocumentContent, unitsFromWorkbook } from "./chunking";
export {
  replaceUnitsForEntry,
  listUnitsForEntry,
  listAllSpreadsheetRowUnits,
  listAllEmbeddableUnits,
  updateUnitEmbedding,
  resetKnowledgeUnitsMemoryForTests,
} from "./units-store";
export {
  embedText,
  embedTexts,
  mockEmbedText,
  cosineSimilarity,
  unitNeedsEmbedding,
  EMBEDDABLE_UNIT_TYPES,
  getEmbeddingConfig,
} from "./embeddings";
export { searchLexicalKnowledge } from "./lexical-search";
export { searchSemanticKnowledge } from "./semantic-search";
export {
  unitsFromImageAnalysis,
  unitsFromPdfPages,
  unitsFromSlides,
  extractPptxSlides,
} from "./multimodal";
export { parseCellValue, normalizeEntityText, normalizeHeaderKey } from "./values";
export { resolveFieldToHeader, inferRequestedFieldsFromQuestion } from "./aliases";
