"use client";

import Link from "next/link";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  Search,
  X,
} from "lucide-react";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CompanyLogo } from "@/components/branding/company-logo";
import { Button } from "@/components/ui/button";
import { getNavContext, type NavContext } from "@/lib/baxter/tools";
import { getAdminNavLinks } from "@/lib/baxter/admin-nav";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type NavLink = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  match?: (pathname: string) => boolean;
};

function employeeLinks(context: NavContext): NavLink[] {
  const home: NavLink = {
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

  return [home];
}

/** Full admin menu — always available so Users and tools are never hidden. */
function adminLinks(): NavLink[] {
  return getAdminNavLinks();
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
  const links = isAdmin ? adminLinks() : employeeLinks(context);

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
            <Icon className="h-4 w-4 shrink-0" />
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
          {/* Desktop: show a compact primary set; full list remains in the menu */}
          <nav className="hidden items-center gap-1 lg:flex">
            {links.slice(0, 6).map((link) => {
              const Icon = link.icon;
              const active = link.match ? link.match(pathname) : pathname === link.href;
              return (
                <Link
                  key={`desktop-${link.href}-${link.label}`}
                  href={link.href}
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
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold text-[var(--acton-navy)]">{userName}</p>
            <p className="text-xs text-[var(--acton-muted)]">
              {userRole}
              {userEmail.trim().toLowerCase() === "baxter@actonadu.com"
                ? " · super-admin"
                : ""} · {userEmail}
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
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {mobileOpen ? (
        <nav className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto border-t border-[var(--acton-border)] px-4 py-3">
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-[var(--acton-muted)] uppercase">
            {isAdmin ? "Admin menu" : "Menu"}
          </p>
          {navItems}
        </nav>
      ) : null}
    </header>
  );
}
