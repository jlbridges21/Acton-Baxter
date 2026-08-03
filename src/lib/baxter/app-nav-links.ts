import {
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  PlusCircle,
  Search,
  type LucideIcon,
} from "lucide-react";

import { isAdminRole } from "@/lib/auth/roles";
import { getAdminNavLinks } from "@/lib/baxter/admin-nav";
import { getNavContext, type NavContext } from "@/lib/baxter/tools";

export type AppNavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

function employeeLinks(context: NavContext): AppNavLink[] {
  const home: AppNavLink = {
    href: "/",
    label: "Baxter Dashboard",
    icon: LayoutDashboard,
    match: (pathname) => pathname === "/",
  };

  if (context === "property-research") {
    return [
      home,
      {
        href: "/dashboard",
        label: "Overview",
        icon: Search,
        match: (pathname) => pathname === "/dashboard",
      },
      {
        href: "/reports/new",
        label: "New Research",
        icon: PlusCircle,
        match: (pathname) => pathname === "/reports/new",
      },
    ];
  }

  if (context === "pem-neat") {
    return [
      home,
      {
        href: "/pem-neats",
        label: "PEM NEATs",
        icon: ClipboardList,
        match: (pathname) => pathname.startsWith("/pem-neats"),
      },
      {
        href: "/pem-neats/new",
        label: "Add PEM NEAT",
        icon: PlusCircle,
        match: (pathname) => pathname === "/pem-neats/new",
      },
    ];
  }

  if (context === "project-setup") {
    return [
      home,
      {
        href: "/projects/setup",
        label: "New Project Setup",
        icon: FolderKanban,
        match: (pathname) => pathname.startsWith("/projects/setup"),
      },
    ];
  }

  return [home];
}

function accountLinks(): AppNavLink[] {
  return [
    {
      href: "/settings/integrations",
      label: "Integrations",
      icon: Search,
      match: (pathname) => pathname.startsWith("/settings/"),
    },
  ];
}

/** Resolve visible nav links for a role — shared by AppNav and unit tests. */
export function getAppNavLinksForRole(userRole: string, pathname = "/"): AppNavLink[] {
  if (isAdminRole(userRole)) {
    return getAdminNavLinks();
  }
  return [...employeeLinks(getNavContext(pathname)), ...accountLinks()];
}
