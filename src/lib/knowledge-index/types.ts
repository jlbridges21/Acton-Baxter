/**
 * Baxter Intelligence — structured knowledge index (Prompt 1 of 3).
 * Current parser/index version. Bump when unit shape or spreadsheet detection changes.
 */
export const KNOWLEDGE_INDEX_VERSION = 1;

export const KNOWLEDGE_UNIT_TYPES = [
  "document_section",
  "paragraph",
  "table",
  "table_row",
  "spreadsheet_sheet",
  "spreadsheet_row",
  "key_value",
  "summary",
  "summary_metrics",
  "note",
] as const;

export type KnowledgeUnitType = (typeof KNOWLEDGE_UNIT_TYPES)[number];

export type ParsedCellValue = {
  display: string;
  numeric: number | null;
  percent: number | null;
  dateIso: string | null;
  kind: "empty" | "text" | "currency" | "number" | "percent" | "date";
};

export type SpreadsheetRowRecord = {
  sheetName: string;
  sheetGid: number | null;
  tableId: string;
  rowNumber: number;
  values: Record<string, ParsedCellValue>;
  searchText: string;
  displayLines: string;
  priority: number;
};

export type SpreadsheetSummaryMetrics = {
  sheetName: string;
  metrics: Record<string, ParsedCellValue>;
  searchText: string;
  displayLines: string;
};

export type DetectedTable = {
  id: string;
  sheetName: string;
  sheetGid: number | null;
  headerRowIndex: number;
  headers: string[];
  startRow: number;
  endRow: number;
  rows: SpreadsheetRowRecord[];
  priority: number;
  warnings: string[];
};

export type ParsedWorkbook = {
  title: string;
  sheets: Array<{
    name: string;
    gid: number | null;
    rawGrid: string[][];
    tables: DetectedTable[];
    summaryMetrics: SpreadsheetSummaryMetrics[];
    notes: string[];
    warnings: string[];
  }>;
  contentText: string;
  warnings: string[];
  truncated: boolean;
};

export type KnowledgeUnitRecord = {
  id: string;
  knowledge_entry_id: string;
  unit_type: KnowledgeUnitType;
  ordinal: number;
  title: string | null;
  content: string;
  search_text: string;
  structured_data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  content_hash: string | null;
  index_version: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeQueryPlan = {
  mode: "document" | "structured_lookup" | "structured_aggregate" | "hybrid";
  entities: string[];
  requestedFields: string[];
  filters: Array<{ field: string; value: string }>;
  aggregation?: "count" | "sum" | "average" | "min" | "max" | null;
  keywords: string[];
  rawQuestion: string;
};

export type StructuredLookupHit = {
  knowledgeEntryId: string;
  entryTitle: string;
  sourceUrl: string | null;
  sheetName: string;
  sheetGid: number | null;
  rowNumber: number;
  entityLabel: string;
  requestedField: string | null;
  directValue: string | null;
  relatedValues: Record<string, string>;
  unitId: string;
  priority: number;
  score: number;
};

export type StructuredAggregateHit = {
  knowledgeEntryId: string;
  entryTitle: string;
  sourceUrl: string | null;
  operation: "count" | "sum" | "average" | "min" | "max";
  field: string | null;
  displayValue: string;
  numericValue: number | null;
  matchedRowCount: number;
  filterDescription: string;
};

export type StructuredSearchResult = {
  plan: KnowledgeQueryPlan;
  lookups: StructuredLookupHit[];
  aggregates: StructuredAggregateHit[];
  ambiguous: boolean;
  clarificationPrompt: string | null;
};
