/**
 * Canonical registry of Baxter pages, tools, and settings.
 *
 * One list drives three surfaces:
 *   - the header menu (employee nav + grouped admin nav) — src/lib/baxter/app-nav-links.ts,
 *     src/lib/baxter/admin-nav.ts
 *   - the dashboard tool cards — entries with `toolKey` link to BAXTER_TOOLS (card copy lives
 *     there and is joined here, never duplicated)
 *   - Global Search (Tools & Pages, Settings) — src/lib/search/providers/navigation.ts
 *
 * Adding a page: add one entry below. To show it in the header, add its id to
 * EMPLOYEE_NAV or an ADMIN_NAV section. Anything with `audience: "admin"` or a `requires`
 * check is filtered on the server before Global Search returns it.
 *
 * Client-safe: no server imports. Permission checks named in `requires` are evaluated by
 * the search context (src/lib/search/context.ts).
 */

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  BookMarked,
  BookOpen,
  Bot,
  Briefcase,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Cloud,
  Database,
  FolderKanban,
  House,
  Landmark,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  MessageCircle,
  MessageSquare,
  Orbit,
  Package,
  Palette,
  Plug,
  QrCode,
  Receipt,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  Table,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";
import { PROCESS_MONITORING_UI_ENABLED } from "@/lib/baxter/feature-flags";
import { BAXTER_TOOLS, FLOOR_PLAN_LIBRARY_URL, type BaxterTool } from "@/lib/baxter/tools";

export const NAV_ICONS = {
  "bar-chart": BarChart3,
  bell: Bell,
  "book-marked": BookMarked,
  "book-open": BookOpen,
  bot: Bot,
  briefcase: Briefcase,
  "check-square": CheckSquare,
  "clipboard-check": ClipboardCheck,
  "clipboard-list": ClipboardList,
  cloud: Cloud,
  database: Database,
  "folder-kanban": FolderKanban,
  house: House,
  landmark: Landmark,
  "layout-dashboard": LayoutDashboard,
  "layout-template": LayoutTemplate,
  "list-checks": ListChecks,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  orbit: Orbit,
  package: Package,
  palette: Palette,
  plug: Plug,
  "qr-code": QrCode,
  receipt: Receipt,
  rocket: Rocket,
  search: Search,
  settings: Settings,
  "shield-check": ShieldCheck,
  stethoscope: Stethoscope,
  table: Table,
  "user-cog": UserCog,
  users: Users,
  "users-round": UsersRound,
} satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;

/**
 * Extra server-side checks beyond role. Each is evaluated against existing authorization
 * (Reports → Dexter access policies, Sam Operations → leadership/HR roles).
 */
export type NavRequirement =
  | "reports" // getReportsAccess().canUse
  | "reports_admin" // getReportsAccess().isAdmin
  | "ops_full" // Sam Operations full view (CEO/COO/HR admin, or an app admin configuring it)
  | "ops_view_all"; // CEO, COO, or HR administrator

export type NavEntry = {
  id: string;
  label: string;
  href: string;
  icon: NavIconName;
  /** tool: a dashboard tool; page: a destination; setting: configuration. */
  kind: "tool" | "page" | "setting";
  description: string;
  /** Extra words people type for this page (searched, never displayed). */
  keywords?: string[];
  /** Links to BAXTER_TOOLS for card copy and aliases. */
  toolKey?: string;
  /** Parent entry id, shown as a breadcrumb in search. */
  parentId?: string;
  /** Who may see the entry at all. Admin entries never reach other roles. */
  audience: "all" | "admin";
  requires?: NavRequirement;
  match?: (pathname: string) => boolean;
  /** Overrides when the viewer is an admin (separate full-featured admin surface). */
  admin?: Partial<Pick<NavEntry, "href" | "label" | "icon" | "description" | "match">>;
  /** Hidden from every surface (feature flag). */
  hidden?: boolean;
};

