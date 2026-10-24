/**
 * The Global Search provider contract. See docs/global-search/providers.md for the
 * registration convention.
 *
 * A provider owns one domain. It declares what it searches, who may use it, and how it
 * finds records; the engine handles timeouts, ranking, safety, and the response format.
 */

import "server-only";

import type { MatchDoc } from "./rank";
import type { SearchContext } from "./context";
import type {
  AuthClassification,
  Freshness,
  SearchCategoryId,
  SearchResultAction,
  SourceSystem,
} from "./types";

/** A searchable field. Restricted fields can never be enabled by an admin. */
export type SearchableField = {
  key: string;
  label: string;
  /** standard: may be toggled by an admin. restricted: never searchable or displayed. */
  sensitivity: "standard" | "restricted";
  defaultEnabled: boolean;
};

/** What a provider returns per record; the engine scores, highlights, and validates it. */
export type ProviderHit = {
  recordId: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  breadcrumb?: string[];
  url: string;
  icon?: string;
  avatarUrl?: string | null;
  updatedAt?: string | null;
  preview?: Array<{ label: string; value: string | null | undefined }>;
  actions?: SearchResultAction[];
  auth: AuthClassification;
  /** Text used for ranking. Must contain only fields this viewer may see. */
  match: MatchDoc;
  /** When the source already matched the query (e.g. a CRM API), keep hits ranking can't explain. */
  sourceMatched?: boolean;
  address?: {
    line1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  };
  boost?: { recent?: boolean; pinned?: boolean; uses?: number };
  /** Per-record freshness (e.g. a cached row's own sync time); defaults to the provider's. */
  freshness?: Freshness;
};

export type ProviderSearchInput = {
  query: string;
  limit: number;
  offset: number;
  /** Admin-enabled searchable field keys (already intersected with the approved list). */
  fields: Set<string>;
  synonyms: Map<string, string[]>;
  signal: AbortSignal;
};

export type ProviderSearchOutput = {
  hits: ProviderHit[];
  /** True when the source has more than it returned (drives "See all"). */
  hasMore?: boolean;
  freshness?: Freshness;
};

export type Availability = { available: boolean; reason?: string };

/** Index documents for providers with `indexing: "index"`. */
export type IndexDoc = {
  recordId: string;
  title: string;
  subtitle?: string | null;
  /** Normalized searchable text (approved fields only — never sensitive values). */
  searchText: string;
  identifiers?: string[];
  address?: string | null;
  url: string;
  /** Retrieval-time filters: null = any role / any user. */
  aclRoles?: string[] | null;
  aclUsers?: string[] | null;
  /** Every listed capability must be held (e.g. "reports:general"). */
  aclCapabilities?: string[];
  recordUpdatedAt?: string | null;
};

export type SearchProvider = {
  id: string;
  category: SearchCategoryId;
  name: string;
  icon: string;
  sourceSystem: SourceSystem;
  description: string;
  searchableFields: SearchableField[];
  /** Optional filters the provider understands (shown on the admin page). */
  filters?: Array<{ key: string; label: string }>;
  /** Optional providers can be disabled by an admin; core ones cannot. */
  optional: boolean;
  /** registry: in-process list; live: queried per search; index: global_search_index. */
  indexing: "registry" | "live" | "index";
  /** Human description of the permission rule (admin page + docs). */
  permissionSummary: string;
  minQueryLength: number;
  timeoutMs: number;
  /** Server-side gate: false hides the provider (and its category) entirely. */
  canUse(ctx: SearchContext): Promise<boolean>;
  /** Connection / configuration state. Unavailable providers report status, never "no results". */
  availability(): Promise<Availability>;
  search(ctx: SearchContext, input: ProviderSearchInput): Promise<ProviderSearchOutput>;
  /** Re-authorize specific records (recents, pinned items). Returns only what ctx may see. */
  lookup?(ctx: SearchContext, recordIds: string[], query?: string): Promise<ProviderHit[]>;
  /** Items for the empty-query view. */
  emptyState?(ctx: SearchContext): Promise<ProviderHit[]>;
  /** Index lifecycle (indexing: "index"). */
  indexer?: {
    /** Minutes between scheduled refreshes. */
    refreshMinutes: number;
    /** Every current record as an index document (full refresh; missing rows are deleted). */
    fetchAll(): Promise<IndexDoc[]>;
  };
};
