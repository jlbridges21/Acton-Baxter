"use client";

import { useState } from "react";
import Link from "next/link";
import type { ConnectorHealth } from "@/lib/connectors/types";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export function ConnectorsDashboardClient({
  initialConnectors,
}: {
  initialConnectors: ConnectorHealth[];
}) {
  const [connectors] = useState(initialConnectors);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Connectors</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Baxter knowledge and conversation connectors. Only configured systems show as Active.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {connectors.map((connector) => (
          <Card key={connector.key}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{connector.name}</CardTitle>
                <CardDescription className="mt-2">{connector.details}</CardDescription>
              </div>
              <StatusPill status={connector.status} label={connector.label} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--acton-muted)]">
              <div>
                <dt className="font-semibold">Last sync</dt>
                <dd>
                  {connector.lastSyncAt ? new Date(connector.lastSyncAt).toLocaleString() : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Items synced</dt>
                <dd>{connector.itemsSynced ?? "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="font-semibold">Last error</dt>
                <dd>{connector.lastError ?? "—"}</dd>
              </div>
            </dl>
            <div className="mt-4">
              {connector.key === "google_workspace" ? (
                <Link href="/admin/connectors/google">
                  <Button size="sm">Manage Google</Button>
                </Link>
              ) : null}
              {connector.key === "slack" ? (
                <Link href="/admin/slack">
                  <Button size="sm" variant="secondary">
                    Slack activity
                  </Button>
                </Link>
              ) : null}
              {connector.status === "coming_soon" ? (
                <p className="text-xs font-semibold text-[var(--acton-muted)]">Coming Soon</p>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status, label }: { status: ConnectorHealth["status"]; label: string }) {
  const className =
    status === "healthy"
      ? "bg-emerald-100 text-emerald-800"
      : status === "warning"
        ? "bg-amber-100 text-amber-900"
        : status === "coming_soon"
          ? "bg-[var(--acton-gray-100)] text-[var(--acton-muted)]"
          : "bg-red-100 text-red-800";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{label}</span>
  );
}
