"use client";

import Link from "next/link";
import { LogOut, Menu, X } from "lucide-react";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CompanyLogo } from "@/components/branding/company-logo";
import { Button } from "@/components/ui/button";
import { isAdminRole } from "@/lib/auth/roles";
import { getAppNavLinksForRole, getAppNavSectionsForRole } from "@/lib/baxter/app-nav-links";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

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
  const isAdmin = isAdminRole(userRole);
  const links = getAppNavLinksForRole(userRole, pathname);
  const sections = getAppNavSectionsForRole(userRole);

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

  function renderLink(link: (typeof links)[number], keyPrefix: string, onNavigate?: () => void) {
    const Icon = link.icon;
    const active = link.match ? link.match(pathname) : pathname === link.href;
    return (
      <Link
        key={`${keyPrefix}-${link.href}-${link.label}`}
        href={link.href}
        onClick={onNavigate}
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
  }

  const desktopPrimary = links.slice(0, isAdmin ? 5 : 7);

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
          <nav className="hidden items-center gap-1 lg:flex">
            {desktopPrimary.map((link) => renderLink(link, "desktop"))}
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
          {sections ? (
            sections.map((section) => (
              <div key={section.id} className="mb-2">
                <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-[var(--acton-muted)] uppercase">
                  {section.label}
                </p>
                {section.links.map((link) =>
                  renderLink(link, `menu-${section.id}`, () => setMobileOpen(false)),
                )}
              </div>
            ))
          ) : (
            <>
              <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-[var(--acton-muted)] uppercase">
                Menu
              </p>
              {links.map((link) => renderLink(link, "menu", () => setMobileOpen(false)))}
            </>
          )}
        </nav>
      ) : null}
    </header>
  );
}
