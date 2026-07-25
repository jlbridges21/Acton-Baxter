"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { KnowledgeCenterShell } from "@/components/admin/knowledge-center/knowledge-center-shell";
import type { KnowledgeEntry, KnowledgeEntryRevision } from "@/lib/knowledge/types";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Tab = "content" | "history" | "sources" | "usage";

export function KnowledgeEntryDetailClient({
  entry,
  revisions,
  citationCount,
}: {
  entry: KnowledgeEntry;
  revisions: KnowledgeEntryRevision[];
  citationCount: number;
}) {
  const [tab, setTab] = useState<Tab>("content");
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

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "content", label: "Content" },
    { id: "history", label: "History" },
    { id: "sources", label: "Sources" },
    { id: "usage", label: "Baxter Usage" },
  ];

  return (
    <KnowledgeCenterShell
      title={entry.title}
      subtitle={`${entry.category}${entry.tags.length ? ` · ${entry.tags.join(", ")}` : ""}`}
      hideTopActions
      activeView="all"
    >
      <div className="space-y-4">
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
            </div>
            <div className="flex flex-wrap gap-2">
              {isGoogle ? (
                <Link
                  href="/admin/connectors/google"
                  className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] px-4 text-sm font-semibold"
                >
                  Manage in Google
                </Link>
              ) : null}
              <Link
                href={`/admin/knowledge/${entry.id}/edit`}
                className="inline-flex h-10 items-center rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white"
              >
                {isGoogle ? "Edit metadata" : "Edit"}
              </Link>
            </div>
          </div>

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
                {entry.summary ? (
                  <p className="text-base leading-relaxed text-[var(--acton-muted)]">
                    {entry.summary}
                  </p>
                ) : null}
                <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[var(--acton-navy)]">
                  {entry.content}
                </div>
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
                  {entry.status === "approved"
                    ? "This entry is available for retrieval when relevant."
                    : "Baxter will not use this entry until it is approved."}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </KnowledgeCenterShell>
  );
}
