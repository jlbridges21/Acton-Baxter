"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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

export function PemNeatLibraryClient({ initialItems }: { initialItems: PemNeatListItem[] }) {
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialItems;
    return initialItems.filter(
      (item) =>
        item.prospect_name.toLowerCase().includes(q) ||
        item.salesperson_display_name.toLowerCase().includes(q),
    );
  }, [initialItems, query]);

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
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--acton-border)]">
              {items.map((item) => (
                <tr key={item.id} className="text-[var(--acton-navy)]">
                  <td className="px-4 py-3 font-medium">{item.prospect_name}</td>
                  <td className="px-4 py-3">{item.salesperson_display_name}</td>
                  <td className="px-4 py-3">{item.meeting_date ?? "—"}</td>
                  <td className="px-4 py-3">{formatOutcome(item.meeting_outcome)}</td>
                  <td className="px-4 py-3 capitalize">{item.status}</td>
                  <td className="px-4 py-3">{formatDate(item.updated_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/pem-neats/${item.id}`}
                      className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
