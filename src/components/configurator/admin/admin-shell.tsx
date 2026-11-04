"use client";

import {
  ExternalLink,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  MapPin,
  Palette,
  Rocket,
  Settings,
  Table2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";

const NAV = [
  { href: "/configurator", label: "Dashboard", icon: Home, exact: true },
  { href: "/configurator/models", label: "Models", icon: LayoutGrid },
  { href: "/configurator/pricing", label: "Pricing", icon: Table2 },
  { href: "/configurator/regions", label: "Regions", icon: MapPin },
  { href: "/configurator/styles", label: "Styles", icon: Palette },
  { href: "/configurator/media", label: "Media & Import", icon: ImageIcon },
  { href: "/configurator/publish", label: "Publish", icon: Rocket },
  { href: "/configurator/settings", label: "Settings", icon: Settings },
];

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { dirtyCount, saving, save, discard, saveError, lastSavedAt, canUndo, undo, issues, live } =
    useAdmin();
  const errors = issues.filter((i) => i.severity === "error").length;

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-[var(--acton-border)] bg-[var(--acton-navy)] text-white md:flex">
        <div className="px-5 pt-5 pb-4">
          <p className="text-lg font-bold">
            Acton<span className="text-[var(--acton-yellow)]">ADU</span>
          </p>
          <p className="text-xs text-white/70">Configurator Admin</p>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/80 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 p-3">
          <a
            href="/design?preview=draft"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg border border-white/25 px-3 py-2 text-sm hover:bg-white/10"
            data-testid="preview-draft-link"
          >
            <ExternalLink className="h-4 w-4" /> Preview draft
          </a>
          <a
            href="/design"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
          >
            View live configurator {live ? `(v${live.version})` : "(not published)"}
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--acton-border)] bg-white px-4 py-2.5">
          <nav className="flex gap-1 overflow-x-auto md:hidden">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-2 py-1 text-xs font-semibold whitespace-nowrap text-[var(--acton-navy)] hover:bg-gray-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm" data-testid="save-status">
            {saving ? (
              <span className="flex items-center gap-2 text-[var(--acton-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Saving draft…
              </span>
            ) : dirtyCount > 0 ? (
              <span className="font-semibold text-amber-700">
                {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
              </span>
            ) : (
              <span className="text-[var(--acton-muted)]">
                Draft saved {timeAgo(lastSavedAt)} · customers see the published version only
              </span>
            )}
            {saveError ? (
              <span className="truncate text-red-700" role="alert" title={saveError}>
                {saveError}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-[var(--acton-navy)] hover:bg-gray-100 disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" /> Undo
          </button>
          {dirtyCount > 0 ? (
            <button
              type="button"
              onClick={discard}
              className="inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold text-[var(--acton-muted)] hover:bg-gray-100"
            >
              Discard
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={dirtyCount === 0 || saving}
            data-testid="save-draft"
            className="inline-flex h-9 items-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)] hover:bg-gray-50 disabled:opacity-50"
          >
            Save draft
          </button>
          <Link
            href="/configurator/publish"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)]"
          >
            <Rocket className="h-4 w-4" /> Publish
            {errors > 0 ? (
              <span className="rounded-full bg-amber-400 px-1.5 text-[11px] text-[var(--acton-navy)]">
                {errors}
              </span>
            ) : null}
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--acton-gray-50)]">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back ? (
          <Link
            href={back.href}
            className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
          >
            ← {back.label}
          </Link>
        ) : null}
        <h1 className="mt-1 text-2xl font-bold text-[var(--acton-navy)]">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--acton-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
