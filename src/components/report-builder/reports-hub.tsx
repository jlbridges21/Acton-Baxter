"use client";

/**
 * /reports — the report library first: compact header and Dexter prompt, collapsible
 * suggestions (only genuinely useful ones) and the four-card template gallery, then the
 * library with tabs, groups (folders), search, and a per-card actions menu.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  Database,
  FilePlus2,
  Folder,
  LayoutTemplate,
  Pin,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
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
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { galleryTemplates } from "@/lib/reports/gallery";
import { cn } from "@/lib/utils";
import {
  AddReportsDialog,
  COLOR_DOT,
  GroupBar,
  GroupDialog,
  ManageGroupsDialog,
  MoveDialog,
  type GroupFilter,
  type ReportGroup,
} from "./report-groups";
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

type HomeSuggestion = {
  key: string;
  title: string;
  description: string;
  prompt: string;
  status: string;
  state: string;
};
type Prefs = { suggestionsCollapsed: boolean; templatesCollapsed: boolean };

export function ReportsHub({ dexterAvatarUrl }: { dexterAvatarUrl: string | null }) {
  const router = useRouter();
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [access, setAccess] = useState<ReportsAccessView | null>(null);
  const [suggestions, setSuggestions] = useState<HomeSuggestion[]>([]);
  const [prefs, setPrefs] = useState<Prefs>({
    suggestionsCollapsed: false,
    templatesCollapsed: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [group, setGroup] = useState<GroupFilter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ group: ReportGroup | null } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [moving, setMoving] = useState<ReportSummary | null>(null);
  const [renaming, setRenaming] = useState<ReportSummary | null>(null);
  const [adding, setAdding] = useState<ReportGroup | null>(null);

  const loadLibrary = useCallback(async () => {
    try {
      const res = await aiFetch<{
        reports: ReportSummary[];
        groups: ReportGroup[];
        access: ReportsAccessView;
      }>("/api/reports");
      setReports(res.reports);
      setGroups(res.groups ?? []);
      setAccess(res.access);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  const loadSuggestions = useCallback(async () => {
    try {
      setSuggestions(
        (await aiFetch<{ suggestions: HomeSuggestion[] }>("/api/reports/suggestions")).suggestions,
      );
    } catch {
      setSuggestions([]);
    }
  }, []);
  const loadPrefs = useCallback(async () => {
    try {
      setPrefs((await aiFetch<{ prefs: Prefs }>("/api/reports/prefs")).prefs);
    } catch {
      // defaults
    }
  }, []);
  useLoad(loadLibrary);
  useLoad(loadSuggestions);
  useLoad(loadPrefs);
  const refresh = useCallback(async () => {
    await Promise.all([loadLibrary(), loadSuggestions()]);
  }, [loadLibrary, loadSuggestions]);

  const togglePref = (key: keyof Prefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next); // optimistic
    void aiFetch("/api/reports/prefs", {
      method: "PUT",
      body: JSON.stringify({ [key]: next[key] }),
    }).catch(() => undefined);
  };

  const templates = useMemo(() => galleryTemplates(reports ?? []), [reports]);

  // Reports for the current tab (before group + search), so group counts match the tab.
  const tabReports = useMemo(() => {
    if (!reports) return [];
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
    else list = list.filter((r) => !r.isTemplate);
    if (tab === "all") list = [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return list;
  }, [reports, tab]);

  const counts = useMemo(() => {
    const byGroup = new Map<string, number>();
    for (const r of tabReports)
      for (const g of r.groupIds) byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
    return {
      all: tabReports.length,
      ungrouped: tabReports.filter((r) => !r.groupIds.length).length,
      byGroup,
    };
  }, [tabReports]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tabReports;
    if (group === "ungrouped") list = list.filter((r) => !r.groupIds.length);
    else if (group !== "all") list = list.filter((r) => r.groupIds.includes(group));
    if (q) list = list.filter((r) => `${r.title} ${r.description}`.toLowerCase().includes(q));
    return list;
  }, [tabReports, group, query]);

  const activeGroups = groups.filter((g) => !g.archived);
  const selectedGroup = activeGroups.find((g) => g.id === group) ?? null;
  const showDiscovery = tab === "all" && !query && group === "all";

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

  const patchReport = async (r: ReportSummary, body: Record<string, unknown>) => {
    try {
      await aiFetch(`/api/reports/${r.id}`, { method: "PATCH", body: JSON.stringify(body) });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const menuFor = (r: ReportSummary): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [{ id: "open", label: "Open", href: `/reports/${r.id}` }];
    if (r.permission.canEdit && !r.isTemplate)
      items.push({ id: "rename", label: "Rename", onSelect: () => setRenaming(r) });
    if (!r.isTemplate && r.status === "active")
      items.push({
        id: "move",
        label: r.groupIds.length ? "Move to group…" : "Add to group…",
        onSelect: () => setMoving(r),
      });
    items.push({
      id: "dup",
      label: r.isTemplate ? "Use as template" : "Duplicate",
      onSelect: () =>
        void create(
          {
            from: "report",
            reportId: r.id,
            ...(group !== "all" && group !== "ungrouped" ? { groupId: group } : {}),
          },
          r.id,
        ),
    });
    items.push({
      id: "pin",
      label: r.pinned ? "Unpin" : "Pin",
      onSelect: () => void patchReport(r, { pinned: !r.pinned }),
    });
    if (r.permission.canShare && !r.isTemplate)
      items.push({ id: "share", label: "Share…", href: `/reports/${r.id}?share=1` });
    if (r.permission.canDelete || (r.isTemplate && r.permission.canEdit))
      items.push({
        id: "archive",
        label: r.status === "archived" ? "Restore" : "Archive",
        onSelect: () =>
          void patchReport(r, { status: r.status === "archived" ? "active" : "archived" }),
      });
    if (r.permission.canDelete && !r.isTemplate)
      items.push({
        id: "delete",
        label: "Delete",
        destructive: true,
        onSelect: () => {
          if (
            !window.confirm(
              `Delete "${r.title}"? This can't be undone. Archive it instead to keep its history.`,
            )
          )
            return;
          void aiFetch(`/api/reports/${r.id}`, { method: "DELETE" })
            .then(refresh)
            .catch((e) => setError(errorMessage(e)));
        },
      });
    return items;
  };

  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Reports</h1>
          <p className="text-sm text-[var(--acton-muted)]">
            Interactive reports built from live JobTread data.
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

      {error ? (
        <Notice tone="error">
          <span className="flex items-start justify-between gap-2">
            {error}
            <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
              <X className="h-4 w-4" />
            </button>
          </span>
        </Notice>
      ) : null}

      <Link
        href="/reports/new"
        className="flex items-center gap-3 rounded-xl border border-[var(--acton-border)] bg-white px-4 py-2.5 shadow-sm hover:border-[var(--acton-navy)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
      >
        <AgentAvatar name="Dexter" url={dexterAvatarUrl} size={36} color="#0f766e" />
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-[var(--acton-navy)]">Tell Dexter what you need</span>
          <span className="text-[var(--acton-muted)]">
            {" "}
            — “Show active projects by phase and PM”, “Compare ADU model pricing”, “Put my
            commission reports in Sales”
          </span>
        </p>
        <span className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex")}>Start</span>
      </Link>

      {showDiscovery && suggestions.length ? (
        <CollapsibleSection
          id="suggested"
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
          title="Suggested reports"
          collapsed={prefs.suggestionsCollapsed}
          onToggle={() => togglePref("suggestionsCollapsed")}
          aside={
            <Link
              href="/reports/catalog"
              className="text-xs font-semibold text-[var(--acton-navy)] hover:underline"
            >
              Why some aren&apos;t possible yet →
            </Link>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {suggestions.slice(0, 4).map((s) => (
              <div
                key={s.key}
                className="relative flex flex-col rounded-lg border border-[var(--acton-border)] bg-white p-3"
              >
                <button
                  type="button"
                  aria-label={`Dismiss suggestion: ${s.title}`}
                  title="Dismiss"
                  onClick={() => {
                    setSuggestions((list) => list.filter((x) => x.key !== s.key));
                    void aiFetch("/api/reports/suggestions", {
                      method: "POST",
                      body: JSON.stringify({ op: "dismiss", key: s.key }),
                    }).catch(() => void loadSuggestions());
                  }}
                  className="absolute top-2 right-2 rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <p className="pr-6 text-sm font-semibold text-[var(--acton-navy)]">{s.title}</p>
                <p className="mt-0.5 line-clamp-2 flex-1 text-xs text-[var(--acton-muted)]">
                  {s.description}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Link
                    href={`/reports/new?prompt=${encodeURIComponent(s.prompt)}&suggestion=${encodeURIComponent(s.key)}`}
                    className={buttonVariants({ size: "sm", variant: "secondary" })}
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden /> Build with Dexter
                  </Link>
                  {s.state === "in_progress" ? (
                    <span className="text-xs text-[var(--acton-muted)]">In progress</span>
                  ) : s.status === "ready_with_gaps" ? (
                    <span className="text-xs text-amber-700">Some data partial</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      {showDiscovery && templates.length ? (
        <CollapsibleSection
          id="templates"
          icon={<LayoutTemplate className="h-4 w-4" aria-hidden />}
          title="Start from a template"
          collapsed={prefs.templatesCollapsed}
          onToggle={() => togglePref("templatesCollapsed")}
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="template-gallery">
            {templates.map((t) => {
              const blank = t.templateKey === "blank";
              return (
                <div
                  key={t.id}
                  className="flex min-w-0 flex-col rounded-lg border border-[var(--acton-border)] bg-white p-3"
                >
                  <p className="truncate text-sm font-semibold text-[var(--acton-navy)]">
                    {blank ? "Blank Report" : t.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 flex-1 text-xs text-[var(--acton-muted)]">
                    {blank ? "Start from an empty canvas." : t.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() =>
                        void create(
                          blank ? { from: "blank" } : { from: "report", reportId: t.id },
                          t.id,
                        )
                      }
                    >
                      {busy === t.id ? "Creating…" : blank ? "Create" : "Use template"}
                    </Button>
                    {!blank ? (
                      <Link
                        href={`/reports/${t.id}`}
                        className={buttonVariants({ size: "sm", variant: "ghost" })}
                      >
                        Preview
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      ) : null}

      <section id="report-library" aria-label="Your reports" className="space-y-2 pt-1">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <nav aria-label="Report lists" className="-mx-1 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none",
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
              placeholder={selectedGroup ? `Search in ${selectedGroup.name}` : "Search reports"}
              className="h-9 w-full rounded-md border border-[var(--acton-border)] bg-white pr-3 pl-9 text-sm"
            />
          </label>
        </div>
        {tab !== "templates" ? (
          <GroupBar
            groups={activeGroups}
            selected={group}
            onSelect={setGroup}
            counts={counts}
            onNew={() => setGroupDialog({ group: null })}
            onManage={() => setManageOpen(true)}
          />
        ) : null}
        {query && group !== "all" ? (
          <p className="text-xs text-[var(--acton-muted)]">
            Searching only in <strong>{selectedGroup?.name ?? "Ungrouped"}</strong>.{" "}
            <button
              type="button"
              className="font-semibold text-[var(--acton-navy)] underline"
              onClick={() => setGroup("all")}
            >
              Search all groups
            </button>
          </p>
        ) : null}

        {!reports ? (
          <p className="text-sm text-[var(--acton-muted)]">Loading reports…</p>
        ) : shown.length ? (
          <ReportGrid
            reports={shown}
            groupsById={groupsById}
            showGroup={group === "all"}
            menuFor={menuFor}
          />
        ) : selectedGroup && !query ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-[var(--acton-border)] bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-[var(--acton-navy)]">
              <Folder className="h-4 w-4 text-[var(--acton-muted)]" aria-hidden /> No reports in{" "}
              <strong>{selectedGroup.name}</strong>
              {tab !== "all" ? ` on the ${TABS.find((t) => t.key === tab)?.label} tab` : ""} yet.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/reports/new?prompt=${encodeURIComponent(`Create a report and save it in my ${selectedGroup.name} group: `)}`}
                className={buttonVariants({ size: "sm", variant: "accent" })}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Create with Dexter
              </Link>
              <Button size="sm" variant="secondary" onClick={() => setAdding(selectedGroup)}>
                Move existing reports
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void create({ from: "blank", groupId: selectedGroup.id }, "blank")}
              >
                Blank report
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState
            title={
              query
                ? "No reports match your search"
                : tab === "all" && group === "all"
                  ? "No reports yet"
                  : "Nothing here yet"
            }
          >
            {query && group !== "all"
              ? "Try searching all groups."
              : tab === "all" && !query
                ? "Create one with Dexter or start from a template above."
                : null}
          </EmptyState>
        )}
      </section>

      {groupDialog ? (
        <GroupDialog
          group={groupDialog.group}
          canCreateCompany={Boolean(access?.canManage || access?.isAdmin)}
          onClose={() => setGroupDialog(null)}
          onSaved={async (id) => {
            setGroupDialog(null);
            await loadLibrary();
            if (!groupDialog.group) setGroup(id);
          }}
        />
      ) : null}
      {manageOpen ? (
        <ManageGroupsDialog
          groups={groups}
          onClose={() => setManageOpen(false)}
          onChanged={loadLibrary}
          onEdit={(g) => {
            setManageOpen(false);
            setGroupDialog({ group: g });
          }}
        />
      ) : null}
      {moving ? (
        <MoveDialog
          report={moving}
          groups={activeGroups}
          onClose={() => setMoving(null)}
          onMoved={loadLibrary}
        />
      ) : null}
      {adding ? (
        <AddReportsDialog
          group={adding}
          reports={reports ?? []}
          onClose={() => setAdding(null)}
          onDone={loadLibrary}
        />
      ) : null}
      {renaming ? (
        <RenameDialog
          report={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (title) => patchReport(renaming, { title })}
        />
      ) : null}
    </div>
  );
}

function CollapsibleSection({
  id,
  icon,
  title,
  collapsed,
  onToggle,
  aside,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const panelId = `${id}-panel`;
  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-sm font-semibold text-[var(--acton-navy)]">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-controls={panelId}
            className="-mx-1 inline-flex items-center gap-2 rounded px-1 py-0.5 hover:bg-white focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
          >
            {icon}
            {title}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-[var(--acton-muted)] transition-transform",
                collapsed && "-rotate-90",
              )}
              aria-hidden
            />
            <span className="sr-only">
              {collapsed ? "(collapsed — show)" : "(expanded — hide)"}
            </span>
          </button>
        </h2>
        {!collapsed ? aside : null}
      </div>
      <div id={panelId} hidden={collapsed} className="mt-2">
        {collapsed ? null : children}
      </div>
    </section>
  );
}

function RenameDialog({
  report,
  onClose,
  onSave,
}: {
  report: ReportSummary;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(report.title);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Rename report</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Input
          aria-label="Report name"
          value={title}
          maxLength={160}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy || !title.trim() || title.trim() === report.title}
          onClick={async () => {
            setBusy(true);
            await onSave(title.trim());
            setBusy(false);
            onClose();
          }}
        >
          Rename
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function ReportGrid({
  reports,
  groupsById,
  showGroup,
  menuFor,
}: {
  reports: ReportSummary[];
  groupsById: Map<string, ReportGroup>;
  showGroup: boolean;
  menuFor: (r: ReportSummary) => ActionMenuItem[];
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map((r) => {
        const g = r.groupIds.map((id) => groupsById.get(id)).find((x) => x && !x.archived);
        return (
          <li key={r.id} className="relative">
            <Link
              href={`/reports/${r.id}`}
              className="flex h-full flex-col rounded-lg border border-[var(--acton-border)] bg-white p-3.5 pr-11 shadow-sm hover:border-[var(--acton-navy)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--acton-gray-50)] text-[var(--acton-navy)]">
                  <BarChart3 className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[var(--acton-navy)]">{r.title}</p>
                  <p className="line-clamp-2 text-xs text-[var(--acton-muted)]">
                    {r.description || `${r.widgetCount} widget${r.widgetCount === 1 ? "" : "s"}`}
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--acton-muted)]">
                {r.pinned ? <Pin className="h-3.5 w-3.5" aria-label="Pinned" /> : null}
                {r.isTemplate ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                    Template
                  </span>
                ) : null}
                {showGroup && g ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--acton-gray-50)] px-2 py-0.5">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", COLOR_DOT[g.color])}
                      aria-hidden
                    />
                    {g.name}
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
            <div className="absolute top-2.5 right-2.5">
              <ActionMenu items={menuFor(r)} label={`Actions for ${r.title}`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
