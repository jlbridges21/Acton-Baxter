import type { LucideIcon } from "lucide-react";

import { isAdminRole, isAppAccessRole } from "@/lib/auth/roles";
import {
  getAdminNavLinks,
  getAdminNavSections,
  type AdminNavSection,
} from "@/lib/baxter/admin-nav";
import { EMPLOYEE_NAV, navLinksFor } from "@/lib/navigation/registry";

export type AppNavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

/**
 * Persistent primary nav for the standard app-access role (`user`).
 * Always the same items — not context-scoped by pathname. Derived from the canonical page
 * registry (src/lib/navigation/registry.ts), which also feeds Global Search.
 */
export function getEmployeeNavLinks(): AppNavLink[] {
  return navLinksFor(EMPLOYEE_NAV, false);
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
