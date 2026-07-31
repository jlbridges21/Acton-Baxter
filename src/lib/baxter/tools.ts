import type { LucideIcon } from "lucide-react";
import { BookOpen, Cloud, ClipboardList, FolderKanban, House } from "lucide-react";

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
      "Prepare a new-project setup run (dry-run) from a GoHighLevel customer for human confirmation.",
    href: "/projects/setup",
    createHref: "/projects/setup",
    enabled: true,
    icon: FolderKanban,
    ctaLabel: "Start project setup",
    aliases: ["project setup", "new project", "feasibility package", "project number"],
  },
];

/** Admin-only platform cards (not employee tools). */
export const BAXTER_ADMIN_CARDS = [
  {
    key: "knowledge-base",
    name: "Knowledge Center",
    description:
      "Search, approve, upload, and manage everything Baxter uses when answering employees.",
    href: "/admin/knowledge",
    ctaLabel: "Open Knowledge Center",
    icon: BookOpen,
  },
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
  });
}

export type NavContext =
  "platform" | "property-research" | "pem-neat" | "project-setup" | "knowledge" | "platform-admin";

export function getNavContext(pathname: string): NavContext {
  if (pathname.startsWith("/admin/knowledge")) {
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
  return "platform";
}
