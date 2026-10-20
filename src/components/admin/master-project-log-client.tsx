"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAdminSyncTime, ProjectSyncStatus } from "@/components/admin/project-sync-status";
import type { ProjectJobSyncSummary } from "@/lib/receipts/project-sync-summary";
import {
  applyProjectLogView,
  buildProjectLogViewQuery,
  countProjectLogStatuses,
  masterProjectLogSheetUrl,
  PROJECT_LOG_SORT_LABELS,
  PROJECT_LOG_STATUS_FILTERS,
  type ProjectLogSort,
  type ProjectLogStatusFilter,
  type ProjectLogViewState,
} from "@/lib/baxter-data/project-registry/log-view";
import type { ProjectLogRow, ProjectLogStatus } from "@/lib/baxter-data/project-registry";

const PAGE_PATH = "/admin/baxter/projects";

const STATUS_FILTER_LABELS: Record<ProjectLogStatusFilter, string> = {
  all: "All",
  open: "Open",
  closed: "Closed",
  unknown: "Unknown",
};

const STATUS_BADGE: Record<ProjectLogStatus, { label: string; tone: "green" | "gray" | "amber" }> =
  {
    open: { label: "Open", tone: "green" },
    closed: { label: "Closed", tone: "gray" },
    unknown: { label: "Unknown", tone: "amber" },
  };

type SyncSummary = {
  added: number;
  updated: number;
  deactivatedMissing: number;
  statusCounts: { open: number; closed: number; unknown: number };
};

function formatSyncSummary(sync: SyncSummary): string {
  const { open, closed, unknown } = sync.statusCounts;
  const parts = [
    `${sync.added} added, ${sync.updated} updated`,
    `${open} Open, ${closed} Closed, ${unknown} Unknown`,
  ];
  if (sync.deactivatedMissing > 0) {
    parts.push(
      `${sync.deactivatedMissing} no longer on the sheet ${sync.deactivatedMissing === 1 ? "was" : "were"} marked Closed`,
    );
  }
  return `Refreshed from the sheet: ${parts.join(" · ")}.`;
}

function addressOf(row: ProjectLogRow): string {
  return [row.street, row.city, row.postalCode].filter((part) => part.trim()).join(", ");
}

