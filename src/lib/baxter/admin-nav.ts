import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BookOpen,
  BookMarked,
  ClipboardList,
  Cloud,
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  MessageCircle,
  Palette,
  Rocket,
  Search,
  Settings,
  Stethoscope,
  Users,
  UsersRound,
} from "lucide-react";
import { PROCESS_MONITORING_UI_ENABLED } from "@/lib/baxter/feature-flags";

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

/** Grouped admin nav — used by AppNav. Flat list via getAdminNavLinks(). */
export function getAdminNavSections(): AdminNavSection[] {
  const tools: AdminNavLink[] = [
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
      label: "Customer Center",
      icon: UsersRound,
      match: (pathname) => pathname.startsWith("/customers"),
    },
    {
      href: "/admin/knowledge",
      label: "Knowledge Center",
      icon: BookOpen,
      match: (pathname) => pathname.startsWith("/admin/knowledge"),
    },
  ];

  const connectors: AdminNavLink[] = [
    {
      href: "/admin/connectors",
      label: "Connectors",
      icon: Cloud,
      match: (pathname) => pathname.startsWith("/admin/connectors"),
    },
    {
      href: "/admin/slack",
      label: "Slack",
      icon: MessageCircle,
      match: (pathname) => pathname.startsWith("/admin/slack"),
    },
  ];

  const governance: AdminNavLink[] = [
    {
      href: "/admin/baxter/governance",
      label: "Governance",
      icon: Settings,
      match: (pathname) => pathname.startsWith("/admin/baxter/governance"),
    },
    {
      href: "/admin/baxter/rulebook",
      label: "Process Rulebook",
      icon: BookMarked,
      match: (pathname) => pathname.startsWith("/admin/baxter/rulebook"),
    },
    {
      href: "/admin/baxter/monitoring",
      label: "Process Monitoring",
      icon: Bell,
      match: (pathname) => pathname.startsWith("/admin/baxter/monitoring"),
    },
    {
      href: "/admin/baxter/evaluations",
      label: "Evaluations",
      icon: Rocket,
      match: (pathname) => pathname.startsWith("/admin/baxter/evaluations"),
    },
    {
      href: "/admin/baxter/feedback",
      label: "Feedback",
      icon: MessageSquare,
      match: (pathname) => pathname.startsWith("/admin/baxter/feedback"),
    },
    {
      href: "/admin/baxter/launch-readiness",
      label: "Launch Ready",
      icon: Rocket,
      match: (pathname) => pathname.startsWith("/admin/baxter/launch-readiness"),
    },
    {
      href: "/admin/baxter/diagnostics",
      label: "Diagnostics",
      icon: Stethoscope,
      match: (pathname) => pathname.startsWith("/admin/baxter/diagnostics"),
    },
  ];

  const people: AdminNavLink[] = [
    {
      href: "/admin/users",
      label: "Users",
      icon: Users,
      match: (pathname) => pathname.startsWith("/admin/users"),
    },
    {
      href: "/admin/branding",
      label: "Branding",
      icon: Palette,
      match: (pathname) => pathname.startsWith("/admin/branding"),
    },
    {
      href: "/admin/project-setup",
      label: "Project Setup Settings",
      icon: FolderKanban,
      match: (pathname) => pathname.startsWith("/admin/project-setup"),
    },
    {
      href: "/admin/settings",
      label: "Settings",
      icon: Settings,
      match: (pathname) =>
        pathname === "/admin/settings" || pathname.startsWith("/admin/settings/"),
    },
  ];

  const filterMonitoring = (links: AdminNavLink[]) =>
    PROCESS_MONITORING_UI_ENABLED
      ? links
      : links.filter((link) => link.href !== "/admin/baxter/monitoring");

  return [
    { id: "tools", label: "Tools", links: tools },
    { id: "connectors", label: "Connectors", links: connectors },
    { id: "governance", label: "AI Governance", links: filterMonitoring(governance) },
    { id: "people", label: "People & Org", links: people },
  ];
}

/** Flat admin nav (same links as sections) — used by tests and compact desktop strip. */
export function getAdminNavLinks(): AdminNavLink[] {
  return getAdminNavSections().flatMap((section) => section.links);
}
