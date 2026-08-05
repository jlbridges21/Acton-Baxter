import type { KnownJurisdictionRuleKey } from "./rule-keys";
import type { SupportedJurisdictionKey } from "./keys";

export const KNOWLEDGE_DOC_KINDS = [
  "building_code",
  "ordinance",
  "design_guideline",
  "other_code",
] as const;

export type KnowledgeDocKind = (typeof KNOWLEDGE_DOC_KINDS)[number];

export type JurisdictionRuleQuantityValue = {
  kind: "quantity";
  value: number;
  unit: string;
};

export type JurisdictionRuleStructuredValue = {
  kind: "structured";
  fields: Record<string, unknown>;
};

export type JurisdictionRuleValueJson =
  JurisdictionRuleQuantityValue | JurisdictionRuleStructuredValue;

export type JurisdictionRule = {
  id: string;
  jurisdiction_key: string;
  rule_key: string;
  zone_key: string | null;
  value_json: JurisdictionRuleValueJson;
  source_citation: string;
  source_knowledge_entry_id: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type JurisdictionRuleWriteInput = {
  jurisdiction_key: SupportedJurisdictionKey | string;
  rule_key: KnownJurisdictionRuleKey | string;
  zone_key?: string | null;
  value_json: JurisdictionRuleValueJson;
  source_citation: string;
  source_knowledge_entry_id?: string | null;
  notes?: string | null;
};

export type JurisdictionCodeDocument = {
  id: string;
  title: string;
  status: string;
  doc_kind: KnowledgeDocKind | null;
  jurisdiction_key: string | null;
  source_name: string | null;
  source_url: string | null;
  updated_at: string;
};

export type AduCodeHighlightsRule = {
  id: string;
  ruleKey: string;
  label: string;
  zoneKey: string | null;
  displayValue: string;
  sourceCitation: string;
  notes: string | null;
  sourceKnowledgeEntryId: string | null;
};

export type AduCodeHighlightsDocument = {
  id: string;
  title: string;
  docKind: KnowledgeDocKind | null;
  sourceName: string | null;
  sourceUrl: string | null;
  knowledgeViewerHref: string;
};

export type AduCodeHighlights = {
  jurisdictionKey: SupportedJurisdictionKey | null;
  jurisdictionName: string;
  zoning: string | null;
  /** True when zone-specific rules matched the report zoning. */
  usedZoneSpecificRules: boolean;
  /** True when we fell back to jurisdiction-general rules despite having a zone. */
  fellBackToGeneralRules: boolean;
  rules: AduCodeHighlightsRule[];
  documents: AduCodeHighlightsDocument[];
  /** No rules and no code documents configured for this jurisdiction. */
  isEmpty: boolean;
};
