"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { KnowledgeCenterShell } from "@/components/admin/knowledge-center/knowledge-center-shell";
import { KnowledgeStatsPanel } from "@/components/admin/knowledge-center/knowledge-stats-panel";
import type {
  KnowledgeCenterBasePath,
  KnowledgeCenterView,
} from "@/components/admin/knowledge-center/knowledge-center-sidebar";
import type { KnowledgeAnalytics } from "@/lib/knowledge/analytics";
import type { KnowledgeEntry } from "@/lib/knowledge/types";
import { formatDate } from "@/lib/utils";

function statusTone(status: string) {
  if (status === "approved") return "green" as const;
  if (status === "archived") return "red" as const;
  if (status === "failed") return "red" as const;
  return "amber" as const;
}

function sourceBadge(entry: KnowledgeEntry): {
  label: string;
  tone: "navy" | "amber" | "green";
  typeLabel?: string;
} {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const googleMime = String((meta.google as { mimeType?: string } | undefined)?.mimeType ?? "");
  const mime = String(meta.mimeType ?? googleMime ?? "").toLowerCase();
  const filename = String(meta.originalFilename ?? entry.source_name ?? entry.title ?? "");
  const isPdf = mime === "application/pdf" || mime.includes("pdf") || /\.pdf$/i.test(filename);

  if (
    entry.source_type === "Google Drive" ||
    (entry.metadata as { googleManaged?: boolean } | undefined)?.googleManaged
  ) {
    return {
      label: isPdf ? "Google Drive PDF" : "Google",
      tone: "amber",
      typeLabel: isPdf ? "PDF" : undefined,
    };
  }
  if (entry.source_type === "uploaded_document") {
    return { label: isPdf ? "PDF" : "Upload", tone: "navy", typeLabel: isPdf ? "PDF" : undefined };
  }
  return { label: "Manual", tone: "green" };
}

function availableToBaxter(entry: KnowledgeEntry) {
  return entry.status === "approved" && entry.visibility === "internal";
}

function isFailedImport(entry: KnowledgeEntry) {
  const meta = entry.metadata as { extractionStatus?: string; uploaded?: boolean } | undefined;
  return (
    meta?.extractionStatus === "failed" ||
    meta?.extractionStatus === "unsupported" ||
    (entry.title.toLowerCase().includes("failed") && Boolean(meta?.uploaded))
  );
}

function isGoogleManaged(entry: KnowledgeEntry) {
  const meta = entry.metadata as
    { googleManaged?: boolean; oneTimeDriveIngest?: boolean } | undefined;
  // One-time user Drive imports are drafts, not recurring sync-managed entries.
  if (meta?.oneTimeDriveIngest) return false;
  return (
    Boolean(meta?.googleManaged) ||
    (entry.source_type === "Google Drive" && meta?.googleManaged !== false)
  );
}

