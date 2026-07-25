"use client";

import Link from "next/link";
import {
  BookOpen,
  Cloud,
  FileUp,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Palette,
  PlusCircle,
  Search,
  Shield,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CompanyLogo } from "@/components/branding/company-logo";
import { Button } from "@/components/ui/button";
import { getNavContext, type NavContext } from "@/lib/baxter/tools";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type NavLink = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  match?: (pathname: string) => boolean;
};

function linksForContext(context: NavContext, isAdmin: boolean): NavLink[] {
  const home: NavLink = {
    href: "/",
    label: "Baxter Dashboard",
    icon: LayoutDashboard,
    match: (pathname) => pathname === "/",
  };

  if (context === "platform") {
    return [home];
  }

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

  if (!isAdmin) return [home];

  if (context === "knowledge") {
    return [
      home,
      {
        href: "/admin/knowledge",
        label: "Knowledge Center",
        icon: BookOpen,
        match: (pathname) =>
          pathname === "/admin/knowledge" ||
          pathname.startsWith("/admin/knowledge/settings") ||
          (/^\/admin\/knowledge\/[^/]+$/.test(pathname) &&
            !pathname.includes("/upload") &&
            !pathname.includes("/new") &&
            !pathname.includes("/sources") &&
            !pathname.includes("/edit") &&
            !pathname.includes("/history")),
      },
      {
        href: "/admin/knowledge/new",
        label: "New Entry",
        icon: PlusCircle,
        match: (pathname) => pathname === "/admin/knowledge/new",
      },
      {
        href: "/admin/knowledge/upload",
        label: "Uploads",
        icon: Upload,
        match: (pathname) => pathname.startsWith("/admin/knowledge/upload"),
      },
      {
        href: "/admin/connectors/google",
        label: "Google Workspace",
        icon: Cloud,
        match: (pathname) => pathname.startsWith("/admin/connectors/google"),
      },
    ];
  }

  // platform-admin
  return [
    home,
    {
      href: "/admin/knowledge",
      label: "Knowledge Center",
      icon: BookOpen,
      match: (pathname) => pathname.startsWith("/admin/knowledge"),
    },
    {
      href: "/admin/knowledge/upload",
      label: "Upload",
      icon: FileUp,
      match: (pathname) => pathname.startsWith("/admin/knowledge/upload"),
    },
    {
      href: "/admin/connectors/google",
      label: "Google Workspace",
      icon: Cloud,
      match: (pathname) => pathname.startsWith("/admin/connectors/google"),
    },
    {
      href: "/admin/connectors",
      label: "Connectors",
      icon: Shield,
      match: (pathname) =>
        pathname.startsWith("/admin/connectors") && !pathname.includes("/google"),
    },
    {
      href: "/admin/baxter/diagnostics",
      label: "Diagnostics",
      icon: Shield,
      match: (pathname) => pathname.startsWith("/admin/baxter/diagnostics"),
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
      icon: Shield,
      match: (pathname) => pathname.startsWith("/admin/baxter/launch-readiness"),
    },
    {
      href: "/admin/slack",
      label: "Slack",
      icon: MessageSquare,
      match: (pathname) => pathname.startsWith("/admin/slack"),
    },
    {
      href: "/admin/users",
      label: "Users",
      icon: Shield,
      match: (pathname) => pathname.startsWith("/admin/users"),
    },
    {
      href: "/admin/branding",
      label: "Branding",
      icon: Palette,
      match: (pathname) => pathname.startsWith("/admin/branding"),
    },
  ];
}

export function AppNav({
  userName,
  userRole,
  userEmail,
  logoUrl = null,
  companyName = "Acton ADU",
  logoAlt = "Acton ADU",
}: {
  userName: string;
  userRole: string;
  userEmail: string;
  logoUrl?: string | null;
  companyName?: string;
  reportTitle?: string;
  logoAlt?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = userRole === "admin";
  const context = getNavContext(pathname);
  const links = linksForContext(context, isAdmin);

  async function handleLogout() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Test bypass mode may not have a real Supabase session.
    }
    router.push("/login");
    router.refresh();
  }

  const navItems = (
    <>
      {links.map((link) => {
        const Icon = link.icon;
        const active = link.match ? link.match(pathname) : pathname === link.href;
        return (
          <Link
            key={`${link.href}-${link.label}`}
            href={link.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
              active
                ? "bg-[var(--acton-gray-100)] text-[var(--acton-navy)]"
                : "text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)]",
            )}
          >
            <Icon className="h-4 w-4" />
            {link.label}
          </Link>
        );
      })}
    </>
  );

  return (
    <header className="border-b border-[var(--acton-border)] bg-white print:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 md:gap-8">
          <CompanyLogo
            href="/"
            logoUrl={logoUrl}
            companyName={companyName}
            productLabel="Baxter"
            alt={logoAlt}
          />
          <nav className="hidden items-center gap-1 xl:flex">{navItems}</nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold text-[var(--acton-navy)]">{userName}</p>
            <p className="text-xs text-[var(--acton-muted)]">
              {userRole} · {userEmail}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleLogout} type="button">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="xl:hidden"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {mobileOpen ? (
        <nav className="flex flex-col gap-1 border-t border-[var(--acton-border)] px-4 py-3 xl:hidden">
          {navItems}
        </nav>
      ) : null}
    </header>
  );
}
