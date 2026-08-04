"use client";

import Link from "next/link";
import { Cloud, Plus, Upload } from "lucide-react";
import {
  KnowledgeCenterSidebar,
  type KnowledgeCenterBasePath,
  type KnowledgeCenterView,
} from "./knowledge-center-sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function KnowledgeCenterShell({
  title = "Knowledge Center",
  subtitle,
  activeView,
  searchValue,
  onSearchChange,
  children,
  rightPanel,
  hideTopActions,
  isAdmin = true,
  basePath = "/admin/knowledge",
  newEntryHref,
}: {
  title?: string;
  subtitle?: string;
  activeView?: KnowledgeCenterView;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  children: React.ReactNode;
  rightPanel?: React.ReactNode;
  hideTopActions?: boolean;
  /** When false, hide admin-only top actions and sidebar destinations. */
  isAdmin?: boolean;
  basePath?: KnowledgeCenterBasePath;
  /** Create entry href (defaults from role). */
  newEntryHref?: string;
}) {
  const resolvedNewHref = newEntryHref ?? (isAdmin ? "/admin/knowledge/new" : "/knowledge/new");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--acton-navy)]">{title}</h1>
          {subtitle ? (
            <p className="mt-1 max-w-2xl text-sm text-[var(--acton-muted)]">{subtitle}</p>
          ) : null}
        </div>
        {!hideTopActions ? (
          <div className="flex flex-wrap gap-2">
            <Link href={resolvedNewHref}>
              <Button type="button" className="gap-1.5">
                <Plus className="h-4 w-4" />
                {isAdmin ? "New Entry" : "Add New"}
              </Button>
            </Link>
            {isAdmin ? (
              <>
                <Link href="/admin/knowledge/upload">
                  <Button type="button" variant="secondary" className="gap-1.5">
                    <Upload className="h-4 w-4" />
                    Upload Files
                  </Button>
                </Link>
                <Link href="/admin/connectors/google">
                  <Button type="button" variant="secondary" className="gap-1.5">
                    <Cloud className="h-4 w-4" />
                    Google Workspace
                  </Button>
                </Link>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {onSearchChange ? (
        <div className="rounded-xl border border-[var(--acton-border)] bg-white px-4 py-3 shadow-sm">
          <label className="sr-only" htmlFor="knowledge-center-search">
            Search Knowledge
          </label>
          <Input
            id="knowledge-center-search"
            value={searchValue ?? ""}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search knowledge…"
            className="h-11 border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_260px]">
        <aside className="rounded-xl border border-[var(--acton-border)] bg-white p-3 shadow-sm">
          <KnowledgeCenterSidebar
            activeView={activeView}
            isAdmin={isAdmin}
            basePath={basePath}
            newEntryHref={resolvedNewHref}
          />
        </aside>
        <main className="min-w-0 space-y-4">{children}</main>
        {rightPanel ? (
          <aside className="hidden space-y-4 xl:block">{rightPanel}</aside>
        ) : (
          <aside className="hidden xl:block" />
        )}
      </div>
    </div>
  );
}
