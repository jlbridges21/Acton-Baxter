"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileText, Folder, LoaderCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AsyncRunProgress, type AsyncRunStep } from "@/components/ui/async-run-progress";
import { useAsyncRunStatus } from "@/hooks/use-async-run-status";
import { googleFileIconKind } from "@/lib/connectors/google/file-icons";

type BrowseItem = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  supported: boolean;
  modifiedTime: string | null;
};

type BrowsePayload = {
  currentFolderId: string;
  currentFolderName: string;
  breadcrumbs: Array<{ id: string; name: string }>;
  items: BrowseItem[];
  scopeNote: string;
  libraryRoots: Array<{ id: string; name: string }>;
};

type IngestFile = {
  googleFileId: string;
  title: string;
  status: "pending" | "running" | "complete" | "failed" | "skipped";
  knowledgeEntryId?: string | null;
  error?: string | null;
};

type IngestProgress = {
  status: "queued" | "running" | "complete" | "failed";
  userId: string;
  rootFolderId: string;
  files: IngestFile[];
  createdCount: number;
  failedCount: number;
};

function FileIcon({ item }: { item: BrowseItem }) {
  const kind = googleFileIconKind(item.mimeType, item.isFolder);
  if (kind === "folder") return <Folder className="h-4 w-4 text-amber-700" aria-hidden />;
  return <FileText className="h-4 w-4 text-[var(--acton-navy)]" aria-hidden />;
}

/**
 * Lighter Drive file picker for users — reuses browseDriveFolder via API,
 * without admin recursive/future-file/exclusion controls.
 */
