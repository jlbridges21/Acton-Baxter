"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  PlusCircle,
  Search,
  Shield,
  X,
} from "lucide-react";
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
    // Platform home stays simple — tools are opened from dashboard cards.
    return [home];
  }

  if (context === "property-research") {
    const links: NavLink[] = [
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
      {
        href: "/reports",
        label: "Reports",
        icon: FileText,
        match: (pathname) =>
          pathname === "/reports" ||
          (pathname.startsWith("/reports/") && pathname !== "/reports/new"),
      },
    ];
    if (isAdmin) {
      links.push(
        {
          href: "/admin/sources",
          label: "Source Health",
          icon: Shield,
          match: (pathname) => pathname.startsWith("/admin/sources"),
        },
        {
          href: "/admin/provider-test",
          label: "Provider Test",
          icon: Shield,
          match: (pathname) => pathname.startsWith("/admin/provider-test"),
        },
      );
    }
    return links;
  }

  if (context === "knowledge") {
    return [
      home,
      {
        href: "/admin/knowledge",
        label: "Knowledge Base",
        icon: BookOpen,
        match: (pathname) =>
          pathname === "/admin/knowledge" ||
          (pathname.startsWith("/admin/knowledge/") && !pathname.includes("/sources")),
      },
      {
        href: "/admin/knowledge/sources",
        label: "Sources",
        icon: Shield,
        match: (pathname) => pathname.startsWith("/admin/knowledge/sources"),
      },
    ];
  }

  // platform-admin (branding, users, etc.)
  const adminLinks: NavLink[] = [
    home,
    {
      href: "/admin/knowledge",
      label: "Knowledge Base",
      icon: BookOpen,
      match: (pathname) => pathname.startsWith("/admin/knowledge"),
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
    {
      href: "/admin/sources",
      label: "Source Health",
      icon: Shield,
      match: (pathname) => pathname.startsWith("/admin/sources"),
    },
    {
      href: "/admin/provider-test",
      label: "Provider Test",
      icon: Shield,
      match: (pathname) => pathname.startsWith("/admin/provider-test"),
    },
  ];
  return adminLinks;
}

export function AppNav({
  userName,
  userRole,
  userEmail,
  logoUrl = null,
  companyName = "Acton ADU",
  logoAlt = "Acton ADU - Baxter",
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
          <nav className="hidden items-center gap-1 lg:flex">{navItems}</nav>
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
            className="lg:hidden"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {mobileOpen ? (
        <nav className="flex flex-col gap-1 border-t border-[var(--acton-border)] px-4 py-3 lg:hidden">
          {navItems}
        </nav>
      ) : null}
    </header>
  );
}