export function KnowledgeListClient({
  initialEntries,
  analytics,
  connectorLabel,
  connectorDetails,
  isAdmin = true,
  basePath = "/admin/knowledge",
  newEntryHref,
}: {
  initialEntries: KnowledgeEntry[];
  analytics: KnowledgeAnalytics;
  connectorLabel?: string;
  connectorDetails?: string;
  isAdmin?: boolean;
  basePath?: KnowledgeCenterBasePath;
  newEntryHref?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = (searchParams.get("view") as KnowledgeCenterView | null) ?? "all";
  const resolvedNewHref = newEntryHref ?? (isAdmin ? "/admin/knowledge/new" : "/knowledge/new");

  const [entries, setEntries] = useState(initialEntries);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recentCutoffMs] = useState(() => Date.now() - 7 * 24 * 60 * 60 * 1000);

  const activeView: KnowledgeCenterView =
    view === "recent" ||
    view === "uploads" ||
    view === "drafts" ||
    view === "approved" ||
    view === "archived" ||
    view === "failed" ||
    view === "google"
      ? view
      : "all";

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let rows = entries.filter((entry) => {
      if (activeView === "drafts" && entry.status !== "draft") return false;
      if (activeView === "approved" && entry.status !== "approved") return false;
      if (activeView === "archived" && entry.status !== "archived") return false;
      if (activeView === "failed" && !isFailedImport(entry)) return false;
      if (activeView === "uploads" && entry.source_type !== "uploaded_document") return false;
      if (
        activeView === "google" &&
        entry.source_type !== "Google Drive" &&
        !(entry.metadata as { googleManaged?: boolean } | undefined)?.googleManaged
      ) {
        return false;
      }
      if (activeView === "all" && entry.status === "archived") return false;
      if (activeView === "recent") {
        if (new Date(entry.updated_at).getTime() < recentCutoffMs) return false;
      }
      if (!query) return true;
      return [entry.title, entry.summary ?? "", entry.content, entry.category, entry.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });

    rows = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return rows;
  }, [entries, q, activeView, recentCutoffMs]);

  async function setStatusAction(id: string, next: "draft" | "approved" | "archived") {
    if (!isAdmin) return;
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/knowledge/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const payload = (await response.json()) as {
        entry?: KnowledgeEntry;
        error?: { message?: string };
      };
      if (!response.ok || !payload.entry)
        throw new Error(payload.error?.message ?? "Update failed");
      setEntries((current) => current.map((row) => (row.id === id ? payload.entry! : row)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteEntry(id: string, title: string) {
    if (!isAdmin) return;
    const entry = entries.find((row) => row.id === id);
    const google = isGoogleManaged(entry!);
    const isUpload = entry?.source_type === "uploaded_document";
    const confirmMsg = google
      ? `Remove “${title}” from Baxter?\n\nBaxter will stop using this file. The original Google Drive file will not be changed.`
      : isUpload
        ? `Delete “${title}” from Baxter?`
        : `Delete “${title}” permanently?`;
    if (!window.confirm(confirmMsg)) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      if (google) {
        const response = await fetch("/api/admin/connectors/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "remove_from_baxter",
            knowledgeEntryId: id,
            googleFileIds: entry?.source_external_id ? [entry.source_external_id] : undefined,
          }),
        });
        const payload = (await response.json()) as { error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? "Remove failed");
      } else {
        const response = await fetch(`/api/admin/knowledge/${id}`, { method: "DELETE" });
        const payload = (await response.json()) as { error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? "Delete failed");
      }
      setEntries((current) => current.filter((row) => row.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  async function bulk(action: "approved" | "archived" | "draft") {
    if (!isAdmin) return;
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      action === "archived" &&
      !window.confirm(`Archive ${ids.length} selected entr${ids.length === 1 ? "y" : "ies"}?`)
    ) {
      return;
    }
    for (const id of ids) await setStatusAction(id, action);
    setSelected(new Set());
  }

  const entryHref = (id: string) => `${basePath}/${id}`;

  return (
    <KnowledgeCenterShell
      subtitle={
        isAdmin
          ? "Everything Baxter can learn from — manual entries, uploads, and Google Workspace."
          : "Browse approved Acton knowledge and submit drafts for admin review."
      }
      activeView={activeView}
      searchValue={q}
      onSearchChange={setQ}
      isAdmin={isAdmin}
      basePath={basePath}
      newEntryHref={resolvedNewHref}
      rightPanel={
        isAdmin ? (
          <KnowledgeStatsPanel
            analytics={analytics}
            connectorLabel={connectorLabel}
            connectorDetails={connectorDetails}
          />
        ) : undefined
      }
    >
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--acton-border)] px-4 py-3">
          <div>
            <CardTitle className="text-base">Knowledge entries</CardTitle>
            <CardDescription className="mt-0.5">{filtered.length} shown</CardDescription>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selected.size === 0}
                onClick={() => void bulk("approved")}
              >
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selected.size === 0}
                onClick={() => void bulk("archived")}
              >
                Archive
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selected.size === 0}
                onClick={() => void bulk("draft")}
              >
                To draft
              </Button>
            </div>
          ) : null}
        </div>

        {error ? (
          <p
            className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="font-semibold text-[var(--acton-navy)]">Nothing here yet</p>
            <p className="mt-1 text-sm text-[var(--acton-muted)]">
              {isAdmin
                ? "Create an entry, upload a file, or sync from Google Workspace."
                : "Try a different search, or submit a new draft for review."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href={resolvedNewHref} className="text-sm font-semibold underline">
                {isAdmin ? "New Entry" : "Add New"}
              </Link>
              {isAdmin ? (
                <>
                  <Link href="/admin/knowledge/upload" className="text-sm font-semibold underline">
                    Upload Files
                  </Link>
                  <Link href="/admin/connectors/google" className="text-sm font-semibold underline">
                    Google Workspace
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[var(--acton-gray-50)] text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                <tr>
                  {isAdmin ? (
                    <th className="px-3 py-2 font-semibold">
                      <span className="sr-only">Select</span>
                    </th>
                  ) : null}
                  <th className="px-3 py-2 font-semibold">Title</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Updated</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Baxter</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const badge = sourceBadge(entry);
                  return (
                    <tr
                      key={entry.id}
                      className="border-t border-[var(--acton-border)] hover:bg-[var(--acton-gray-50)]/70"
                    >
                      {isAdmin ? (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(entry.id)}
                            aria-label={`Select ${entry.title}`}
                            onChange={() => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(entry.id)) next.delete(entry.id);
                                else next.add(entry.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-3">
                        <Link
                          href={entryHref(entry.id)}
                          className="font-semibold text-[var(--acton-navy)] hover:underline"
                        >
                          {entry.title}
                        </Link>
                        {badge.typeLabel ? (
                          <p className="mt-0.5 text-xs font-medium text-[var(--acton-muted)]">
                            {badge.typeLabel}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                        {isFailedImport(entry) ? (
                          <Badge tone="red" className="ml-1">
                            Failed
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-[var(--acton-muted)]">
                        {formatDate(entry.updated_at)}
                      </td>
                      <td className="px-3 py-3 text-[var(--acton-muted)]">{entry.category}</td>
                      <td className="px-3 py-3">
                        <Badge tone={availableToBaxter(entry) ? "green" : "gray"}>
                          {availableToBaxter(entry) ? "Used" : "No"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Link
                            href={entryHref(entry.id)}
                            className="rounded px-2 py-1 text-xs font-semibold text-[var(--acton-navy)] hover:bg-white"
                          >
                            Open
                          </Link>
                          {(entry.source_type === "Google Drive" || isGoogleManaged(entry)) &&
                          entry.source_url ? (
                            <a
                              href={entry.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded px-2 py-1 text-xs font-semibold text-[var(--acton-navy)] hover:bg-white"
                            >
                              Open in Google
                            </a>
                          ) : null}
                          {isAdmin && entry.status !== "approved" ? (
                            <button
                              type="button"
                              className="rounded px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-white"
                              disabled={busyId === entry.id}
                              onClick={() => void setStatusAction(entry.id, "approved")}
                            >
                              Approve
                            </button>
                          ) : null}
                          {isAdmin && entry.status !== "archived" ? (
                            <button
                              type="button"
                              className="rounded px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-white"
                              disabled={busyId === entry.id}
                              onClick={() => void setStatusAction(entry.id, "archived")}
                            >
                              Archive
                            </button>
                          ) : null}
                          {isAdmin ? (
                            <button
                              type="button"
                              className="rounded px-2 py-1 text-xs font-semibold text-red-700 hover:bg-white"
                              disabled={busyId === entry.id}
                              onClick={() => void deleteEntry(entry.id, entry.title)}
                            >
                              {isGoogleManaged(entry)
                                ? "Remove from Baxter"
                                : entry.source_type === "uploaded_document"
                                  ? "Delete from Baxter"
                                  : "Delete permanently"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </KnowledgeCenterShell>
  );
}
