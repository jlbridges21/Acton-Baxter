"use client";

import Link from "next/link";
import { ClipboardCheck, LayoutTemplate } from "lucide-react";
import { cn } from "@/lib/utils";

export type InspectionsNavView = "inspections" | "templates";

const LINKS: {
  view: InspectionsNavView;
  href: string;
  label: string;
  icon: typeof ClipboardCheck;
}[] = [
  {
    view: "inspections",
    href: "/inspections",
    label: "Site Inspections",
    icon: ClipboardCheck,
  },
  {
    view: "templates",
    href: "/inspections/templates",
    label: "Templates",
    icon: LayoutTemplate,
  },
];

export function InspectionsShell({
  activeView,
  title,
  subtitle,
  children,
  actions,
}: {
  activeView: InspectionsNavView;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--acton-navy)]">{title}</h1>
          {subtitle ? (
            <p className="mt-1 max-w-2xl text-sm text-[var(--acton-muted)]">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-[var(--acton-border)] bg-white p-2 shadow-sm lg:p-3">
          <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Inspections">
            {LINKS.map((link) => {
              const Icon = link.icon;
              const active = link.view === activeView;
              return (
                <Link
                  key={link.view}
                  href={link.href}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                    active
                      ? "bg-[var(--acton-navy)] text-white"
                      : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 space-y-4">{children}</main>
      </div>
    </div>
  );
}
