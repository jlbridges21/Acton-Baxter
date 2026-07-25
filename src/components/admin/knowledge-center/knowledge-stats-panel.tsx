"use client";

import Link from "next/link";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { KnowledgeAnalytics } from "@/lib/knowledge/analytics";
import { formatDate } from "@/lib/utils";

export function KnowledgeStatsPanel({
  analytics,
  connectorLabel,
  connectorDetails,
}: {
  analytics: KnowledgeAnalytics;
  connectorLabel?: string;
  connectorDetails?: string;
}) {
  const { totals } = analytics;
  return (
    <div className="space-y-3">
      <Card>
        <CardTitle className="text-base">Statistics</CardTitle>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-[var(--acton-muted)]">Total</dt>
            <dd className="font-semibold text-[var(--acton-navy)]">{totals.total}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Approved</dt>
            <dd className="font-semibold text-emerald-800">{totals.approved}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Drafts</dt>
            <dd className="font-semibold text-amber-800">{totals.drafts}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Archived</dt>
            <dd className="font-semibold text-red-800">{totals.archived}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Manual</dt>
            <dd className="font-semibold">{totals.manual}</dd>
          </div>
          <div>
            <dt className="text-[var(--acton-muted)]">Uploads</dt>
            <dd className="font-semibold">{totals.uploaded}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[var(--acton-muted)]">Google Workspace</dt>
            <dd className="font-semibold">{totals.google}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardTitle className="text-base">Connector health</CardTitle>
        <CardDescription className="mt-2">
          {connectorLabel ?? "Open Google Workspace for live status."}
        </CardDescription>
        {connectorDetails ? (
          <p className="mt-2 text-xs text-[var(--acton-muted)]">{connectorDetails}</p>
        ) : null}
        <Link
          href="/admin/connectors/google"
          className="mt-3 inline-block text-sm font-semibold text-[var(--acton-navy)] underline"
        >
          Open Google Workspace
        </Link>
      </Card>

      <Card>
        <CardTitle className="text-base">Recent imports</CardTitle>
        <ul className="mt-3 space-y-2 text-sm">
          {analytics.recentlyImported.length === 0 ? (
            <li className="text-[var(--acton-muted)]">No imports yet.</li>
          ) : (
            analytics.recentlyImported.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/admin/knowledge/${row.id}`}
                  className="font-medium text-[var(--acton-navy)] hover:underline"
                >
                  {row.title}
                </Link>
                <div className="text-xs text-[var(--acton-muted)]">
                  {row.sourceType} · {formatDate(row.updatedAt)}
                </div>
              </li>
            ))
          )}
        </ul>
      </Card>

      {analytics.frequentlyCited.length > 0 ? (
        <Card>
          <CardTitle className="text-base">Frequently cited</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {analytics.frequentlyCited.map((row) => (
              <li key={row.id} className="flex justify-between gap-2">
                <Link
                  href={`/admin/knowledge/${row.id}`}
                  className="truncate font-medium text-[var(--acton-navy)] hover:underline"
                >
                  {row.title}
                </Link>
                <span className="shrink-0 text-xs text-[var(--acton-muted)]">
                  {row.citationCount}×
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {analytics.unusedApproved.length > 0 ? (
        <Card>
          <CardTitle className="text-base">Unused approved</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {analytics.unusedApproved.slice(0, 5).map((row) => (
              <li key={row.id}>
                <Link
                  href={`/admin/knowledge/${row.id}`}
                  className="font-medium text-[var(--acton-navy)] hover:underline"
                >
                  {row.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
