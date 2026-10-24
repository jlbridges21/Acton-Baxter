/**
 * Global Search — the standard result contract shared by every provider, the API, and the UI.
 * Client-safe: no server imports.
 */

export const SEARCH_CATEGORIES = [
  { id: "tools", label: "Tools & Pages", icon: "layout-dashboard" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "agents", label: "AI Agents", icon: "bot" },
  { id: "reports", label: "Reports", icon: "bar-chart" },
  { id: "customers", label: "Customers", icon: "users-round" },
  { id: "opportunities", label: "Opportunities", icon: "briefcase" },
  { id: "jobs", label: "Jobs", icon: "folder-kanban" },
  { id: "employees", label: "Employees", icon: "users" },
  { id: "knowledge", label: "Knowledge", icon: "book-open" },
  { id: "inventory", label: "Inventory", icon: "package" },
  { id: "inspections", label: "Site Inspections", icon: "clipboard-check" },
  { id: "tasks", label: "AI Tasks", icon: "check-square" },
] as const;

export type SearchCategoryId = (typeof SEARCH_CATEGORIES)[number]["id"];

export const CATEGORY_IDS = SEARCH_CATEGORIES.map((c) => c.id) as SearchCategoryId[];

export function categoryLabel(id: string): string {
  return SEARCH_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export type SourceSystem =
  | "baxter"
  | "gohighlevel"
  | "jobtread"
  | "bamboohr"
  | "dexter_reports"
  | "ai_registry"
  | "knowledge"
  | "inventory"
  | "inspections";

export const SOURCE_LABELS: Record<SourceSystem, string> = {
  baxter: "Baxter",
  gohighlevel: "GoHighLevel",
  jobtread: "JobTread",
  bamboohr: "BambooHR",
  dexter_reports: "Dexter Reports",
  ai_registry: "AI Agent Registry",
  knowledge: "Knowledge Center",
  inventory: "Inventory",
  inspections: "Site Inspections",
};

/**
 * How a result was authorized:
 *   internal   — any approved Baxter user may see it
 *   role       — limited by role (admin, Reports access, Sam Operations role)
 *   record     — checked per record (owner, share, draft author)
 *   sensitive  — HR / CRM personal data: role-limited and audited
 */
export type AuthClassification = "internal" | "role" | "record" | "sensitive";

/**
 * Match tiers, best first. Contextual boosts (recent, pinned, frequent) only reorder results
 * inside a tier, so they can never outrank a better match.
 */
export const MATCH_TIERS = [
  "exact",
  "identifier",
  "prefix",
  "contact",
  "address",
  "field",
  "fuzzy",
  "description",
] as const;
export type MatchTier = (typeof MATCH_TIERS)[number];

export type HighlightRange = [start: number, end: number];

export type Freshness =
  | { kind: "live" }
  | { kind: "registry" }
  | { kind: "cached"; syncedAt: string | null; label: string };

export type SearchResultAction =
  | {
      kind: "copy";
      label: string;
      value: string;
      /** What is copied, so the UI can use a distinct icon (phone vs email vs generic). */
      field?: "phone" | "email";
    }
  | { kind: "open"; label: string; href: string; external?: boolean }
  | { kind: "pin_report"; label: string; reportId: string; pinned: boolean };

export type SearchResult = {
  /** Stable key: `${provider}:${recordId}`. */
  id: string;
  provider: string;
  category: SearchCategoryId;
  title: string;
  subtitle: string | null;
  description: string | null;
  breadcrumb: string[];
  highlight: { title: HighlightRange[]; subtitle: HighlightRange[] };
  url: string;
  external: boolean;
  /** Icon name from NAV_ICONS / category icons. */
  icon: string;
  avatarUrl: string | null;
  sourceSystem: SourceSystem;
  sourceLabel: string;
  recordId: string;
  updatedAt: string | null;
  freshness: Freshness;
  /** Small label → value pairs shown under the row (already authorized, never sensitive). */
  preview: Array<{ label: string; value: string }>;
  auth: AuthClassification;
  actions: SearchResultAction[];
  tier: MatchTier;
  score: number;
  /** Normalized address key when the result has an address (for cross-source grouping). */
  addressKey: string | null;
  addressDisplay: string | null;
};

export type ProviderStatus =
  "ok" | "empty" | "timeout" | "error" | "unavailable" | "rate_limited" | "skipped";

export type ProviderOutcome = {
  provider: string;
  name: string;
  category: SearchCategoryId;
  status: ProviderStatus;
  /** Safe, user-facing explanation (never internal error text). */
  message: string | null;
  count: number;
  hasMore: boolean;
  latencyMs: number;
  freshness: Freshness;
};

export type AddressGroup = {
  key: string;
  display: string;
  resultIds: string[];
  sources: string[];
};

/** NDJSON stream events from GET /api/search. */
export type SearchStreamEvent =
  | {
      type: "start";
      query: string;
      providers: Array<{ provider: string; name: string; category: SearchCategoryId }>;
    }
  | { type: "provider"; outcome: ProviderOutcome; results: SearchResult[] }
  | {
      type: "done";
      tookMs: number;
      addressGroups: AddressGroup[];
      askBaxter: boolean;
    }
  | { type: "error"; code: string; message: string };

export type CategoryAvailability = {
  id: SearchCategoryId;
  label: string;
  icon: string;
  /** Provider ids feeding this category. */
  providers: string[];
};

export type SearchHome = {
  categories: CategoryAvailability[];
  recent: SearchResult[];
  frequentTools: SearchResult[];
  pinnedReports: SearchResult[];
  agents: SearchResult[];
  askBaxter: boolean;
};

export const MAX_QUERY_LENGTH = 120;
export const DEFAULT_SECTION_LIMIT = 5;
export const SEE_ALL_LIMIT = 25;