const starts = (prefix: string) => (pathname: string) => pathname.startsWith(prefix);
const exactOrUnder = (path: string) => (pathname: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

export const NAV_ENTRIES: NavEntry[] = [
  // ---- Tools -------------------------------------------------------------------------------
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/",
    icon: "layout-dashboard",
    kind: "page",
    description: "Baxter home: your tools and Ask Baxter.",
    keywords: ["home", "start"],
    audience: "all",
    match: (pathname) => pathname === "/",
  },
  {
    id: "knowledge",
    label: "Knowledge Center",
    href: "/knowledge",
    icon: "book-open",
    kind: "tool",
    toolKey: "knowledge-center",
    description: "Browse approved Acton knowledge and submit drafts.",
    audience: "all",
    match: starts("/knowledge"),
    admin: {
      href: "/admin/knowledge",
      match: (pathname) => pathname.startsWith("/admin/knowledge") || pathname === "/knowledge",
    },
  },
  {
    id: "ai-workspace",
    label: "AI Workspace",
    href: "/ai",
    icon: "bot",
    kind: "page",
    description: "Baxter's AI team: agents, tasks, approvals, and the AI Office.",
    keywords: ["agents", "ai office", "workforce"],
    audience: "all",
    match: exactOrUnder("/ai"),
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: "bar-chart",
    kind: "tool",
    description: "Dexter Reports: saved reports, groups, and templates built on JobTread data.",
    keywords: ["dexter", "jobtread", "analytics", "dashboards"],
    audience: "all",
    requires: "reports",
    match: exactOrUnder("/reports"),
  },
  {
    id: "pem-neat",
    label: "PEM NEAT",
    href: "/pem-neats",
    icon: "clipboard-list",
    kind: "tool",
    toolKey: "pem-neat",
    description: "Partnership Evaluation Meeting transcripts, coaching, and handoff.",
    audience: "all",
    match: starts("/pem-neats"),
  },
  {
    id: "project-setup",
    label: "New Project Setup",
    href: "/projects/setup",
    icon: "folder-kanban",
    kind: "tool",
    toolKey: "project-setup",
    description: "Set up a new project from a GoHighLevel customer.",
    audience: "all",
    match: starts("/projects/setup"),
  },
  {
    id: "receipts",
    label: "Receipt Log",
    href: "/receipts",
    icon: "receipt",
    kind: "tool",
    toolKey: "receipt-log",
    description: "Log a job receipt or expense from your phone.",
    audience: "all",
    match: starts("/receipts"),
  },
  {
    id: "receipt-log",
    label: "Receipt Log",
    href: "/receipts/log",
    icon: "clipboard-list",
    kind: "page",
    description: "Every logged receipt across jobs (admin view).",
    keywords: ["expenses", "receipts admin"],
    audience: "admin",
    match: (pathname) => pathname === "/receipts/log" || pathname.startsWith("/receipts/log/"),
  },
  {
    id: "my-receipts",
    label: "My receipts",
    href: "/receipts/mine",
    icon: "receipt",
    kind: "page",
    parentId: "receipts",
    description: "Receipts you have logged.",
    audience: "all",
  },
  {
    id: "inspections",
    label: "Site Inspections",
    href: "/inspections",
    icon: "clipboard-check",
    kind: "tool",
    toolKey: "site-inspections",
    description: "Field checklists by project with photos and notes.",
    audience: "all",
    match: starts("/inspections"),
  },
  {
    id: "inspection-templates",
    label: "Inspection templates",
    href: "/inspections/templates",
    icon: "list-checks",
    kind: "setting",
    parentId: "inspections",
    description: "Manage site inspection checklist templates.",
    audience: "admin",
  },
  {
    id: "inventory",
    label: "Inventory",
    href: "/inventory",
    icon: "package",
    kind: "tool",
    toolKey: "inventory",
    description: "Ordered items and where they are.",
    audience: "all",
    match: exactOrUnder("/inventory"),
  },
  {
    id: "property-research",
    label: "Property Research",
    href: "/property-research",
    icon: "search",
    kind: "tool",
    toolKey: "property-research",
    description: "Parcel, zoning, and planning research for PEM preparation.",
    audience: "all",
    match: (pathname) => pathname.startsWith("/property-research") || pathname === "/dashboard",
  },
  {
    id: "customer-center",
    label: "Customer Center",
    href: "/customers/lookup",
    icon: "users-round",
    kind: "tool",
    toolKey: "customer-dossier",
    description: "Everything Baxter knows about one customer, read-only.",
    keywords: ["gohighlevel", "ghl", "crm", "contacts"],
    audience: "all",
    match: starts("/customers"),
  },
  {
    id: "jurisdictions",
    label: "Jurisdictions & Codes",
    href: "/admin/jurisdictions",
    icon: "landmark",
    kind: "setting",
    description: "Jurisdiction connectors and building codes.",
    audience: "admin",
    match: starts("/admin/jurisdictions"),
  },
  {
    id: "expense-jobs",
    label: "Expense Jobs",
    href: "/admin/expense-jobs",
    icon: "receipt",
    kind: "setting",
    description: "Jobs receipts can be logged against.",
    audience: "admin",
    match: starts("/admin/expense-jobs"),
  },
  {
    id: "floor-plans",
    label: "Floor Plan Library",
    href: FLOOR_PLAN_LIBRARY_URL,
    icon: "layout-template",
    kind: "tool",
    toolKey: "floor-plan-library",
    description: "Acton floor plans with pricing (opens a separate app).",
    audience: "all",
  },
  {
    id: "qr",
    label: "QR Code",
    href: "/tools/qr",
    icon: "qr-code",
    kind: "tool",
    toolKey: "qr-code",
    description: "Make a QR code from a link or message.",
    audience: "all",
    match: starts("/tools/qr"),
  },
  {
    id: "tours",
    label: "Tours",
    href: "/tours",
    icon: "orbit",
    kind: "tool",
    toolKey: "tours",
    description: "360° virtual tours from panorama photos.",
    audience: "all",
    match: exactOrUnder("/tours"),
  },
  {
    id: "surveys",
    label: "Surveys",
    href: "/surveys",
    icon: "clipboard-list",
    kind: "tool",
    toolKey: "surveys",
    description: "Create surveys, share a link, and see results.",
    audience: "all",
    match: exactOrUnder("/surveys"),
  },
  {
    id: "integrations",
    label: "Integrations",
    href: "/settings/integrations",
    icon: "plug",
    kind: "setting",
    description: "Connect personal services such as Slack Search.",
    keywords: ["slack", "connect"],
    audience: "all",
    match: starts("/settings/integrations"),
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: "settings",
    kind: "setting",
    description: "Your account settings.",
    keywords: ["account", "profile"],
    audience: "all",
    match: (pathname) => pathname === "/settings" || pathname.startsWith("/settings/account"),
  },

  // ---- Connectors (admin) ------------------------------------------------------------------
  {
    id: "connectors",
    label: "Connectors",
    href: "/admin/connectors",
    icon: "cloud",
    kind: "setting",
    description: "Company connectors: Google Workspace, GoHighLevel, and more.",
    keywords: ["integrations"],
    audience: "admin",
    match: starts("/admin/connectors"),
  },
  {
    id: "connector-ghl",
    label: "GoHighLevel connector",
    href: "/admin/connectors/ghl",
    icon: "cloud",
    kind: "setting",
    parentId: "connectors",
    description: "GoHighLevel connection, capabilities, contacts, and pipelines.",
    keywords: ["ghl", "highlevel", "crm"],
    audience: "admin",
  },
  {
    id: "connector-google",
    label: "Google Workspace connector",
    href: "/admin/connectors/google",
    icon: "cloud",
    kind: "setting",
    parentId: "connectors",
    description: "Google Drive knowledge sync.",
    keywords: ["drive", "google"],
    audience: "admin",
  },
  {
    id: "slack",
    label: "Slack",
    href: "/admin/slack",
    icon: "message-circle",
    kind: "setting",
    description: "Baxter in Slack: channels, users, and conversations.",
    audience: "admin",
    match: starts("/admin/slack"),
  },

  // ---- AI Workspace ------------------------------------------------------------------------
  {
    id: "ai-agents",
    label: "AI agents",
    href: "/ai/agents",
    icon: "bot",
    kind: "page",
    parentId: "ai-workspace",
    description: "Every agent on Baxter's AI team.",
    audience: "all",
  },
  {
    id: "ai-tasks",
    label: "AI tasks",
    href: "/ai/tasks",
    icon: "check-square",
    kind: "page",
    parentId: "ai-workspace",
    description: "Tasks you have given Baxter's agents.",
    keywords: ["workflows", "jobs"],
    audience: "all",
  },
  {
    id: "ai-approvals",
    label: "Approvals",
    href: "/ai/approvals",
    icon: "shield-check",
    kind: "page",
    parentId: "ai-workspace",
    description: "Agent actions waiting for human approval.",
    audience: "all",
  },
  {
    id: "ai-onboarding",
    label: "Onboarding",
    href: "/ai/onboarding",
    icon: "list-checks",
    kind: "page",
    parentId: "ai-workspace",
    description: "Employee onboarding checklists.",
    keywords: ["new hire", "hr"],
    audience: "all",
  },
  {
    id: "sam-operations",
    label: "Sam Operations",
    href: "/ai/operations",
    icon: "briefcase",
    kind: "page",
    parentId: "ai-workspace",
    description: "HR, administration, and legal operations run by Sam.",
    keywords: ["hr", "bamboohr", "bamboo", "operations", "sam", "onboarding", "offboarding"],
    audience: "all",
  },
  {
    id: "bamboohr-employees",
    label: "Employees (BambooHR)",
    href: "/ai/operations?tab=employees",
    icon: "users",
    kind: "page",
    parentId: "sam-operations",
    description: "Employee directory information from BambooHR (read-only).",
    keywords: ["bamboohr", "bamboo", "employees", "hr", "directory", "staff"],
    audience: "all",
    requires: "ops_view_all",
  },
  {
    id: "bamboohr-settings",
    label: "BambooHR settings",
    href: "/ai/operations?tab=integrations",
    icon: "plug",
    kind: "setting",
    parentId: "sam-operations",
    description: "BambooHR connection, scopes, and field access for Sam.",
    keywords: ["bamboohr", "bamboo", "hr", "integration", "oauth"],
    audience: "all",
    requires: "ops_full",
  },
  {
    id: "ai-mission-control",
    label: "Mission Control",
    href: "/ai/mission-control",
    icon: "rocket",
    kind: "page",
    parentId: "ai-workspace",
    description: "Live view of what Baxter's agents are doing.",
    audience: "all",
  },
  {
    id: "ai-knowledge",
    label: "Agent knowledge",
    href: "/ai/knowledge",
    icon: "book-marked",
    kind: "setting",
    parentId: "ai-workspace",
    description: "Documents each agent may use.",
    audience: "admin",
  },
  {
    id: "reports-catalog",
    label: "Data Catalog",
    href: "/reports/catalog",
    icon: "database",
    kind: "page",
    parentId: "reports",
    description: "Every JobTread field Reports can use, and what it means.",
    keywords: ["fields", "jobtread", "columns"],
    audience: "all",
    requires: "reports",
  },
  {
    id: "reports-settings",
    label: "Reports data settings",
    href: "/reports/settings",
    icon: "settings",
    kind: "setting",
    parentId: "reports",
    description: "JobTread connection, sync, and field governance.",
    keywords: ["jobtread", "sync", "custom fields"],
    audience: "admin",
    requires: "reports_admin",
  },

  // ---- AI Governance (admin) ---------------------------------------------------------------
  {
    id: "governance",
    label: "Governance",
    href: "/admin/baxter/governance",
    icon: "settings",
    kind: "setting",
    description: "Baxter governance settings.",
    audience: "admin",
    match: starts("/admin/baxter/governance"),
  },
  {
    id: "rulebook",
    label: "Process Rulebook",
    href: "/admin/baxter/rulebook",
    icon: "book-marked",
    kind: "setting",
    description: "Acton process rules Baxter follows.",
    audience: "admin",
    match: starts("/admin/baxter/rulebook"),
  },
  {
    id: "monitoring",
    label: "Process Monitoring",
    href: "/admin/baxter/monitoring",
    icon: "bell",
    kind: "page",
    description: "Process monitoring findings.",
    audience: "admin",
    match: starts("/admin/baxter/monitoring"),
    hidden: !PROCESS_MONITORING_UI_ENABLED,
  },
  {
    id: "master-project-log",
    label: "Master Project Log",
    href: "/admin/baxter/projects",
    icon: "table",
    kind: "page",
    description: "The Master Project Log.",
    audience: "admin",
    match: starts("/admin/baxter/projects"),
  },
  {
    id: "evaluations",
    label: "Evaluations",
    href: "/admin/baxter/evaluations",
    icon: "rocket",
    kind: "page",
    description: "Baxter answer evaluations.",
    audience: "admin",
    match: starts("/admin/baxter/evaluations"),
  },
  {
    id: "feedback",
    label: "Feedback",
    href: "/admin/baxter/feedback",
    icon: "message-square",
    kind: "page",
    description: "Feedback on Baxter answers.",
    audience: "admin",
    match: starts("/admin/baxter/feedback"),
  },
  {
    id: "launch-readiness",
    label: "Launch Ready",
    href: "/admin/baxter/launch-readiness",
    icon: "rocket",
    kind: "page",
    description: "Launch readiness checks.",
    audience: "admin",
    match: starts("/admin/baxter/launch-readiness"),
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    href: "/admin/baxter/diagnostics",
    icon: "stethoscope",
    kind: "page",
    description: "Baxter diagnostics.",
    audience: "admin",
    match: starts("/admin/baxter/diagnostics"),
  },
  {
    id: "global-search-admin",
    label: "Global Search",
    href: "/admin/search",
    icon: "search",
    kind: "setting",
    description: "Search providers, indexing, synonyms, and performance.",
    keywords: ["search", "index", "reindex", "synonyms"],
    audience: "admin",
    match: starts("/admin/search"),
  },

  // ---- People & Org (admin) ----------------------------------------------------------------
  {
    id: "users",
    label: "Users",
    href: "/admin/users",
    icon: "users",
    kind: "setting",
    description: "Baxter users and roles.",
    keywords: ["roles", "access", "permissions"],
    audience: "admin",
    match: starts("/admin/users"),
  },
  {
    id: "schema",
    label: "Schema",
    href: "/admin/schema",
    icon: "database",
    kind: "page",
    description: "Database schema diagram.",
    audience: "admin",
    match: starts("/admin/schema"),
  },
  {
    id: "branding",
    label: "Branding",
    href: "/admin/branding",
    icon: "palette",
    kind: "setting",
    description: "Logo and company branding.",
    audience: "admin",
    match: starts("/admin/branding"),
  },
  {
    id: "project-setup-settings",
    label: "Project Setup Settings",
    href: "/admin/project-setup",
    icon: "folder-kanban",
    kind: "setting",
    description: "Project Setup configuration.",
    audience: "admin",
    match: starts("/admin/project-setup"),
  },
  {
    id: "inventory-settings",
    label: "Inventory settings",
    href: "/admin/inventory-settings",
    icon: "package",
    kind: "setting",
    description: "Inventory statuses and storage locations.",
    audience: "admin",
    match: starts("/admin/inventory-settings"),
  },
  {
    id: "knowledge-sources",
    label: "Knowledge sources",
    href: "/admin/knowledge/sources",
    icon: "book-open",
    kind: "setting",
    parentId: "knowledge",
    description: "Where Knowledge Center content comes from.",
    audience: "admin",
  },
  {
    id: "knowledge-settings",
    label: "Knowledge settings",
    href: "/admin/knowledge/settings",
    icon: "settings",
    kind: "setting",
    parentId: "knowledge",
    description: "Knowledge Center settings.",
    audience: "admin",
  },
  {
    id: "admin-settings",
    label: "Settings",
    href: "/admin/settings",
    icon: "settings",
    kind: "setting",
    description: "Platform settings and diagnostics.",
    keywords: ["admin settings", "platform"],
    audience: "admin",
    match: (pathname) => pathname === "/admin/settings" || pathname.startsWith("/admin/settings/"),
  },
];

