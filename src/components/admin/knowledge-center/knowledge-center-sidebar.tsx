"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Archive,
  Bell,
  BookMarked,
  BookOpen,
  CheckCircle2,
  Cloud,
  FileWarning,
  FileUp,
  Library,
  Settings,
  Shield,
  Activity,
  PenLine,
  Clock,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PROCESS_MONITORING_UI_ENABLED } from "@/lib/baxter/feature-flags";

export type KnowledgeCenterView =
  | "all"
  | "recent"
  | "google"
  | "uploads"
  | "drafts"
  | "approved"
  | "archived"
  | "failed"
  | "sources"
  | "settings"
  | "health"
  | "rulebook"
  | "monitoring"
  | "governance"
  | "new";

export type KnowledgeCenterBasePath = "/admin/knowledge" | "/knowledge";

type NavItem = {
  view: KnowledgeCenterView;
  label: string;
  href: string;
  icon: typeof BookOpen;
  /** When true, only admins see this item. */
  adminOnly?: boolean;
};

/**
 * Admin-only sidebar destinations (hidden from non-admin viewers of the shared shell).
 * Explicitly: Process Rulebook, Baxter Governance, Knowledge Settings, Sources,
 * Uploads, plus other admin connector/ops views.
 */
export const KNOWLEDGE_CENTER_ADMIN_ONLY_VIEWS: KnowledgeCenterView[] = [
  "google",
  "uploads",
  "archived",
  "failed",
  "sources",
  "health",
  "rulebook",
  "monitoring",
  "governance",
  "settings",
];

function buildNavAll(basePath: KnowledgeCenterBasePath): NavItem[] {
  const listHref = basePath;
  return [
    { view: "all", label: "Knowledge", href: listHref, icon: BookOpen },
    { view: "recent", label: "Recent", href: `${listHref}?view=recent`, icon: Clock },
    {
      view: "google",
      label: "Google Workspace",
      href: "/admin/connectors/google",
      icon: Cloud,
      adminOnly: true,
    },
    {
      view: "uploads",
      label: "Uploads",
      href: `${listHref}?view=uploads`,
      icon: FileUp,
      adminOnly: true,
    },
    { view: "drafts", label: "Drafts", href: `${listHref}?view=drafts`, icon: PenLine },
    {
      view: "approved",
      label: "Approved",
      href: `${listHref}?view=approved`,
      icon: CheckCircle2,
    },
    {
      view: "archived",
      label: "Archived",
      href: `${listHref}?view=archived`,
      icon: Archive,
      adminOnly: true,
    },
    {
      view: "failed",
      label: "Failed Imports",
      href: `${listHref}?view=failed`,
      icon: FileWarning,
      adminOnly: true,
    },
    {
      view: "sources",
      label: "Sources",
      href: "/admin/knowledge/sources",
      icon: Library,
      adminOnly: true,
    },
    {
      view: "health",
      label: "Connector Health",
      href: "/admin/connectors/google",
      icon: Activity,
      adminOnly: true,
    },
    {
      view: "rulebook",
      label: "Process Rulebook",
      href: "/admin/baxter/rulebook",
      icon: BookMarked,
      adminOnly: true,
    },
    {
      view: "monitoring",
      label: "Process Monitoring",
      href: "/admin/baxter/monitoring",
      icon: Bell,
      adminOnly: true,
    },
    {
      view: "governance",
      label: "Baxter Governance",
      href: "/admin/baxter/governance",
      icon: Shield,
      adminOnly: true,
    },
    {
      view: "settings",
      label: "Knowledge Settings",
      href: "/admin/knowledge/settings",
      icon: Settings,
      adminOnly: true,
    },
  ];
}

/** Non-admin "Add New" entry point (create-as-draft). */
function addNewNavItem(newEntryHref: string): NavItem {
  return { view: "new", label: "Add New", href: newEntryHref, icon: Plus };
}

export function getKnowledgeCenterNavItems(input: {
  isAdmin: boolean;
  basePath: KnowledgeCenterBasePath;
  newEntryHref: string;
}): NavItem[] {
  let items = buildNavAll(input.basePath);
  if (!PROCESS_MONITORING_UI_ENABLED) {
    items = items.filter((item) => item.view !== "monitoring");
  }
  if (!input.isAdmin) {
    items = items.filter((item) => !item.adminOnly);
    items = [...items, addNewNavItem(input.newEntryHref)];
  }
  return items;
}

export function KnowledgeCenterSidebar({
  activeView,
  isAdmin = true,
  basePath = "/admin/knowledge",
  newEntryHref = "/admin/knowledge/new",
}: {
  activeView?: KnowledgeCenterView;
  isAdmin?: boolean;
  basePath?: KnowledgeCenterBasePath;
  newEntryHref?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewParam = (searchParams.get("view") as KnowledgeCenterView | null) ?? "all";
  const nav = getKnowledgeCenterNavItems({ isAdmin, basePath, newEntryHref });

  function isActive(item: NavItem) {
    if (activeView) return activeView === item.view;
    if (item.view === "new") {
      return pathname === newEntryHref || pathname.startsWith(`${newEntryHref}/`);
    }
    if (item.href.startsWith("/admin/connectors/google")) {
      return pathname.startsWith("/admin/connectors/google");
    }
    if (item.href.startsWith("/admin/knowledge/settings")) {
      return pathname.startsWith("/admin/knowledge/settings");
    }
    if (item.href.startsWith("/admin/knowledge/sources")) {
      return pathname.startsWith("/admin/knowledge/sources");
    }
    if (item.href.startsWith("/admin/baxter/rulebook")) {
      return pathname.startsWith("/admin/baxter/rulebook");
    }
    if (item.href.startsWith("/admin/baxter/monitoring")) {
      return pathname.startsWith("/admin/baxter/monitoring");
    }
    if (item.href.startsWith("/admin/baxter/governance")) {
      return pathname.startsWith("/admin/baxter/governance");
    }
    const onList =
      pathname === basePath ||
      pathname.startsWith(`${basePath}?`) ||
      (basePath === "/admin/knowledge" && pathname === "/admin/knowledge") ||
      (basePath === "/knowledge" && pathname === "/knowledge");
    if (onList) {
      if (item.view === "all") return !searchParams.get("view");
      return viewParam === item.view;
    }
    return false;
  }

  return (
    <nav className="space-y-1" aria-label="Knowledge Center">
      <p className="px-2 pb-2 text-[11px] font-semibold tracking-wider text-[var(--acton-muted)] uppercase">
        Knowledge Center
      </p>
      {nav.map((item) => {
        const Icon = item.icon;
        const active = isActive(item);
        return (
          <Link
            key={item.view + item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
              active
                ? "bg-[var(--acton-navy)] font-semibold text-white"
                : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
            )}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-80" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
