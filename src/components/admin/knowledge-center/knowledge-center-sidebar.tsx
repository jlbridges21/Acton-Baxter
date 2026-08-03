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
  | "governance";

const NAV_ALL: Array<{
  view: KnowledgeCenterView;
  label: string;
  href: string;
  icon: typeof BookOpen;
}> = [
  { view: "all", label: "Knowledge", href: "/admin/knowledge", icon: BookOpen },
  { view: "recent", label: "Recent", href: "/admin/knowledge?view=recent", icon: Clock },
  {
    view: "google",
    label: "Google Workspace",
    href: "/admin/connectors/google",
    icon: Cloud,
  },
  {
    view: "uploads",
    label: "Uploads",
    href: "/admin/knowledge?view=uploads",
    icon: FileUp,
  },
  { view: "drafts", label: "Drafts", href: "/admin/knowledge?view=drafts", icon: PenLine },
  {
    view: "approved",
    label: "Approved",
    href: "/admin/knowledge?view=approved",
    icon: CheckCircle2,
  },
  {
    view: "archived",
    label: "Archived",
    href: "/admin/knowledge?view=archived",
    icon: Archive,
  },
  {
    view: "failed",
    label: "Failed Imports",
    href: "/admin/knowledge?view=failed",
    icon: FileWarning,
  },
  {
    view: "sources",
    label: "Sources",
    href: "/admin/knowledge/sources",
    icon: Library,
  },
  {
    view: "health",
    label: "Connector Health",
    href: "/admin/connectors/google",
    icon: Activity,
  },
  {
    view: "rulebook",
    label: "Process Rulebook",
    href: "/admin/baxter/rulebook",
    icon: BookMarked,
  },
  {
    view: "monitoring",
    label: "Process Monitoring",
    href: "/admin/baxter/monitoring",
    icon: Bell,
  },
  {
    view: "governance",
    label: "Baxter Governance",
    href: "/admin/baxter/governance",
    icon: Shield,
  },
  {
    view: "settings",
    label: "Knowledge Settings",
    href: "/admin/knowledge/settings",
    icon: Settings,
  },
];

const NAV = PROCESS_MONITORING_UI_ENABLED
  ? NAV_ALL
  : NAV_ALL.filter((item) => item.view !== "monitoring");

export function KnowledgeCenterSidebar({ activeView }: { activeView?: KnowledgeCenterView }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewParam = (searchParams.get("view") as KnowledgeCenterView | null) ?? "all";

  function isActive(item: (typeof NAV)[number]) {
    if (activeView) return activeView === item.view;
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
    if (pathname === "/admin/knowledge" || pathname.startsWith("/admin/knowledge?")) {
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
      {NAV.map((item) => {
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
