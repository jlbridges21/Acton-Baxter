"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FileText, LayoutDashboard, LogOut, Menu, Palette, Search, Shield, X } from "lucide-react";
import { CompanyLogo } from "@/components/branding/company-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const primaryLinks = [
  { href: "/", label: "Baxter Dashboard", icon: LayoutDashboard },
  { href: "/dashboard", label: "Property Research", icon: Search },
  { href: "/reports", label: "Reports", icon: FileText },
] as const;

const adminLinks = [
  { href: "/admin/sources", label: "Source Health", icon: Shield },
  { href: "/admin/provider-test", label: "Provider Test", icon: Shield },
  { href: "/admin/users", label: "Users", icon: Shield },
  { href: "/admin/branding", label: "Branding", icon: Palette },
] as const;

function isPrimaryActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/dashboard") {
    return (
      pathname === "/dashboard" || pathname === "/reports/new" || pathname.startsWith("/reports/")
    );
  }
  if (href === "/reports") return pathname === "/reports";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav({
  userName,
  userRole,
  userEmail,
  logoUrl = null,
  companyName = "Acton ADU",
  reportTitle = "Baxter",
  logoAlt = "Baxter by Acton ADU",
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
      {primaryLinks.map((link) => {
        const Icon = link.icon;
        const active = isPrimaryActive(pathname, link.href);
        return (
          <Link
            key={link.href}
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
      {isAdmin
        ? adminLinks.map((link) => {
            const Icon = link.icon;
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
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
          })
        : null}
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
            reportTitle={reportTitle}
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
