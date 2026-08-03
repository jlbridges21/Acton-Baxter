import {
  BookOpen,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  Plug,
  Search,
  Settings,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { isAdminRole, isAppAccessRole } from "@/lib/auth/roles";
import {
  getAdminNavLinks,
  getAdminNavSections,
  type AdminNavSection,
} from "@/lib/baxter/admin-nav";

export type AppNavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

/**
 * Persistent primary nav for the standard app-access role (`user`).
 * Always the same 8 items — not context-scoped by pathname.
 */
export function getEmployeeNavLinks(): AppNavLink[] {
  return [
    {
      href: "/",
      label: "Dashboard",
      icon: LayoutDashboard,
      match: (pathname) => pathname === "/",
    },
    {
      href: "/dashboard",
      label: "Property Research",
      icon: Search,
      match: (pathname) => pathname.startsWith("/reports") || pathname === "/dashboard",
    },
    {
      href: "/pem-neats",
      label: "PEM NEAT",
      icon: ClipboardList,
      match: (pathname) => pathname.startsWith("/pem-neats"),
    },
    {
      href: "/projects/setup",
      label: "New Project Setup",
      icon: FolderKanban,
      match: (pathname) => pathname.startsWith("/projects/setup"),
    },
    {
      href: "/customers/lookup",
      label: "Customer Dossier",
      icon: UsersRound,
      match: (pathname) => pathname.startsWith("/customers"),
    },
    {
      href: "/knowledge",
      label: "Knowledge Center",
      icon: BookOpen,
      match: (pathname) => pathname.startsWith("/knowledge"),
    },
    {
      href: "/settings/integrations",
      label: "Integrations",
      icon: Plug,
      match: (pathname) => pathname.startsWith("/settings/integrations"),
    },
    {
      href: "/settings",
      label: "Settings",
      icon: Settings,
      match: (pathname) => pathname === "/settings" || pathname.startsWith("/settings/account"),
    },
  ];
}

/** Resolve visible nav links for a role — shared by AppNav and unit tests. */
export function getAppNavLinksForRole(userRole: string, _pathname = "/"): AppNavLink[] {
  if (isAdminRole(userRole)) {
    return getAdminNavLinks();
  }
  if (!isAppAccessRole(userRole)) {
    return [];
  }
  return getEmployeeNavLinks();
}

export function getAppNavSectionsForRole(userRole: string): AdminNavSection[] | null {
  if (isAdminRole(userRole)) {
    return getAdminNavSections();
  }
  return null;
}

export { getAdminNavSections };
