"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PlusCircle, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { KnowledgeEntry } from "@/lib/knowledge/types";
import { formatDate } from "@/lib/utils";

function statusTone(status: string) {
  if (status === "approved") return "green" as const;
  if (status === "draft") return "amber" as const;
  return "navy" as const;
}

export function KnowledgeBrowseClient({
  initialEntries,
  currentUserId,
}: {
  initialEntries: KnowledgeEntry[];
  currentUserId: string;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return initialEntries.filter((entry) => {
      if (!query) return true;
      return [entry.title, entry.summary ?? "", entry.category, entry.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [initialEntries, q]);

  const drafts = filtered.filter((e) => e.status === "draft" && e.created_by === currentUserId);
  const approved = filtered.filter((e) => e.status === "approved");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Knowledge Center</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Browse approved Acton knowledge. Submit drafts for admin review before Baxter can use
            them.
          </p>
        </div>
        <Link href="/knowledge/new">
          <Button variant="accent" type="button">
            <PlusCircle className="h-4 w-4" />
            New draft
          </Button>
        </Link>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--acton-muted)]" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search knowledge…"
          className="pl-9"
        />
      </div>

      {drafts.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Your drafts</h2>
          <div className="grid gap-3">
            {drafts.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Approved</h2>
        {approved.length === 0 ? (
          <Card>
            <CardTitle>No approved entries match</CardTitle>
            <CardDescription className="mt-2">
              Try a different search, or submit a new draft for review.
            </CardDescription>
          </Card>
        ) : (
          <div className="grid gap-3">
            {approved.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EntryCard({ entry }: { entry: KnowledgeEntry }) {
  return (
    <Link
      href={`/knowledge/${entry.id}`}
      className="block rounded-lg border border-[var(--acton-border)] bg-white p-4 transition hover:border-[var(--acton-navy)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-[var(--acton-navy)]">{entry.title}</p>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">
            {entry.category}
            {entry.updated_at ? ` · Updated ${formatDate(entry.updated_at)}` : ""}
          </p>
        </div>
        <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
      </div>
      {entry.summary ? (
        <p className="mt-2 line-clamp-2 text-sm text-[var(--acton-muted)]">{entry.summary}</p>
      ) : null}
    </Link>
  );
}
