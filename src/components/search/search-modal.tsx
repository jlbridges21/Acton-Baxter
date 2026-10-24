"use client";

/**
 * Global Search modal: a centered command palette (near full-screen on phones) with category
 * pills, progressively streamed sections, keyboard navigation, and an honest empty state
 * that tells "no results" apart from "a source couldn't be searched".
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Pin,
  PinOff,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { BaxterAvatar } from "@/components/baxter-chat/baxter-avatar";
import { copyText } from "@/lib/clipboard";
import { NAV_ICONS } from "@/lib/navigation/registry";
import { buildSections, countLabel, handOffToBaxter, sourceLine } from "@/lib/search/client";
import {
  categoryLabel,
  type HighlightRange,
  type ProviderOutcome,
  type SearchCategoryId,
  type SearchResult,
  type SearchResultAction,
} from "@/lib/search/types";
import { cn } from "@/lib/utils";
import { useGlobalSearch } from "./use-global-search";

const FAILED = new Set<ProviderOutcome["status"]>([
  "unavailable",
  "timeout",
  "error",
  "rate_limited",
]);

function iconFor(name: string) {
  return NAV_ICONS[name as keyof typeof NAV_ICONS] ?? Search;
}

export function Highlighted({ text, ranges }: { text: string; ranges: HighlightRange[] }) {
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={i} className="rounded-sm bg-[var(--acton-yellow)]/40 px-0.5 text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

type NavItem =
  { id: string; kind: "result"; result: SearchResult } | { id: "ask-baxter"; kind: "ask" };

export function SearchModal({
  onClose,
  isMac,
  fetcher,
}: {
  onClose: () => void;
  isMac: boolean;
  fetcher?: typeof fetch;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useGlobalSearch(fetcher);
  const { query, setQuery, category, setCategory, state, home, loadHome } = search;
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  /**
   * Set only by arrow-key navigation: the one option that should be scrolled into view once
   * it becomes active. Hover, streamed provider results, and re-renders never scroll the list,
   * so manual (wheel / trackpad) scrolling always wins.
   */
  const revealRef = useRef<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const mod = isMac ? "⌘" : "Ctrl";

  useEffect(() => {
    void loadHome();
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [loadHome]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  // A new result set (new query or category) starts at the top with nothing selected. More
  // providers answering the same search keep the user's scroll position and selection.
  const resultSetId = state.resultSetId;
  const lastResultSet = useRef(resultSetId);
  useLayoutEffect(() => {
    if (lastResultSet.current === resultSetId) return;
    lastResultSet.current = resultSetId;
    if (listRef.current) listRef.current.scrollTop = 0;
    revealRef.current = null;
    setActiveId(null);
    setNoticesOpen(false);
  }, [resultSetId]);

  const trimmed = query.trim();
  const showHome = !trimmed;
  const categories = home?.categories ?? [];
  const askAvailable = state.askBaxter || Boolean(home?.askBaxter);
  const sections = useMemo(
    () => buildSections(state.results, state.outcomes, category ? 1000 : 5),
    [state.results, state.outcomes, category],
  );
  const failures = state.outcomes.filter((o) => FAILED.has(o.status));
  const skipped = state.outcomes.filter((o) => o.status === "skipped");

  const homeSections = useMemo(() => {
    if (!home) return [];
    return [
      { key: "recent", label: "Recent", results: home.recent },
      { key: "frequent", label: "Frequently used", results: home.frequentTools },
      { key: "pinned", label: "Pinned reports", results: home.pinnedReports },
      { key: "agents", label: "AI agents", results: home.agents },
    ].filter((s) => s.results.length > 0);
  }, [home]);

  const items: NavItem[] = useMemo(() => {
    const list: NavItem[] = [];
    const seen = new Set<string>();
    const push = (r: SearchResult, prefix: string) => {
      const id = `${prefix}${r.id}`;
      if (seen.has(id)) return;
      seen.add(id);
      list.push({ id, kind: "result", result: r });
    };
    if (showHome) for (const s of homeSections) for (const r of s.results) push(r, `${s.key}:`);
    else for (const s of sections) for (const r of s.results) push(r, "");
    if (!showHome && askAvailable && state.phase !== "idle")
      list.push({ id: "ask-baxter", kind: "ask" });
    return list;
  }, [showHome, homeSections, sections, askAvailable, state.phase]);

  const active = items.find((i) => i.id === activeId) ?? items[0] ?? null;

  // Keyed on the id (a string), not the item object: `items` is rebuilt every time a provider
  // streams in, and scrolling on that is what used to yank the list back up.
  useLayoutEffect(() => {
    const target = revealRef.current;
    if (!target || target !== activeId) return;
    revealRef.current = null;
    const list = listRef.current;
    const el = document.getElementById(optionDomId(target));
    if (list && el) revealInList(list, el);
  }, [activeId]);

  /** Pointer hover highlights a row but never scrolls. */
  function hoverSelect(id: string) {
    if (activeId === id) return;
    revealRef.current = null;
    setActiveId(id);
  }

  function track(r: SearchResult) {
    void fetch("/api/search/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: r.provider, recordId: r.recordId }),
      keepalive: true,
    }).catch(() => undefined);
  }

  function openResult(r: SearchResult, newTab = false) {
    track(r);
    if (r.external || newTab) window.open(r.url, "_blank", "noopener,noreferrer");
    else router.push(r.url);
    onClose();
  }

  function askBaxter() {
    handOffToBaxter(trimmed);
    if (pathname !== "/") router.push("/");
    onClose();
  }

  async function runAction(r: SearchResult, action: SearchResultAction) {
    if (action.kind === "copy") {
      // Copy only: the modal stays open and the row's own click never fires.
      if (await copyText(action.value)) {
        setCopied(actionKey(r, action));
        setToast(copiedMessage(action));
      } else {
        setToast("Couldn't copy");
      }
      return;
    }
    if (action.kind === "open") {
      track(r);
      if (action.external) window.open(action.href, "_blank", "noopener,noreferrer");
      else router.push(action.href);
      onClose();
      return;
    }
    const res = await fetch(`/api/reports/${encodeURIComponent(action.reportId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: !action.pinned }),
    }).catch(() => null);
    if (!res?.ok) {
      setToast("Couldn't update the pin");
      return;
    }
    const flip = (x: SearchResult): SearchResult =>
      x.id !== r.id
        ? x
        : {
            ...x,
            actions: x.actions.map((a) =>
              a.kind === "pin_report"
                ? { ...a, pinned: !a.pinned, label: a.pinned ? "Pin report" : "Unpin report" }
                : a,
            ),
          };
    search.setState((s) => ({ ...s, results: s.results.map(flip) }));
    setToast(action.pinned ? "Report unpinned" : "Report pinned");
  }

  function cycleCategory(dir: 1 | -1) {
    const ids: Array<SearchCategoryId | null> = [null, ...categories.map((c) => c.id)];
    const at = ids.indexOf(category);
    setCategory(ids[(at + dir + ids.length) % ids.length] ?? null);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const inInput = e.target === inputRef.current;
    if (e.key === "Tab" && inInput && categories.length > 0) {
      e.preventDefault();
      cycleCategory(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Tab") {
      // Keep focus inside the dialog.
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input,[tabindex="0"]',
      );
      if (!nodes?.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      const n = Number(e.key) - 1;
      const ids: Array<SearchCategoryId | null> = [null, ...categories.map((c) => c.id)];
      if (n < ids.length) {
        e.preventDefault();
        setCategory(ids[n] ?? null);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      const at = active ? items.findIndex((i) => i.id === active.id) : -1;
      const next =
        e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      revealRef.current = items[next]!.id;
      setActiveId(items[next]!.id);
      return;
    }
    if (e.key === "Enter" && inInput && active) {
      e.preventDefault();
      if (active.kind === "ask") askBaxter();
      else openResult(active.result, e.metaKey || e.ctrlKey);
    }
  }

  const loading = state.phase === "loading";
  const noResults = !showHome && state.phase === "done" && state.results.length === 0;

  function renderRow(item: Extract<NavItem, { kind: "result" }>) {
    const r = item.result;
    const isActive = active?.id === item.id;
    const Icon = iconFor(r.icon);
    return (
      <div
        key={item.id}
        id={optionDomId(item.id)}
        role="option"
        aria-selected={isActive}
        data-result-id={r.id}
        onMouseMove={() => hoverSelect(item.id)}
        onClick={(e) => openResult(r, e.metaKey || e.ctrlKey)}
        className={cn(
          "group flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2",
          isActive ? "bg-[var(--acton-gray-100)]" : "hover:bg-[var(--acton-gray-50)]",
        )}
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--acton-border)] bg-white text-[var(--acton-navy)]">
          {r.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- agent avatar (local or Supabase URL)
            <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon className="h-4 w-4" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--acton-navy)]">
            <span className="truncate">
              <Highlighted text={r.title} ranges={r.highlight.title} />
            </span>
            {r.external ? (
              <ExternalLink
                className="h-3 w-3 shrink-0 text-[var(--acton-muted)]"
                aria-label="Opens in a new tab"
              />
            ) : null}
          </span>
          {r.subtitle ? (
            <span className="block truncate text-xs text-[var(--acton-muted)]">
              <Highlighted text={r.subtitle} ranges={r.highlight.subtitle} />
            </span>
          ) : null}
          {r.description ? (
            <span className="block truncate text-xs text-[var(--acton-muted)]">
              {r.description}
            </span>
          ) : null}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--acton-muted)]">
            {r.breadcrumb.length > 1 ? <span>{r.breadcrumb.join(" › ")}</span> : null}
            {r.preview.map((p) => (
              <span key={p.label}>
                <span className="opacity-70">{p.label}:</span> {p.value}
              </span>
            ))}
            <span className="opacity-80" data-testid="result-source">
              {sourceLine(r)}
            </span>
          </span>
        </span>
        {r.actions.length > 0 ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 self-center",
              isActive
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            )}
          >
            {r.actions.slice(0, 3).map((a) => {
              const done = copied === actionKey(r, a);
              return (
                <button
                  key={a.label}
                  type="button"
                  tabIndex={-1}
                  title={done ? "Copied!" : actionTooltip(a)}
                  aria-label={done ? `Copied: ${a.label}` : `${a.label}: ${r.title}`}
                  data-action={a.kind === "copy" ? (a.field ?? "copy") : a.kind}
                  // Keep focus (and arrow keys) in the search box.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    void runAction(r, a);
                  }}
                  className={cn(
                    "rounded-md border border-[var(--acton-border)] bg-white p-1.5 text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
                    done && "border-emerald-300 text-emerald-700",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <ActionIcon action={a} />}
                </button>
              );
            })}
          </span>
        ) : null}
      </div>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] print:hidden" onKeyDown={onKeyDown}>
      <div
        className="absolute inset-0 bg-[var(--acton-navy)]/40 backdrop-blur-sm"
        aria-hidden
        data-testid="global-search-backdrop"
        onMouseDown={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search Baxter"
        data-testid="global-search-modal"
        className="absolute inset-0 flex flex-col bg-white shadow-2xl sm:inset-x-4 sm:top-[10vh] sm:bottom-auto sm:mx-auto sm:max-h-[72vh] sm:w-full sm:max-w-2xl sm:rounded-2xl sm:border sm:border-[var(--acton-border)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--acton-border)] px-4 py-3">
          {loading ? (
            <Loader2
              className="h-5 w-5 shrink-0 animate-spin text-[var(--acton-muted)]"
              aria-hidden
            />
          ) : (
            <Search className="h-5 w-5 shrink-0 text-[var(--acton-muted)]" aria-hidden />
          )}
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="global-search-results"
            aria-activedescendant={active ? optionDomId(active.id) : undefined}
            aria-autocomplete="list"
            aria-label="Search Baxter"
            autoComplete="off"
            spellCheck={false}
            maxLength={120}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools, reports, customers, jobs, agents, and more..."
            className="min-w-0 flex-1 bg-transparent text-base text-[var(--acton-navy)] outline-none placeholder:text-[var(--acton-muted)] [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded-md p-1.5 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Search categories"
          className="flex shrink-0 [scrollbar-width:none] gap-1.5 overflow-x-auto border-b border-[var(--acton-border)] px-4 py-2"
        >
          {[{ id: null as SearchCategoryId | null, label: "All" }, ...categories].map((c, i) => {
            const selected = category === c.id;
            return (
              <button
                key={c.id ?? "all"}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={-1}
                title={i < 9 ? `${mod}+${i + 1}` : undefined}
                onClick={() => {
                  setCategory(c.id);
                  inputRef.current?.focus();
                }}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors",
                  selected
                    ? "border-[var(--acton-navy)] bg-[var(--acton-navy)] text-white"
                    : "border-[var(--acton-border)] bg-white text-[var(--acton-muted)] hover:text-[var(--acton-navy)]",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div
          ref={listRef}
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          aria-busy={loading}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:max-h-[52vh]"
        >
          {showHome ? (
            home ? (
              homeSections.length ? (
                homeSections.map((s) => (
                  <section key={s.key} className="mb-2" aria-label={s.label}>
                    <SectionHeader label={s.label} />
                    {s.results.map((r) =>
                      renderRow({ id: `${s.key}:${r.id}`, kind: "result", result: r }),
                    )}
                  </section>
                ))
              ) : (
                <p className="px-3 py-6 text-center text-sm text-[var(--acton-muted)]">
                  Start typing to search{category ? ` ${categoryLabel(category)}` : " Baxter"}.
                </p>
              )
            ) : search.homeError ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--acton-muted)]">
                {search.homeError}
              </p>
            ) : (
              <p className="px-3 py-6 text-center text-sm text-[var(--acton-muted)]">Loading…</p>
            )
          ) : (
            <>
              {failures.length > 0 ? (
                <div className="mx-1 mb-2 space-y-1" data-testid="provider-notices">
                  <ProviderNotices
                    failures={failures.filter((f) => f.status !== "unavailable")}
                    open={noticesOpen}
                    onToggle={() => setNoticesOpen((v) => !v)}
                  />
                  {failures.some((f) => f.status === "unavailable") ? (
                    // Not connected / turned off is configuration, not a failure: one quiet line.
                    <p className="px-3 text-[11px] text-[var(--acton-muted)]">
                      Not searched:{" "}
                      {uniqueMessages(failures.filter((f) => f.status === "unavailable")).join(" ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {state.error ? (
                <p className="mx-1 mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                  {state.error}
                </p>
              ) : null}

              {!category && state.addressGroups.length > 0 ? (
                <section className="mb-2" aria-label="Addresses">
                  <SectionHeader
                    label="Addresses"
                    count={`${state.addressGroups.length} address${state.addressGroups.length === 1 ? "" : "es"}`}
                  />
                  {state.addressGroups.map((g) => (
                    <div
                      key={g.key}
                      className="mx-1 mb-1 rounded-lg border border-[var(--acton-border)] px-3 py-2"
                    >
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--acton-navy)]">
                        <MapPin className="h-3.5 w-3.5" aria-hidden /> {g.display}
                      </p>
                      <p className="text-[11px] text-[var(--acton-muted)]">
                        {g.resultIds.length} records · {g.sources.join(", ")} (separate records, not
                        merged)
                      </p>
                    </div>
                  ))}
                </section>
              ) : null}

              {sections.map((s) => (
                <section key={s.category} className="mb-2" aria-label={s.label}>
                  <SectionHeader
                    label={s.label}
                    count={countLabel(s.count, s.hasMore)}
                    action={
                      !category && s.hasMore ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            setCategory(s.category);
                            inputRef.current?.focus();
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--acton-navy)] hover:underline"
                        >
                          See all <ArrowRight className="h-3 w-3" />
                        </button>
                      ) : null
                    }
                  />
                  {s.results.map((r) => renderRow({ id: r.id, kind: "result", result: r }))}
                  {category && s.hasMore ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={search.loadMore}
                      className="mx-3 my-1 text-xs font-semibold text-[var(--acton-navy)] hover:underline"
                    >
                      Load more
                    </button>
                  ) : null}
                </section>
              ))}

              {loading && state.pending.length > 0 ? (
                <p className="px-3 py-2 text-xs text-[var(--acton-muted)]" aria-live="polite">
                  Searching {state.pending.length} more source
                  {state.pending.length === 1 ? "" : "s"}…
                </p>
              ) : null}

              {noResults ? (
                <div className="px-3 py-6 text-center" data-testid="search-no-results">
                  <p className="text-sm font-semibold text-[var(--acton-navy)]">
                    {failures.length
                      ? "No results from the sources that answered"
                      : `No results for “${state.resultsFor}”`}
                  </p>
                  <p className="mt-1 text-xs text-[var(--acton-muted)]">
                    {failures.length
                      ? `${failures.map((f) => f.name).join(", ")} couldn't be searched, so there may be matches there.`
                      : skipped.length
                        ? "Some sources need a longer search. Try a few more letters."
                        : "Try a different spelling, a job number, an email, or part of an address."}
                  </p>
                </div>
              ) : null}

              {askAvailable && state.phase !== "idle" ? (
                <div
                  id={optionDomId("ask-baxter")}
                  role="option"
                  aria-selected={active?.id === "ask-baxter"}
                  onMouseMove={() => hoverSelect("ask-baxter")}
                  onClick={askBaxter}
                  className={cn(
                    "mt-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2",
                    active?.id === "ask-baxter"
                      ? "bg-[var(--acton-gray-100)]"
                      : "hover:bg-[var(--acton-gray-50)]",
                  )}
                >
                  <BaxterAvatar size={32} />
                  <span className="min-w-0 flex-1 text-sm text-[var(--acton-navy)]">
                    <span className="font-semibold">Ask Baxter</span>{" "}
                    <span className="text-[var(--acton-muted)]">
                      about “{state.resultsFor || trimmed}”
                    </span>
                  </span>
                  <MessageCircle className="h-4 w-4 text-[var(--acton-muted)]" aria-hidden />
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="hidden shrink-0 items-center gap-4 border-t border-[var(--acton-border)] px-4 py-2 text-[11px] text-[var(--acton-muted)] sm:flex">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>{mod}</Kbd> <Kbd>↵</Kbd> new tab
          </span>
          <span>
            <Kbd>Tab</Kbd> category
          </span>
          <span>
            <Kbd>esc</Kbd> close
          </span>
          {state.tookMs !== null && !showHome ? (
            <span className="ml-auto">{state.tookMs} ms</span>
          ) : null}
        </div>
        {toast ? (
          <p
            role="status"
            className="absolute bottom-12 left-1/2 -translate-x-1/2 rounded-full bg-[var(--acton-navy)] px-3 py-1 text-xs text-white shadow"
          >
            {toast}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function uniqueMessages(outcomes: ProviderOutcome[]): string[] {
  return [...new Set(outcomes.map((o) => o.message ?? `${o.name} couldn't be searched.`))];
}

/**
 * Scroll `el` into view inside `list` only (never the page), by the smallest amount. Called
 * once per arrow-key press, never from hover or render.
 */
export function revealInList(list: HTMLElement, el: HTMLElement) {
  const box = list.getBoundingClientRect();
  const row = el.getBoundingClientRect();
  if (row.top < box.top) list.scrollTop -= box.top - row.top + 4;
  else if (row.bottom > box.bottom) list.scrollTop += row.bottom - box.bottom + 4;
}

function actionKey(r: SearchResult, a: SearchResultAction) {
  return `${r.id}|${a.label}`;
}

function actionTooltip(a: SearchResultAction): string {
  if (a.kind === "copy" && a.field) return `${a.label} (${a.value})`;
  return a.label;
}

function copiedMessage(a: Extract<SearchResultAction, { kind: "copy" }>): string {
  if (a.field === "phone") return "Phone number copied";
  if (a.field === "email") return "Email address copied";
  const what = a.label.replace(/^Copy /, "");
  return `${what[0]?.toUpperCase() ?? ""}${what.slice(1)} copied`;
}

/** One quiet line per failure; several collapse into one expandable notice. */
function ProviderNotices({
  failures,
  open,
  onToggle,
}: {
  failures: ProviderOutcome[];
  open: boolean;
  onToggle: () => void;
}) {
  const messages = uniqueMessages(failures);
  if (!messages.length) return null;
  const row = "flex items-start gap-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900";
  if (messages.length === 1) {
    return (
      <p className={row}>
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {messages[0]}
      </p>
    );
  }
  return (
    <div className="rounded-md bg-amber-50 text-xs text-amber-900">
      <button
        type="button"
        tabIndex={-1}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex-1">
          Some sources are temporarily unavailable ({failures.length}). Results from them may be
          missing.
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <ul className="space-y-0.5 px-3 pb-1.5 pl-8" data-testid="provider-notice-details">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function optionDomId(id: string) {
  return `gs-opt-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function SectionHeader({
  label,
  count,
  action,
}: {
  label: string;
  count?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 pt-2 pb-1">
      <p className="text-[11px] font-semibold tracking-wider text-[var(--acton-muted)] uppercase">
        {label}
        {count ? <span className="font-normal normal-case"> — {count}</span> : null}
      </p>
      {action}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-1 font-sans text-[10px]">
      {children}
    </kbd>
  );
}

function ActionIcon({ action }: { action: SearchResultAction }) {
  if (action.kind === "copy") {
    if (action.field === "phone") return <Phone className="h-3.5 w-3.5" aria-hidden />;
    if (action.field === "email") return <Mail className="h-3.5 w-3.5" aria-hidden />;
    return <Copy className="h-3.5 w-3.5" aria-hidden />;
  }
  if (action.kind === "pin_report")
    return action.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />;
  if (action.external) return <ExternalLink className="h-3.5 w-3.5" />;
  return /chat/i.test(action.label) ? (
    <MessageCircle className="h-3.5 w-3.5" />
  ) : (
    <ArrowRight className="h-3.5 w-3.5" />
  );
}
