import type { LucideIcon } from "lucide-react";
import { BookOpen, Cloud, ClipboardList, FolderKanban, House, UsersRound } from "lucide-react";

export type BaxterTool = {
  key: string;
  name: string;
  description: string;
  href: string;
  /** Preferred create/start route when different from href. */
  createHref?: string;
  enabled: boolean;
  adminOnly?: boolean;
  icon: LucideIcon;
  ctaLabel: string;
  aliases?: string[];
  /**
   * Admin-facing route/copy for tools that have a separate full-featured admin surface.
   * Admins never get the reduced employee view of these tools.
   */
  adminHref?: string;
  adminCreateHref?: string;
  adminDescription?: string;
};

/**
 * Registry of Baxter platform tools.
 * Only enabled tools appear as actionable cards on the Baxter Dashboard.
 */
export const BAXTER_TOOLS: BaxterTool[] = [
  {
    key: "property-research",
    name: "Property Research Tool",
    description: "Research property, parcel, zoning, and planning information for PEM preparation.",
    href: "/dashboard",
    createHref: "/reports/new",
    enabled: true,
    icon: House,
    ctaLabel: "Open Property Research",
    aliases: ["property research", "property reports", "zoning", "parcel"],
  },
  {
    key: "pem-neat",
    name: "Partnership Evaluation Meeting NEAT",
    description:
      "Turn a PEM transcript into sales intelligence, coaching, follow-up, and project handoff data.",
    href: "/pem-neats",
    createHref: "/pem-neats/new",
    enabled: true,
    icon: ClipboardList,
    ctaLabel: "Open PEM NEAT",
    aliases: ["pem", "neat", "pem neat", "sales meeting", "transcript", "buildertrend handoff"],
  },
  {
    key: "project-setup",
    name: "New Project Setup",
    description:
      "Set up a new project from a GoHighLevel customer: Master Log, Drive folder, charter, charter list, and Slack channel + kickoff (after confirmation; web or /new-project).",
    href: "/projects/setup",
    createHref: "/projects/setup",
    enabled: true,
    icon: FolderKanban,
    ctaLabel: "Start project setup",
    aliases: ["project setup", "new project", "feasibility package", "project number"],
  },
  {
    key: "customer-dossier",
    name: "Customer Center",
    description:
      "See everything Baxter already knows about one customer across GoHighLevel, PEM NEAT, and Project Setup — read-only.",
    href: "/customers/lookup",
    createHref: "/customers/lookup",
    enabled: true,
    icon: UsersRound,
    ctaLabel: "Open Customer Center",
    aliases: ["customer center", "customer dossier", "dossier", "customer profile", "full picture"],
  },
  {
    key: "knowledge-center",
    name: "Knowledge Center",
    description:
      "Browse approved Acton knowledge and submit drafts for admin review before Baxter can use them.",
    href: "/knowledge",
    createHref: "/knowledge/new",
    adminHref: "/admin/knowledge",
    adminCreateHref: "/admin/knowledge/new",
    adminDescription:
      "Search, approve, upload, and manage everything Baxter uses when answering employees.",
    enabled: true,
    icon: BookOpen,
    ctaLabel: "Open Knowledge Center",
    aliases: ["knowledge", "knowledge center", "knowledge base", "wiki"],
  },
];

/** Admin-only platform cards (not employee tools). */
export const BAXTER_ADMIN_CARDS = [
  {
    key: "integrations",
    name: "Integrations",
    description:
      "Google Workspace, Slack, and other connectors Baxter uses for knowledge and chat.",
    href: "/admin/connectors",
    ctaLabel: "Open Integrations",
    icon: Cloud,
  },
] as const;

export function getEnabledBaxterTools(options?: { isAdmin?: boolean }): BaxterTool[] {
  const isAdmin = options?.isAdmin ?? false;
  return BAXTER_TOOLS.filter((tool) => {
    if (!tool.enabled) return false;
    if (tool.adminOnly && !isAdmin) return false;
    return true;
  }).map((tool) => (isAdmin ? resolveAdminSurface(tool) : tool));
}

function resolveAdminSurface(tool: BaxterTool): BaxterTool {
  if (!tool.adminHref && !tool.adminCreateHref && !tool.adminDescription) return tool;
  return {
    ...tool,
    href: tool.adminHref ?? tool.href,
    createHref: tool.adminCreateHref ?? tool.createHref,
    description: tool.adminDescription ?? tool.description,
  };
}

export type NavContext =
  | "platform"
  | "property-research"
  | "pem-neat"
  | "project-setup"
  | "customer-dossier"
  | "knowledge"
  | "platform-admin";

export function getNavContext(pathname: string): NavContext {
  if (pathname.startsWith("/admin/knowledge") || pathname.startsWith("/knowledge")) {
    return "knowledge";
  }
  if (pathname.startsWith("/admin")) return "platform-admin";
  if (pathname === "/dashboard" || pathname.startsWith("/reports")) {
    return "property-research";
  }
  if (pathname.startsWith("/pem-neats")) {
    return "pem-neat";
  }
  if (pathname.startsWith("/projects/setup")) {
    return "project-setup";
  }
  if (pathname.startsWith("/customers")) {
    return "customer-dossier";
  }
  return "platform";
}
