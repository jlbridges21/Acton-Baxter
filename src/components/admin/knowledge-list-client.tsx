"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Cloud, Plus, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";
import {
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES,
  type KnowledgeEntry,
} from "@/lib/knowledge/types";
import { formatDate } from "@/lib/utils";

function statusTone(status: string) {
  if (status === "approved") return "green" as const;
  if (status === "archived") return "red" as const;
  return "amber" as const;
}

function sourceBadge(entry: KnowledgeEntry): { label: string; tone: "navy" | "amber" | "green" } {
  if (
    entry.source_type === "Google Drive" ||
    (entry.metadata as { googleManaged?: boolean } | undefined)?.googleManaged
  ) {
    return { label: "Google", tone: "amber" };
  }
  if (entry.source_type === "uploaded_document") {
    return { label: "Uploaded", tone: "navy" };
  }
  return { label: "Manual", tone: "green" };
}

function availableToBaxter(entry: KnowledgeEntry) {
  return entry.status === "approved" && entry.visibility === "internal";
}

export function KnowledgeListClient({ initialEntries }: { initialEntries: KnowledgeEntry[] }) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [sourceType, setSourceType] = useState("all");
  const [sort, setSort] = useState("updated");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const stats = useMemo(() => {
    const manual = entries.filter(
      (e) =>
        e.source_type === "manual" || e.source_type === "policy" || e.source_type === "procedure",
    ).length;
    const uploaded = entries.filter((e) => e.source_type === "uploaded_document").length;
    const google = entries.filter(
      (e) =>
        e.source_type === "Google Drive" ||
        Boolean((e.metadata as { googleManaged?: boolean } | undefined)?.googleManaged),
    ).length;
    return {
      total: entries.length,
      approved: entries.filter((e) => e.status === "approved").length,
      drafts: entries.filter((e) => e.status === "draft").length,
      archived: entries.filter((e) => e.status === "archived").length,
      manual,
      uploaded,
      google,
    };
  }, [entries]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let rows = entries.filter((entry) => {
      // Default "all" hides archived; "__all_including_archived" shows everything.
      if (status === "all" && entry.status === "archived") return false;
      if (status !== "all" && status !== "__all_including_archived" && entry.status !== status) {
        return false;
      }
      if (category !== "all" && entry.category !== category) return false;
      if (sourceType === "manual" && entry.source_type === "uploaded_document") return false;
      if (sourceType === "manual" && entry.source_type === "Google Drive") return false;
      if (sourceType === "uploaded_document" && entry.source_type !== "uploaded_document")
        return false;
      if (
        sourceType === "Google Drive" &&
        entry.source_type !== "Google Drive" &&
        !(entry.metadata as { googleManaged?: boolean } | undefined)?.googleManaged
      ) {
        return false;
      }
      if (
        sourceType !== "all" &&
        sourceType !== "manual" &&
        sourceType !== "uploaded_document" &&
        sourceType !== "Google Drive" &&
        entry.source_type !== sourceType
      ) {
        return false;
      }
      if (!query) return true;
      return [entry.title, entry.summary ?? "", entry.content, entry.category, entry.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    rows = [...rows].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "category") return a.category.localeCompare(b.category);
      if (sort === "created") return b.created_at.localeCompare(a.created_at);
      return b.updated_at.localeCompare(a.updated_at);
    });
    return rows;
  }, [entries, q, status, category, sourceType, sort]);

  async function setStatusAction(id: string, next: "draft" | "approved" | "archived") {
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
    const entry = entries.find((row) => row.id === id);
    const google =
      entry?.source_type === "Google Drive" ||
      Boolean((entry?.metadata as { googleManaged?: boolean } | undefined)?.googleManaged);
    if (google) {
      setError(
        "This entry is managed by Google Workspace. Remove it from Baxter through Google Drive Sources.",
      );
      return;
    }
    if (
      !window.confirm(
        `Permanently delete “${title}”? This cannot be undone. If Baxter has cited this entry, archive it instead.`,
      )
    ) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/knowledge/${id}`, { method: "DELETE" });
      const payload = (await response.json()) as {
        error?: { message?: string; code?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Delete failed");
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
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      action === "archived" &&
      !window.confirm(`Archive ${ids.length} selected entr${ids.length === 1 ? "y" : "ies"}?`)
    ) {
      return;
    }
    setError(null);
    for (const id of ids) {
      await setStatusAction(id, action);
    }
    setSelected(new Set());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Knowledge</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Manage manual entries, uploaded documents, and Google-managed knowledge for Baxter.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/knowledge/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)]"
          >
            <Plus className="h-4 w-4" />
            Add knowledge
          </Link>
          <Link
            href="/admin/knowledge/upload"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)]"
          >
            <Upload className="h-4 w-4" />
            Upload files
          </Link>
          <Link
            href="/admin/connectors/google"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)]"
          >
            <Cloud className="h-4 w-4" />
            Connect Google Drive
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Total", stats.total],
          ["Approved", stats.approved],
          ["Drafts", stats.drafts],
          ["Archived", stats.archived],
          ["Manual", stats.manual],
          ["Uploaded", stats.uploaded],
          ["Google", stats.google],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardDescription>{label}</CardDescription>
            <CardTitle className="mt-1 text-2xl">{value}</CardTitle>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle className="text-base">Add knowledge</CardTitle>
          <CardDescription className="mt-2">
            Create a simple title + content entry. Approve when Baxter should use it.
          </CardDescription>
          <Link
            href="/admin/knowledge/new"
            className="mt-4 inline-flex text-sm font-semibold text-[var(--acton-navy)] underline"
          >
            New entry
          </Link>
        </Card>
        <Card>
          <CardTitle className="text-base">Upload documents</CardTitle>
          <CardDescription className="mt-2">
            Import Markdown, text, PDF, Word, CSV, or Excel with preview before publishing.
          </CardDescription>
          <Link
            href="/admin/knowledge/upload"
            className="mt-4 inline-flex text-sm font-semibold text-[var(--acton-navy)] underline"
          >
            Upload documents
          </Link>
        </Card>
        <Card>
          <CardTitle className="text-base">Google Drive</CardTitle>
          <CardDescription className="mt-2">
            Select Google Docs and Sheets for Baxter and keep them synchronized. Full Shared Drive
            auth improvements continue in Prompt 2.
          </CardDescription>
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
            <Link href="/admin/connectors/google" className="text-[var(--acton-navy)] underline">
              Manage Google Drive
            </Link>
            <button
              type="button"
              className="text-[var(--acton-navy)] underline"
              onClick={() => setSourceType("Google Drive")}
            >
              View synced entries
            </button>
          </div>
        </Card>
      </div>

      <Card>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <Input
            placeholder="Search knowledge…"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            aria-label="Search knowledge"
          />
          <select
            className="h-10 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Status filter"
          >
            <option value="all">Active (hide archived)</option>
            {KNOWLEDGE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value === "archived" ? "Archived only" : value}
              </option>
            ))}
            <option value="__all_including_archived">All including archived</option>
          </select>
          <select
            className="h-10 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value)}
            aria-label="Source type filter"
          >
            <option value="all">All sources</option>
            <option value="manual">Manual</option>
            <option value="uploaded_document">Uploaded</option>
            <option value="Google Drive">Google</option>
            {KNOWLEDGE_SOURCE_TYPES.filter(
              (value) => !["manual", "uploaded_document", "Google Drive"].includes(value),
            ).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Category filter"
          >
            <option value="all">All categories</option>
            {KNOWLEDGE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort"
          >
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
            <option value="title">Title</option>
            <option value="category">Category</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm text-[var(--acton-muted)]">{filtered.length} result(s)</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={selected.size === 0}
            onClick={() => void bulk("approved")}
          >
            Approve selected
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={selected.size === 0}
            onClick={() => void bulk("archived")}
          >
            Archive selected
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={selected.size === 0}
            onClick={() => void bulk("draft")}
          >
            Restore to draft
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardTitle>No knowledge entries yet</CardTitle>
          <CardDescription className="mt-2">
            Create your first entry or upload a document for Baxter.
          </CardDescription>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => {
            const badge = sourceBadge(entry);
            return (
              <Card key={entry.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        className="mr-1"
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
                      <Link
                        href={`/admin/knowledge/${entry.id}`}
                        className="text-base font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                      >
                        {entry.title}
                      </Link>
                      <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      <Badge tone="navy">Baxter: {availableToBaxter(entry) ? "Yes" : "No"}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-[var(--acton-muted)]">
                      {(entry.summary || entry.content).slice(0, 180)}
                      {(entry.summary || entry.content).length > 180 ? "…" : ""}
                    </p>
                    <p className="mt-2 text-xs text-[var(--acton-muted)]">
                      {entry.category ? `${entry.category} · ` : ""}
                      updated {formatDate(entry.updated_at)}
                      {entry.source_url ? (
                        <>
                          {" · "}
                          <a
                            href={entry.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            Open source
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {entry.source_type === "Google Drive" ? (
                      <Link
                        href="/admin/connectors/google"
                        className="inline-flex h-8 items-center rounded-md border border-[var(--acton-border)] bg-white px-3 text-xs font-semibold text-[var(--acton-navy)]"
                      >
                        Manage source
                      </Link>
                    ) : null}
                    <Link
                      href={`/admin/knowledge/${entry.id}/edit`}
                      className="inline-flex h-8 items-center rounded-md border border-[var(--acton-border)] bg-white px-3 text-xs font-semibold text-[var(--acton-navy)]"
                    >
                      Edit
                    </Link>
                    {entry.status !== "approved" ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busyId === entry.id}
                        onClick={() => void setStatusAction(entry.id, "approved")}
                      >
                        Approve
                      </Button>
                    ) : null}
                    {entry.status !== "archived" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busyId === entry.id}
                        onClick={() => void setStatusAction(entry.id, "archived")}
                      >
                        Archive
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busyId === entry.id}
                        onClick={() => void setStatusAction(entry.id, "draft")}
                      >
                        Restore
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={busyId === entry.id}
                      onClick={() => void deleteEntry(entry.id, entry.title)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
