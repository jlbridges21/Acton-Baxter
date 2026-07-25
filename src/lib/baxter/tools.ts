import type { LucideIcon } from "lucide-react";
import { BookOpen, Cloud, House, Upload } from "lucide-react";

export type BaxterTool = {
  key: string;
  name: string;
  description: string;
  href: string;
  enabled: boolean;
  adminOnly?: boolean;
  icon: LucideIcon;
  ctaLabel: string;
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
    href: "/reports/new",
    enabled: true,
    icon: House,
    ctaLabel: "Open Property Research",
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
    key: "knowledge-upload",
    name: "Upload Documents",
    description: "Import Markdown, text, PDF, Word, CSV, or Excel files into the Knowledge Base.",
    href: "/admin/knowledge/upload",
    ctaLabel: "Upload Files",
    icon: Upload,
  },
  {
    key: "google-drive",
    name: "Google Workspace",
    description: "Connect Acton Drive, select Docs and Sheets, and keep knowledge synchronized.",
    href: "/admin/connectors/google",
    ctaLabel: "Open Google Workspace",
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

export type NavContext = "platform" | "property-research" | "knowledge" | "platform-admin";

export function getNavContext(pathname: string): NavContext {
  if (pathname.startsWith("/admin/knowledge") || pathname.startsWith("/admin/connectors/google")) {
    return "knowledge";
  }
  if (pathname.startsWith("/admin")) return "platform-admin";
  if (pathname === "/dashboard" || pathname.startsWith("/reports")) {
    return "property-research";
  }
  return "platform";
}
