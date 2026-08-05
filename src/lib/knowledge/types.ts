export const KNOWLEDGE_STATUSES = ["draft", "approved", "archived"] as const;
export const KNOWLEDGE_VISIBILITIES = ["internal", "admin_only"] as const;
export const KNOWLEDGE_SOURCE_TYPES = [
  "manual",
  "policy",
  "procedure",
  "process",
  "RACI",
  "Google Drive",
  "GoHighLevel",
  "Buildertrend",
  "Domo",
  "Slack",
  "uploaded_document",
  "other",
] as const;
export const KNOWLEDGE_SOURCE_STATUSES = [
  "manual",
  "configured",
  "active",
  "paused",
  "error",
  "future",
] as const;

export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type KnowledgeVisibility = (typeof KNOWLEDGE_VISIBILITIES)[number];
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];
export type KnowledgeSourceStatus = (typeof KNOWLEDGE_SOURCE_STATUSES)[number];

export type KnowledgeDocKind = "building_code" | "ordinance" | "design_guideline" | "other_code";

export type KnowledgeEntry = {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  category: string;
  tags: string[];
  source_name: string | null;
  source_type: KnowledgeSourceType;
  source_url: string | null;
  source_external_id: string | null;
  status: KnowledgeStatus;
  visibility: KnowledgeVisibility;
  /** Connector-aligned jurisdiction (e.g. ca-san-jose). Null/undefined = unscoped. */
  jurisdiction_key?: string | null;
  /** Marks building-code / ordinance documents for ADU research. */
  doc_kind?: KnowledgeDocKind | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  approved_by_name?: string | null;
};

export type KnowledgeEntryRevision = {
  id: string;
  knowledge_entry_id: string;
  version: number;
  title: string;
  content: string;
  summary: string | null;
  category: string;
  tags: string[];
  source_name: string | null;
  source_type: KnowledgeSourceType;
  source_url: string | null;
  status: KnowledgeStatus;
  visibility: KnowledgeVisibility;
  changed_by: string | null;
  change_note: string | null;
  created_at: string;
  changed_by_name?: string | null;
};

export type KnowledgeSource = {
  id: string;
  name: string;
  source_type: KnowledgeSourceType;
  description: string | null;
  status: KnowledgeSourceStatus;
  external_identifier: string | null;
  configuration_metadata: Record<string, unknown>;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  entry_count?: number;
};

export type KnowledgeSearchInput = {
  query: string;
  limit?: number;
  categories?: string[];
  tags?: string[];
  visibility?: "internal";
  /**
   * When set, exclude building-code docs tagged to a *different* jurisdiction.
   * Untagged entries and matching-jurisdiction docs remain eligible.
   */
  jurisdictionKey?: string | null;
  /** Prefer / restrict to these doc_kind values when provided. */
  docKinds?: KnowledgeDocKind[];
};

export type KnowledgeSearchResult = {
  id: string;
  title: string;
  summary: string | null;
  contentExcerpt: string;
  category: string;
  tags: string[];
  sourceName: string | null;
  sourceUrl: string | null;
  sourceType: KnowledgeSourceType;
  mimeType: string | null;
  updatedAt: string;
  relevanceScore: number;
  citationLabel: string;
};
