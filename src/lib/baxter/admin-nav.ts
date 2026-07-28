import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BookOpen,
  BookMarked,
  ClipboardList,
  Cloud,
  LayoutDashboard,
  MessageSquare,
  Palette,
  Rocket,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { PROCESS_MONITORING_UI_ENABLED } from "@/lib/baxter/feature-flags";

export type AdminNavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

/** Shared admin nav definition — used by AppNav and unit tests. */
export function getAdminNavLinks(): AdminNavLink[] {
  const links: AdminNavLink[] = [
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
      href: "/admin/knowledge",
      label: "Knowledge Center",
      icon: BookOpen,
      match: (pathname) => pathname.startsWith("/admin/knowledge"),
    },
    {
      href: "/admin/connectors",
      label: "Integrations",
      icon: Cloud,
      match: (pathname) => pathname.startsWith("/admin/connectors"),
    },
    {
      href: "/admin/users",
      label: "Users",
      icon: Users,
      match: (pathname) => pathname.startsWith("/admin/users"),
    },
    {
      href: "/pem-neats",
      label: "PEM NEAT",
      icon: ClipboardList,
      match: (pathname) => pathname.startsWith("/pem-neats"),
    },
    {
      href: "/admin/baxter/governance",
      label: "Baxter Governance",
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
      href: "/admin/branding",
      label: "Branding",
      icon: Palette,
      match: (pathname) => pathname.startsWith("/admin/branding"),
    },
    {
      href: "/admin/settings",
      label: "Settings",
      icon: Settings,
      match: (pathname) =>
        pathname === "/admin/settings" || pathname.startsWith("/admin/settings/"),
    },
  ];

  if (PROCESS_MONITORING_UI_ENABLED) return links;
  return links.filter((link) => link.href !== "/admin/baxter/monitoring");
}