/** Header order for the standard `user` role (persistent, not context-scoped). */
export const EMPLOYEE_NAV: string[] = [
  "dashboard",
  "knowledge",
  "ai-workspace",
  "reports",
  "pem-neat",
  "project-setup",
  "receipts",
  "inspections",
  "inventory",
  "property-research",
  "customer-center",
  "floor-plans",
  "qr",
  "tours",
  "surveys",
  "integrations",
  "settings",
];

/** Grouped admin header. Desktop shows the first five Tools links. */
export const ADMIN_NAV: Array<{ id: string; label: string; entries: string[] }> = [
  {
    id: "tools",
    label: "Tools",
    entries: [
      "dashboard",
      "knowledge",
      "property-research",
      "pem-neat",
      "customer-center",
      "reports",
      "jurisdictions",
      "expense-jobs",
      "receipt-log",
      "inspections",
      "inventory",
      "project-setup",
      "floor-plans",
      "qr",
      "tours",
      "surveys",
    ],
  },
  { id: "connectors", label: "Connectors", entries: ["connectors", "slack"] },
  {
    id: "governance",
    label: "AI Governance",
    entries: [
      "ai-workspace",
      "governance",
      "rulebook",
      "monitoring",
      "master-project-log",
      "evaluations",
      "feedback",
      "launch-readiness",
      "diagnostics",
    ],
  },
  {
    id: "people",
    label: "People & Org",
    entries: [
      "users",
      "schema",
      "branding",
      "project-setup-settings",
      "inventory-settings",
      "admin-settings",
    ],
  },
];

