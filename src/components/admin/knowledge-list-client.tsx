"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
  if (status === "archived") return "gray" as const;
  return "amber" as const;
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

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let rows = entries.filter((entry) => {
      if (status !== "all" && entry.status !== status) return false;
      if (category !== "all" && entry.category !== category) return false;
      if (sourceType !== "all" && entry.source_type !== sourceType) return false;
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
    if (
      !window.confirm(`Delete “${title}”? This permanently removes the entry and its revisions.`)
    ) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/knowledge/${id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Delete failed");
      setEntries((current) => current.filter((row) => row.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Knowledge Base</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Approved entries can be retrieved by Baxter later. Drafts and archived entries are never
            used for employee answers.
          </p>
        </div>
        <Link
          href="/admin/knowledge/new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)]"
        >
          <Plus className="h-4 w-4" />
          Add Knowledge Entry
        </Link>
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
            <option value="all">All statuses</option>
            {KNOWLEDGE_STATUSES.map((value) => (
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
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value)}
            aria-label="Source type filter"
          >
            <option value="all">All source types</option>
            {KNOWLEDGE_SOURCE_TYPES.map((value) => (
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
        <p className="mt-3 text-sm text-[var(--acton-muted)]">{filtered.length} result(s)</p>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardTitle>No knowledge entries yet</CardTitle>
          <CardDescription className="mt-2">
            Create your first approved procedure, policy, or RACI note for Baxter.
          </CardDescription>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <Card key={entry.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/knowledge/${entry.id}`}
                      className="text-base font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                    >
                      {entry.title}
                    </Link>
                    <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                    <Badge tone="navy">v{entry.version}</Badge>
                    {entry.source_type === "Google Drive" ||
                    entry.metadata?.googleManaged === true ? (
                      <Badge tone="amber">Google Workspace managed</Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-[var(--acton-muted)]">
                    {(entry.summary || entry.content).slice(0, 180)}
                    {(entry.summary || entry.content).length > 180 ? "…" : ""}
                  </p>
                  <p className="mt-2 text-xs text-[var(--acton-muted)]">
                    {entry.category}
                    {entry.tags.length ? ` · ${entry.tags.join(", ")}` : ""}
                    {entry.source_name ? ` · ${entry.source_name}` : ""}
                    {` · updated ${formatDate(entry.updated_at)}`}
                    {entry.source_url && entry.source_type === "Google Drive" ? (
                      <>
                        {" · "}
                        <a
                          href={entry.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          Open in Google
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {entry.source_type === "Google Drive" ? (
                    <Link
                      href="/admin/connectors/google"
                      className="inline-flex h-8 items-center rounded-md border border-[var(--acton-border)] bg-white px-3 text-xs font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                    >
                      Manage source
                    </Link>
                  ) : null}
                  <Link
                    href={`/admin/knowledge/${entry.id}/edit`}
                    className="inline-flex h-8 items-center rounded-md border border-[var(--acton-border)] bg-white px-3 text-xs font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                  >
                    {entry.source_type === "Google Drive" ? "Metadata" : "Edit"}
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
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busyId === entry.id}
                      onClick={() => void setStatusAction(entry.id, "draft")}
                    >
                      Return to draft
                    </Button>
                  )}
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
          ))}
        </div>
      )}
    </div>
  );
}
