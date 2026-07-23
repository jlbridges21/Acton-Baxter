"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FileText, LayoutDashboard, LogOut, Palette, PlusCircle, Shield } from "lucide-react";
import { CompanyLogo } from "@/components/branding/company-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reports/new", label: "New Research", icon: PlusCircle },
  { href: "/reports", label: "Report History", icon: FileText },
];

export function AppNav({
  userName,
  userRole,
  userEmail,
  logoUrl = null,
  companyName = "Acton ADU",
  reportTitle = "Property Research",
  logoAlt = "Acton ADU logo",
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

  return (
    <header className="border-b border-[var(--acton-border)] bg-white print:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-8">
          <CompanyLogo
            logoUrl={logoUrl}
            companyName={companyName}
            reportTitle={reportTitle}
            alt={logoAlt}
          />
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
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
            {userRole === "admin" ? (
              <Link
                href="/admin/sources"
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                  pathname.startsWith("/admin/sources")
                    ? "bg-[var(--acton-gray-100)] text-[var(--acton-navy)]"
                    : "text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)]",
                )}
              >
                <Shield className="h-4 w-4" />
                Source Health
              </Link>
            ) : null}
            {userRole === "admin" ? (
              <Link
                href="/admin/provider-test"
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                  pathname.startsWith("/admin/provider-test")
                    ? "bg-[var(--acton-gray-100)] text-[var(--acton-navy)]"
                    : "text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)]",
                )}
              >
                <Shield className="h-4 w-4" />
                Provider Test
              </Link>
            ) : null}
            {userRole === "admin" ? (
              <Link
                href="/admin/users"
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                  pathname.startsWith("/admin/users")
                    ? "bg-[var(--acton-gray-100)] text-[var(--acton-navy)]"
                    : "text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)]",
                )}
              >
                <Shield className="h-4 w-4" />
                Users
              </Link>
            ) : null}
            {userRole === "admin" ? (
              <Link
                href="/admin/branding"
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                  pathname.startsWith("/admin/branding")
                    ? "bg-[var(--acton-gray-100)] text-[var(--acton-navy)]"
                    : "text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)]",
                )}
              >
                <Palette className="h-4 w-4" />
                Branding
              </Link>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold text-[var(--acton-navy)]">{userName}</p>
            <p className="text-xs text-[var(--acton-muted)]">
              {userRole} · {userEmail}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleLogout} type="button">
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
