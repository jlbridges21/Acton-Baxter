"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { KnowledgeCenterShell } from "@/components/admin/knowledge-center/knowledge-center-shell";
import { SpreadsheetKnowledgeViewer } from "@/components/admin/knowledge-center/spreadsheet-knowledge-viewer";
import type { KnowledgeEntry, KnowledgeEntryRevision } from "@/lib/knowledge/types";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Tab = "content" | "history" | "sources" | "usage" | "index";

export function KnowledgeEntryDetailClient({
  entry: initialEntry,
  revisions,
  citationCount,
}: {
  entry: KnowledgeEntry;
  revisions: KnowledgeEntryRevision[];
  citationCount: number;
}) {
  const router = useRouter();
  const [entry, setEntry] = useState(initialEntry);
  const [tab, setTab] = useState<Tab>("content");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const isGoogle = entry.source_type === "Google Drive" || Boolean(meta.googleManaged);
  const isUpload = entry.source_type === "uploaded_document";

  const sourceLabel = isGoogle ? "Google Workspace" : isUpload ? "Uploaded" : "Manual";
  const originalFilename = typeof meta.originalFilename === "string" ? meta.originalFilename : null;
  const lastSync =
    typeof meta.lastSyncedAt === "string"
      ? meta.lastSyncedAt
      : typeof meta.googleLastSyncedAt === "string"
        ? meta.googleLastSyncedAt
        : null;

  const isSpreadsheet = Boolean(
    meta.workbook ||
    meta.structuredIndexed ||
    (meta.google as { mimeType?: string } | undefined)?.mimeType?.includes("spreadsheet") ||
    /\.(xlsx|csv)$/i.test(String(meta.originalFilename ?? "")),
  );

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "content", label: isSpreadsheet ? "Spreadsheet" : "Content" },
    { id: "history", label: "History" },
    { id: "sources", label: "Sources" },
    { id: "usage", label: "Baxter Usage" },
    { id: "index", label: "Index" },
  ];

  async function removeFromBaxter() {
    if (
      !window.confirm(
        `Remove “${entry.title}” from Baxter?\n\nBaxter will stop using this file. The original Google Drive file will not be changed.`,
      )
    ) {
      return;
    }
    setBusy("remove");
    setError(null);
    try {
      const response = await fetch("/api/admin/connectors/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_from_baxter",
          knowledgeEntryId: entry.id,
          googleFileIds: entry.source_external_id ? [entry.source_external_id] : undefined,
        }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Remove failed");
      setMessage("File removed from Baxter");
      router.push("/admin/knowledge");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy("sync");
    setError(null);
    try {
      const response = await fetch("/api/admin/connectors/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Sync failed");
      setMessage("Knowledge updated");
      const refreshed = await fetch(`/api/admin/knowledge/${entry.id}`);
      const body = (await refreshed.json()) as { entry?: KnowledgeEntry };
      if (body.entry) setEntry(body.entry);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteEntry() {
    const label = isUpload ? "Delete from Baxter" : "Delete permanently";
    if (!window.confirm(`${label}: “${entry.title}”?`)) return;
    setBusy("delete");
    try {
      const response = await fetch(`/api/admin/knowledge/${entry.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Delete failed");
      router.push("/admin/knowledge");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <KnowledgeCenterShell
      title={entry.title}
      subtitle={`${entry.category}${entry.tags.length ? ` · ${entry.tags.join(", ")}` : ""}`}
      hideTopActions
      activeView="all"
    >
      <div className="space-y-4">
        {message ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}

        <div className="rounded-xl border border-[var(--acton-border)] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-[var(--acton-navy)]">
                {entry.title}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge
                  tone={
                    entry.status === "approved"
                      ? "green"
                      : entry.status === "archived"
                        ? "red"
                        : "amber"
                  }
                >
                  {entry.status}
                </Badge>
                <Badge tone={isGoogle ? "amber" : isUpload ? "navy" : "green"}>{sourceLabel}</Badge>
                <Badge tone="navy">v{entry.version}</Badge>
                <Badge tone={entry.status === "approved" ? "green" : "gray"}>
                  Baxter: {entry.status === "approved" ? "available" : "not used"}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-[var(--acton-muted)]">
                Updated {formatDate(entry.updated_at)}
                {entry.approved_at ? ` · Approved ${formatDate(entry.approved_at)}` : ""}
              </p>
              {isGoogle ? (
                <p className="mt-2 text-sm text-[var(--acton-muted)]">
                  Managed by Google Workspace. Edit this content in Google Drive. Baxter will update
                  it on the next sync.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {isGoogle && entry.source_url ? (
                <a
                  href={entry.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] px-4 text-sm font-semibold"
                >
                  Open in Google
                </a>
              ) : null}
              {isGoogle ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy === "sync"}
                    onClick={() => void syncNow()}
                  >
                    {busy === "sync" ? "Syncing…" : "Sync now"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy === "remove"}
                    onClick={() => void removeFromBaxter()}
                  >
                    {busy === "remove" ? "Removing…" : "Remove from Baxter"}
                  </Button>
                </>
              ) : (
                <>
                  <Link
                    href={`/admin/knowledge/${entry.id}/edit`}
                    className="inline-flex h-10 items-center rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white"
                  >
                    Edit
                  </Link>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy === "delete"}
                    onClick={() => void deleteEntry()}
                  >
                    {isUpload ? "Delete from Baxter" : "Delete permanently"}
                  </Button>
                </>
              )}
            </div>
          </div>

          {isGoogle && lastSync ? (
            <p className="mt-4 text-sm text-[var(--acton-muted)]">
              Last synced: {formatDate(lastSync)}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-1 border-b border-[var(--acton-border)]">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-semibold transition",
                  tab === item.id
                    ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
                    : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-navy)]",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {tab === "content" ? (
              <div className="space-y-4">
                {isSpreadsheet && meta.workbook ? (
                  <SpreadsheetKnowledgeViewer
                    title={entry.title}
                    workbook={
                      meta.workbook as {
                        title?: string;
                        sheets?: Array<{ name: string; gid?: number | null; grid: string[][] }>;
                      }
                    }
                    sourceUrl={entry.source_url}
                  />
                ) : (
                  <>
                    {entry.summary ? (
                      <p className="text-base leading-relaxed text-[var(--acton-muted)]">
                        {entry.summary}
                      </p>
                    ) : null}
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[var(--acton-navy)]">
                      {entry.content}
                    </div>
                    {isSpreadsheet ? (
                      <p className="text-sm text-amber-800">
                        Structured table view unavailable until this source is re-synced or
                        reindexed.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {tab === "history" ? (
              <div className="space-y-3">
                {revisions.length === 0 ? (
                  <p className="text-sm text-[var(--acton-muted)]">No revisions recorded yet.</p>
                ) : (
                  revisions.map((rev) => (
                    <Card key={rev.id}>
                      <CardTitle className="text-sm">
                        Version {rev.version} · {formatDate(rev.created_at)}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {rev.change_note || "No change note."}
                      </CardDescription>
                    </Card>
                  ))
                )}
                <Link
                  href={`/admin/knowledge/${entry.id}/history`}
                  className="text-sm font-semibold underline"
                >
                  Full revision history
                </Link>
              </div>
            ) : null}

            {tab === "sources" ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">Source type</dt>
                  <dd className="text-[var(--acton-muted)]">{sourceLabel}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Source name</dt>
                  <dd className="text-[var(--acton-muted)]">{entry.source_name || "—"}</dd>
                </div>
                {originalFilename ? (
                  <div>
                    <dt className="font-semibold">Original filename</dt>
                    <dd className="text-[var(--acton-muted)]">{originalFilename}</dd>
                  </div>
                ) : null}
                {entry.source_url ? (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold">
                      {isGoogle ? "Original Google file" : "Source URL"}
                    </dt>
                    <dd>
                      <a
                        href={entry.source_url}
                        className="text-[var(--acton-navy)] underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {entry.source_url}
                      </a>
                    </dd>
                  </div>
                ) : null}
                {lastSync ? (
                  <div>
                    <dt className="font-semibold">Last sync</dt>
                    <dd className="text-[var(--acton-muted)]">{formatDate(lastSync)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-semibold">Last modified in Baxter</dt>
                  <dd className="text-[var(--acton-muted)]">{formatDate(entry.updated_at)}</dd>
                </div>
              </dl>
            ) : null}

            {tab === "usage" ? (
              <div className="space-y-2 text-sm">
                <p>
                  Cited by Baxter in <strong>{citationCount}</strong> recorded answer
                  {citationCount === 1 ? "" : "s"}.
                </p>
                <p className="text-[var(--acton-muted)]">
                  Past answers keep frozen source titles and links even if this entry is removed
                  from active Knowledge.
                </p>
              </div>
            ) : null}

            {tab === "index" ? (
              <div className="space-y-3 text-sm">
                <p className="text-[var(--acton-muted)]">
                  Rebuild retrieval units for this source without re-importing from Google.
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy === "reindex"}
                  onClick={async () => {
                    setBusy("reindex");
                    setError(null);
                    try {
                      const response = await fetch("/api/admin/knowledge/reindex", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ entryId: entry.id }),
                      });
                      const payload = (await response.json()) as {
                        error?: { message?: string };
                        result?: { unitCount?: number; rowCount?: number };
                      };
                      if (!response.ok) throw new Error(payload.error?.message ?? "Reindex failed");
                      setMessage(
                        `Indexed ${payload.result?.unitCount ?? 0} units` +
                          (payload.result?.rowCount ? ` (${payload.result.rowCount} rows)` : ""),
                      );
                      router.refresh();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Reindex failed");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === "reindex" ? "Reindexing…" : "Reindex"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </KnowledgeCenterShell>
  );
}
