"use client";

/** /reports — find, open, and start reports (from Dexter, a template, or blank). */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Database,
  FilePlus2,
  LayoutTemplate,
  Pin,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import {
  AgentAvatar,
  aiFetch,
  EmptyState,
  errorMessage,
  formatRelative,
  Notice,
  useLoad,
} from "@/components/ai/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SuggestionCard, type Suggestion } from "./data-catalog";
import type { ReportsAccessView, ReportSummary } from "./types";

const TABS = [
  { key: "all", label: "All" },
  { key: "mine", label: "My reports" },
  { key: "shared", label: "Shared with me" },
  { key: "recent", label: "Recent" },
  { key: "pinned", label: "Pinned" },
  { key: "templates", label: "Templates" },
  { key: "archived", label: "Archived" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function ReportsHub({ dexterAvatarUrl }: { dexterAvatarUrl: string | null }) {
  const router = useRouter();
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [access, setAccess] = useState<ReportsAccessView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const loadSuggestions = useCallback(async () => {
    try {
      const res = await aiFetch<{ suggestions: Suggestion[] }>(
        "/api/reports/catalog?view=suggestions",
      );
      setSuggestions(res.suggestions);
    } catch {
      setSuggestions([]);
    }
  }, []);
  useLoad(loadSuggestions);

  const load = useCallback(async () => {
    try {
      const res = await aiFetch<{ reports: ReportSummary[]; access: ReportsAccessView }>(
        "/api/reports",
      );
      setReports(res.reports);
      setAccess(res.access);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(load);

  const shown = useMemo(() => {
    if (!reports) return [];
    const q = query.trim().toLowerCase();
    let list = reports.filter((r) =>
      tab === "archived" ? r.status === "archived" : r.status === "active",
    );
    if (tab === "mine") list = list.filter((r) => r.isMine);
    else if (tab === "shared") list = list.filter((r) => !r.isMine && !r.isTemplate);
    else if (tab === "recent")
      list = list
        .filter((r) => r.viewedAt)
        .sort((a, b) => (b.viewedAt ?? "").localeCompare(a.viewedAt ?? ""))
        .slice(0, 20);
    else if (tab === "pinned") list = list.filter((r) => r.pinned);
    else if (tab === "templates") list = list.filter((r) => r.isTemplate);
    else if (tab === "all") list = list.filter((r) => !r.isTemplate);
    if (q) list = list.filter((r) => `${r.title} ${r.description}`.toLowerCase().includes(q));
    return list;
  }, [reports, tab, query]);

  const templates = useMemo(
    () => (reports ?? []).filter((r) => r.isTemplate && r.status === "active"),
    [reports],
  );
  const pinned = useMemo(
    () => (reports ?? []).filter((r) => r.pinned && r.status === "active"),
    [reports],
  );

  const create = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const res = await aiFetch<{ id: string }>("/api/reports", {
        method: "POST",
        body: JSON.stringify(body),
      });
      router.push(`/reports/${res.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Reports</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
            Interactive reports built from live JobTread data. Ask Dexter to build one, start from a
            template, or make your own.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/reports/catalog"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <BookOpen className="h-4 w-4" aria-hidden /> Data catalog
          </Link>
          {access?.isAdmin ? (
            <Link
              href="/reports/settings"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <Database className="h-4 w-4" aria-hidden /> Data settings
            </Link>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void create({ from: "blank" }, "blank")}
            disabled={busy !== null}
          >
            <FilePlus2 className="h-4 w-4" aria-hidden /> Blank report
          </Button>
          <Link href="/reports/new" className={buttonVariants({ variant: "accent", size: "sm" })}>
            <Sparkles className="h-4 w-4" aria-hidden /> Create with Dexter
          </Link>
        </div>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Link
        href="/reports/new"
        className="flex items-center gap-4 rounded-xl border border-[var(--acton-border)] bg-white p-4 shadow-sm hover:border-[var(--acton-navy)]"
      >
        <AgentAvatar name="Dexter" url={dexterAvatarUrl} size={48} color="#0f766e" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[var(--acton-navy)]">Tell Dexter what you need</p>
          <p className="text-sm text-[var(--acton-muted)]">
            “Show active projects by phase and PM”, “Compare ADU model pricing”, “What does design
            need for the Smith project?”
          </p>
        </div>
        <span className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex")}>Start</span>
      </Link>

      {suggestions?.length && tab === "all" && !query ? (
        <section aria-labelledby="suggested-heading">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2
              id="suggested-heading"
              className="flex items-center gap-2 text-sm font-semibold text-[var(--acton-navy)]"
            >
              <Sparkles className="h-4 w-4" aria-hidden /> Suggested reports
            </h2>
            <Link
              href="/reports/catalog"
              className="text-xs font-semibold text-[var(--acton-navy)] hover:underline"
            >
              Why some aren&apos;t possible yet →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[...suggestions]
              .sort(
                (a, b) =>
                  ["ready", "ready_with_gaps", "needs_setup", "blocked"].indexOf(a.status) -
                  ["ready", "ready_with_gaps", "needs_setup", "blocked"].indexOf(b.status),
              )
              .filter((s) => !s.templateKey)
              .slice(0, 4)
              .map((s) => (
                <SuggestionCard key={s.key} s={s} />
              ))}
          </div>
        </section>
      ) : null}

      {templates.length && tab === "all" && !query ? (
        <section aria-labelledby="templates-heading">
          <h2
            id="templates-heading"
            className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--acton-navy)]"
          >
            <LayoutTemplate className="h-4 w-4" aria-hidden /> Start from a template
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex flex-col rounded-lg border border-[var(--acton-border)] bg-white p-4"
              >
                <p className="font-semibold text-[var(--acton-navy)]">{t.title}</p>
                <p className="mt-1 line-clamp-3 flex-1 text-xs text-[var(--acton-muted)]">
                  {t.description}
                </p>
                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/reports/${t.id}`}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    Open
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void create({ from: "report", reportId: t.id }, t.id)}
                  >
                    {busy === t.id ? "Copying…" : "Make a copy"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {pinned.length && tab === "all" && !query ? (
        <section aria-labelledby="pinned-heading">
          <h2
            id="pinned-heading"
            className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--acton-navy)]"
          >
            <Pin className="h-4 w-4" aria-hidden /> Pinned
          </h2>
          <ReportGrid reports={pinned} />
        </section>
      ) : null}

      <section aria-label="Your reports" className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <nav aria-label="Report lists" className="-mx-1 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium",
                  tab === t.key
                    ? "bg-[var(--acton-navy)] text-white"
                    : "text-[var(--acton-muted)] hover:bg-white hover:text-[var(--acton-navy)]",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <label className="relative block w-full md:w-72">
            <span className="sr-only">Search reports</span>
            <Search
              className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[var(--acton-muted)]"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reports"
              className="h-9 w-full rounded-md border border-[var(--acton-border)] bg-white pr-3 pl-9 text-sm"
            />
          </label>
        </div>
        {!reports ? (
          <p className="text-sm text-[var(--acton-muted)]">Loading reports…</p>
        ) : shown.length ? (
          <ReportGrid reports={shown} />
        ) : (
          <EmptyState
            title={
              query
                ? "No reports match your search"
                : tab === "all"
                  ? "No reports yet"
                  : "Nothing here yet"
            }
          >
            {tab === "all" && !query
              ? "Create one with Dexter or start from a template above."
              : null}
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function ReportGrid({ reports }: { reports: ReportSummary[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map((r) => (
        <li key={r.id}>
          <Link
            href={`/reports/${r.id}`}
            className="flex h-full flex-col rounded-lg border border-[var(--acton-border)] bg-white p-4 shadow-sm hover:border-[var(--acton-navy)]"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--acton-gray-50)] text-[var(--acton-navy)]">
                <BarChart3 className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-[var(--acton-navy)]">{r.title}</p>
                <p className="line-clamp-2 text-xs text-[var(--acton-muted)]">
                  {r.description || `${r.widgetCount} widget${r.widgetCount === 1 ? "" : "s"}`}
                </p>
              </div>
              {r.pinned ? (
                <Pin className="h-4 w-4 shrink-0 text-[var(--acton-muted)]" aria-label="Pinned" />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--acton-muted)]">
              {r.isTemplate ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                  Template
                </span>
              ) : null}
              {r.visibility !== "private" && !r.isTemplate ? (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" aria-hidden />{" "}
                  {r.visibility === "company"
                    ? "Everyone"
                    : `Shared${r.shareCount ? ` · ${r.shareCount}` : ""}`}
                </span>
              ) : null}
              {!r.isMine && !r.isTemplate ? <span>Shared with you</span> : null}
              {r.createdByDexter ? <span>Built with Dexter</span> : null}
              <span className="ml-auto">Updated {formatRelative(r.updatedAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
