"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/pem-neat/confirm-dialog";
import { cn } from "@/lib/utils";
import { PEM_NEAT_STATUS_LABELS, type PemNeatStatus } from "@/lib/pem-neat/constants";
import type { PemNeatListItem } from "@/lib/pem-neat/types";

function formatOutcome(outcome: string | null) {
  if (!outcome) return "—";
  return outcome.replaceAll("_", " ");
}

function formatDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusLabel(status: PemNeatStatus, analysisStale: boolean) {
  if (status === "needs_regeneration" || (analysisStale && status === "completed")) {
    return PEM_NEAT_STATUS_LABELS.needs_regeneration;
  }
  return PEM_NEAT_STATUS_LABELS[status] ?? status;
}

export function PemNeatLibraryClient({ initialItems }: { initialItems: PemNeatListItem[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PemNeatListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(
    searchParams.get("deleted") === "1" ? "PEM NEAT deleted" : null,
  );
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialItems;
    return initialItems.filter(
      (item) =>
        item.prospect_name.toLowerCase().includes(q) ||
        item.salesperson_display_name.toLowerCase().includes(q),
    );
  }, [initialItems, query]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/pem-neats/${deleteTarget.id}`, { method: "DELETE" });
      const data = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to delete PEM NEAT");
      }
      setDeleteTarget(null);
      setToast("PEM NEAT deleted");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete PEM NEAT");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">
            Partnership Evaluation Meeting NEAT
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--acton-muted)]">
            Turn PEM transcripts into structured sales intelligence, follow-up, coaching, and
            project handoff data.
          </p>
        </div>
        <Link href="/pem-neats/new" className={cn(buttonVariants({ variant: "accent" }))}>
          <Plus className="h-4 w-4" />
          Add PEM NEAT
        </Link>
      </div>

      {toast ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {toast}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {initialItems.length > 0 ? (
        <div>
          <label className="sr-only" htmlFor="pem-neat-search">
            Search
          </label>
          <input
            id="pem-neat-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by prospect or salesperson…"
            className="h-10 w-full max-w-md rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-navy)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)]"
          />
        </div>
      ) : null}

      {initialItems.length === 0 ? (
        <Card>
          <CardTitle>No PEM NEATs yet</CardTitle>
          <CardDescription>
            Generate your first NEAT from a Partnership Evaluation Meeting transcript.
          </CardDescription>
          <div className="mt-4">
            <Link href="/pem-neats/new" className={cn(buttonVariants())}>
              <Plus className="h-4 w-4" />
              Add PEM NEAT
            </Link>
          </div>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardTitle>No matching NEATs</CardTitle>
          <CardDescription>Try a different search.</CardDescription>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--acton-border)] bg-white">
          <table className="min-w-full divide-y divide-[var(--acton-border)] text-sm">
            <thead className="bg-[var(--acton-gray-50)] text-left text-[var(--acton-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Prospect</th>
                <th className="px-4 py-3 font-medium">Salesperson</th>
                <th className="px-4 py-3 font-medium">Meeting</th>
                <th className="px-4 py-3 font-medium">Outcome</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--acton-border)]">
              {items.map((item) => (
                <tr key={item.id} className="text-[var(--acton-navy)]">
                  <td className="px-4 py-3 font-medium">{item.prospect_name}</td>
                  <td className="px-4 py-3">{item.salesperson_display_name}</td>
                  <td className="px-4 py-3">{item.meeting_date ?? "—"}</td>
                  <td className="px-4 py-3">{formatOutcome(item.meeting_outcome)}</td>
                  <td className="px-4 py-3">{statusLabel(item.status, item.analysis_stale)}</td>
                  <td className="px-4 py-3">{formatDate(item.updated_at)}</td>
                  <td className="relative px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        href={`/pem-neats/${item.id}`}
                        className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                        aria-label={`More actions for ${item.prospect_name}`}
                        onClick={() => setMenuOpenId((prev) => (prev === item.id ? null : item.id))}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                    {menuOpenId === item.id ? (
                      <div className="absolute right-4 z-10 mt-1 w-36 rounded-md border border-[var(--acton-border)] bg-white py-1 text-left shadow-md">
                        <Link
                          href={`/pem-neats/${item.id}/edit`}
                          className="block px-3 py-2 text-sm hover:bg-[var(--acton-gray-50)]"
                          onClick={() => setMenuOpenId(null)}
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                          onClick={() => {
                            setMenuOpenId(null);
                            setDeleteTarget(item);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete PEM NEAT?"
        description={
          deleteTarget
            ? `${deleteTarget.prospect_name}\n\nThis will remove the saved transcript and generated NEAT history from Baxter. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete PEM NEAT"
        confirming={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