export function UserDriveIngestPicker() {
  const [browse, setBrowse] = useState<BrowsePayload | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Map<string, BrowseItem>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (nextFolderId?: string | null, nextSearch?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextFolderId) params.set("folderId", nextFolderId);
      if (nextSearch?.trim()) params.set("search", nextSearch.trim());
      const response = await fetch(`/api/knowledge/drive/browse?${params.toString()}`);
      const body = (await response.json()) as BrowsePayload & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Unable to browse Drive");
      }
      setBrowse(body);
      setFolderId(body.currentFolderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to browse Drive");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(null, "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const {
    data: progress,
    error: pollError,
    isTimedOut,
    refresh,
    resumePolling,
  } = useAsyncRunStatus<IngestProgress>({
    url: jobId ? `/api/knowledge/drive/ingest/${jobId}` : null,
    enabled: Boolean(jobId),
    isTerminal: (d) => d.status === "complete" || d.status === "failed",
  });

  const steps: AsyncRunStep[] = useMemo(() => {
    const files = progress?.files ?? [];
    return files.map((f) => ({
      key: f.googleFileId,
      label: f.title,
      status:
        f.status === "complete"
          ? "complete"
          : f.status === "failed" || f.status === "skipped"
            ? "failed"
            : f.status === "running"
              ? "running"
              : "pending",
      detail:
        f.status === "complete" && f.knowledgeEntryId ? (
          <Link href={`/knowledge/${f.knowledgeEntryId}`} className="underline">
            Open draft
          </Link>
        ) : undefined,
      error: f.error,
    }));
  }, [progress]);

  function toggleFile(item: BrowseItem) {
    if (item.isFolder || !item.supported) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  }

  async function startIngest() {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/knowledge/drive/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleFileIds: [...selected.keys()] }),
      });
      const body = (await response.json()) as { jobId?: string; error?: { message?: string } };
      if (!response.ok || !body.jobId) {
        throw new Error(body.error?.message ?? "Unable to start import");
      }
      setJobId(body.jobId);
      setSelected(new Map());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start import");
    } finally {
      setSubmitting(false);
    }
  }

  const runStatus = isTimedOut
    ? "timed_out"
    : progress?.status === "complete"
      ? "complete"
      : progress?.status === "failed"
        ? "failed"
        : "running";

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Add from Google Drive</CardTitle>
        <CardDescription className="mt-2">
          Pick files from the org Drive libraries an admin has made available. Each file becomes a{" "}
          <strong>draft</strong> for admin approval.
        </CardDescription>
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          This adds a <strong>one-time snapshot</strong> of the file. It will not stay in sync with
          future edits in Google Drive, and it is not added to the admin recurring sync list.
        </p>

        {browse?.scopeNote ? (
          <p className="mt-2 text-xs text-[var(--acton-muted)]">{browse.scopeNote}</p>
        ) : null}

        {browse && browse.libraryRoots.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {browse.libraryRoots.map((lib) => (
              <Button
                key={lib.id}
                type="button"
                size="sm"
                variant={folderId === lib.id ? "primary" : "secondary"}
                onClick={() => void load(lib.id, search)}
              >
                {lib.name}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search in this folder…"
            className="min-w-[180px] flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(folderId, search);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={() => void load(folderId, search)}
          >
            {loading ? "Loading…" : "Search"}
          </Button>
        </div>

        {browse ? (
          <nav className="mt-3 flex flex-wrap gap-1 text-sm" aria-label="Folder breadcrumbs">
            {browse.breadcrumbs.map((crumb, index) => (
              <span key={crumb.id} className="flex items-center gap-1">
                {index > 0 ? <span className="text-[var(--acton-muted)]">/</span> : null}
                <button
                  type="button"
                  className="font-semibold text-[var(--acton-navy)] hover:underline"
                  onClick={() => void load(crumb.id, "")}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        ) : null}

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-[var(--acton-border)]">
          {loading && !browse ? (
            <p className="flex items-center gap-2 px-3 py-6 text-sm text-[var(--acton-muted)]">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Opening Drive…
            </p>
          ) : browse?.items.length === 0 ? (
            <p className="px-3 py-6 text-sm text-[var(--acton-muted)]">No files in this folder.</p>
          ) : (
            <ul className="divide-y divide-[var(--acton-border)]">
              {browse?.items.map((item) => (
                <li key={item.id}>
                  {item.isFolder ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--acton-gray-50)]"
                      onClick={() => void load(item.id, "")}
                    >
                      <FileIcon item={item} />
                      <span className="font-medium text-[var(--acton-navy)]">{item.name}</span>
                    </button>
                  ) : (
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--acton-gray-50)]">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        disabled={!item.supported}
                        onChange={() => toggleFile(item)}
                      />
                      <FileIcon item={item} />
                      <span
                        className={
                          item.supported ? "text-[var(--acton-navy)]" : "text-[var(--acton-muted)]"
                        }
                      >
                        {item.name}
                        {!item.supported ? " (unsupported)" : ""}
                      </span>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={
              selected.size === 0 || submitting || Boolean(jobId && progress?.status === "running")
            }
            onClick={() => void startIngest()}
          >
            {submitting
              ? "Starting…"
              : `Add ${selected.size || ""} selected as draft${selected.size === 1 ? "" : "s"}`}
          </Button>
          {selected.size > 0 ? (
            <button
              type="button"
              className="text-sm text-[var(--acton-muted)] underline"
              onClick={() => setSelected(new Map())}
            >
              Clear selection
            </button>
          ) : null}
        </div>
      </Card>

      {jobId ? (
        <AsyncRunProgress
          title="Importing from Google Drive"
          description="Creating draft Knowledge entries from your selected files."
          steps={steps}
          runStatus={runStatus}
          friendlyError={pollError}
          onManualRefresh={() => {
            resumePolling();
            void refresh();
          }}
          footer={
            progress?.status === "complete" || progress?.status === "failed" ? (
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="inline-flex items-center gap-1 text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" /> {progress.createdCount} draft
                  {progress.createdCount === 1 ? "" : "s"} created
                </span>
                {progress.failedCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-red-700">
                    <XCircle className="h-4 w-4" /> {progress.failedCount} failed
                  </span>
                ) : null}
                <Link href="/knowledge?view=drafts" className="font-semibold underline">
                  View drafts
                </Link>
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setJobId(null);
                    void load(folderId, search);
                  }}
                >
                  Import more
                </button>
              </div>
            ) : null
          }
        />
      ) : null}
    </div>
  );
}