export function MasterProjectLogClient({
  rows,
  spreadsheetId,
  tabName,
  fetchedAt,
  fromCache,
  loadError,
  initialView,
  syncSummary,
}: {
  rows: ProjectLogRow[];
  spreadsheetId: string;
  tabName: string;
  fetchedAt: string | null;
  fromCache: boolean;
  loadError: string | null;
  initialView: ProjectLogViewState;
  /** From the project rows the tools read (expense_jobs), not the sheet. */
  syncSummary?: ProjectJobSyncSummary;
}) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => countProjectLogStatuses(rows), [rows]);
  const visible = useMemo(() => applyProjectLogView(rows, view), [rows, view]);
  const configured = Boolean(spreadsheetId && tabName);

  useEffect(() => {
    const next = `${PAGE_PATH}${buildProjectLogViewQuery(view)}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== next) window.history.replaceState(null, "", next);
  }, [view]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/expense-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_projects" }),
      });
      const payload = (await res.json()) as {
        sync?: SyncSummary;
        error?: { message?: string };
      };
      if (!res.ok || !payload.sync) {
        throw new Error(payload.error?.message ?? "Refresh failed");
      }
      setMessage(formatSyncSummary(payload.sync));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  if (!configured && !loadError) {
    return (
      <div className="rounded-md border border-[var(--acton-border)] bg-white px-4 py-6 text-sm text-[var(--acton-muted)]">
        The Master Project Log isn&apos;t set up yet. Add the Project Charter Master spreadsheet ID
        and Master Project Log tab name in{" "}
        <Link
          href="/admin/project-setup"
          className="font-medium text-[var(--acton-navy)] underline"
        >
          Project Setup Settings
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--acton-muted)]" data-testid="project-log-fetched">
          {fetchedAt ? (
            <>
              Last fetched {formatAdminSyncTime(fetchedAt)}
              {fromCache ? " (cached copy, refreshes every 90 seconds)" : " (live from the sheet)"}
            </>
          ) : (
            "Not fetched yet"
          )}
          {tabName ? <> · Tab &ldquo;{tabName}&rdquo;</> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {spreadsheetId ? (
            <a
              href={masterProjectLogSheetUrl(spreadsheetId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm font-medium text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              Open sheet
            </a>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
            {refreshing ? "Refreshing…" : "Refresh from sheet"}
          </Button>
        </div>
      </div>

      {loadError ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {loadError}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      {syncSummary ? <ProjectSyncStatus summary={syncSummary} /> : null}
      {message ? (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          {message}
        </p>
      ) : null}
      {counts.unknown > 0 ? (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          data-testid="project-log-unknown-warning"
        >
          {counts.unknown} project{counts.unknown === 1 ? " has" : "s have"} no Open/Closed status
          in column J and {counts.unknown === 1 ? "is" : "are"} hidden from tools.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="group"
          aria-label="Filter by status"
          className="flex flex-wrap gap-1 rounded-md border border-[var(--acton-border)] bg-white p-1"
        >
          {PROJECT_LOG_STATUS_FILTERS.map((status) => {
            const active = view.status === status;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                onClick={() => setView((current) => ({ ...current, status }))}
                className={`min-h-9 rounded px-3 text-sm font-medium ${
                  active
                    ? "bg-[var(--acton-navy)] text-white"
                    : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                }`}
              >
                {STATUS_FILTER_LABELS[status]}{" "}
                <span className={active ? "text-white/80" : "text-[var(--acton-muted)]"}>
                  {counts[status]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="search"
            aria-label="Search projects"
            placeholder="Search number, name, customer, advisor, city…"
            value={view.q}
            onChange={(event) => setView((current) => ({ ...current, q: event.target.value }))}
            className="min-h-10 sm:w-80"
          />
          <select
            aria-label="Sort projects"
            value={view.sort}
            onChange={(event) =>
              setView((current) => ({ ...current, sort: event.target.value as ProjectLogSort }))
            }
            className="min-h-10 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
          >
            {(Object.keys(PROJECT_LOG_SORT_LABELS) as ProjectLogSort[]).map((sort) => (
              <option key={sort} value={sort}>
                {PROJECT_LOG_SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="max-w-full overflow-x-auto rounded-md border border-[var(--acton-border)] bg-white">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-[var(--acton-border)] text-left text-xs tracking-wide text-[var(--acton-muted)] uppercase">
              <th className="px-3 py-2 font-medium">Project Number</th>
              <th className="px-3 py-2 font-medium">Project Name</th>
              <th className="px-3 py-2 font-medium">Project Advisor</th>
              <th className="px-3 py-2 font-medium">FP Date</th>
              <th className="px-3 py-2 font-medium">Customer Name</th>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 font-medium">Jurisdiction</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--acton-border)]">
            {visible.map((row) => {
              const badge = STATUS_BADGE[row.status];
              return (
                <tr key={`${row.projectNumber}-${row.rowNumber}`}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap text-[var(--acton-navy)]">
                    {row.projectNumber}
                  </td>
                  <td className="px-3 py-2">{row.shortName || "—"}</td>
                  <td className="px-3 py-2">{row.salesperson || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.startDate || "—"}</td>
                  <td className="px-3 py-2">{row.customerName || "—"}</td>
                  <td className="px-3 py-2">{addressOf(row) || "—"}</td>
                  <td className="px-3 py-2">{row.jurisdiction || "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[var(--acton-muted)]">
                  {rows.length === 0
                    ? "No projects found on the sheet."
                    : "No projects match these filters."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--acton-muted)]">
        Showing {visible.length} of {rows.length} project{rows.length === 1 ? "" : "s"}.
      </p>
    </div>
  );
}
