import type { LucideIcon } from "lucide-react";
import { BookOpen, House } from "lucide-react";

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
    name: "Knowledge Base",
    description:
      "Manage the approved procedures, policies, and institutional knowledge Baxter will use when answering employees.",
    href: "/admin/knowledge",
    ctaLabel: "Manage Knowledge",
    icon: BookOpen,
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
  if (pathname.startsWith("/admin/knowledge")) return "knowledge";
  if (pathname.startsWith("/admin")) return "platform-admin";
  if (pathname === "/dashboard" || pathname.startsWith("/reports")) {
    return "property-research";
  }
  return "platform";
}