const BY_ID = new Map(NAV_ENTRIES.map((e) => [e.id, e]));

export function getNavEntry(id: string): NavEntry | undefined {
  return BY_ID.get(id);
}

/** The entry as a given viewer sees it (admin overrides applied). */
export function resolveNavEntry(entry: NavEntry, isAdmin: boolean): NavEntry {
  return isAdmin && entry.admin ? { ...entry, ...entry.admin } : entry;
}

export function navTool(entry: NavEntry): BaxterTool | undefined {
  return entry.toolKey ? BAXTER_TOOLS.find((t) => t.key === entry.toolKey) : undefined;
}

export function isExternalHref(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://");
}

export type ResolvedNavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

export function toNavLink(entry: NavEntry): ResolvedNavLink {
  const link: ResolvedNavLink = {
    href: entry.href,
    label: entry.label,
    icon: NAV_ICONS[entry.icon],
  };
  if (entry.match) link.match = entry.match;
  return link;
}

export function navLinksFor(ids: string[], isAdmin: boolean): ResolvedNavLink[] {
  return ids
    .map((id) => BY_ID.get(id))
    .filter((e): e is NavEntry => Boolean(e) && !e!.hidden)
    .map((e) => toNavLink(resolveNavEntry(e, isAdmin)));
}

/** Entries visible to a role before `requires` checks (those run on the server). */
export function navEntriesForRole(isAdmin: boolean): NavEntry[] {
  return NAV_ENTRIES.filter((e) => !e.hidden && (e.audience === "all" || isAdmin)).map((e) =>
    resolveNavEntry(e, isAdmin),
  );
}
