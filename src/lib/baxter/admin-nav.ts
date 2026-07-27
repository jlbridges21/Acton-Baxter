import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  Cloud,
  LayoutDashboard,
  MessageSquare,
  Palette,
  Rocket,
  Search,
  Settings,
  Users,
} from "lucide-react";

export type AdminNavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

/** Shared admin nav definition — used by AppNav and unit tests. */
export function getAdminNavLinks(): AdminNavLink[] {
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
      href: "/admin/slack",
      label: "Slack",
      icon: MessageSquare,
      match: (pathname) => pathname.startsWith("/admin/slack"),
    },
    {
      href: "/admin/baxter/diagnostics",
      label: "Diagnostics",
      icon: Activity,
      match: (pathname) => pathname.startsWith("/admin/baxter/diagnostics"),
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
      href: "/admin/knowledge/settings",
      label: "Settings",
      icon: Settings,
      match: (pathname) => pathname.startsWith("/admin/knowledge/settings"),
    },
  ];
}
