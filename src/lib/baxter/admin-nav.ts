import type { LucideIcon } from "lucide-react";
import { ADMIN_NAV, navLinksFor } from "@/lib/navigation/registry";

export type AdminNavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

export type AdminNavSection = {
  id: string;
  label: string;
  links: AdminNavLink[];
};

/**
 * Grouped admin nav — used by AppNav. Flat list via getAdminNavLinks().
 * Derived from the canonical page registry (src/lib/navigation/registry.ts); hidden entries
 * (feature flags such as Process Monitoring) are dropped there.
 */
export function getAdminNavSections(): AdminNavSection[] {
  // Desktop primary strip shows the first 5 Tools links for admins.
  return ADMIN_NAV.map((section) => ({
    id: section.id,
    label: section.label,
    links: navLinksFor(section.entries, true),
  }));
}

/** Flat admin nav (same links as sections) — used by tests and compact desktop strip. */
export function getAdminNavLinks(): AdminNavLink[] {
  return getAdminNavSections().flatMap((section) => section.links);
}
