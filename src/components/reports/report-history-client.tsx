"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { ReportListItem } from "@/lib/research/db-types";

function statusTone(status: string) {
  switch (status) {
    case "complete":
      return "green" as const;
    case "failed":
      return "red" as const;
    case "researching":
      return "blue" as const;
    default:
      return "amber" as const;
  }
}

export function ReportHistoryClient({ reports }: { reports: ReportListItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(reports);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  async function handleRetry(reportId: string) {
    setRetryingId(reportId);
    try {
      const response = await fetch(`/api/reports/${reportId}/retry`, { method: "POST" });
      if (!response.ok) {
        throw new Error("Retry failed");
      }
      setItems((current) =>
        current.map((item) =>
          item.id === reportId ? { ...item, status: "queued", error_message: null } : item,
        ),
      );
      router.push(`/reports/${reportId}/processing`);
    } catch {
      setRetryingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Report history</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Open completed reports or retry failed research jobs.
        </p>
      </div>

      <Card>
        <CardTitle>All reports</CardTitle>
        <CardDescription>Shared across authenticated Acton users.</CardDescription>
        {items.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--acton-muted)]">
            No reports have been created yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--acton-border)] text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                <tr>
                  <th className="py-2 pr-4 font-medium">Address</th>
                  <th className="py-2 pr-4 font-medium">APN</th>
                  <th className="py-2 pr-4 font-medium">Jurisdiction</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Created by</th>
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((report) => (
                  <tr key={report.id} className="border-b border-[var(--acton-border)]">
                    <td className="py-3 pr-4 font-medium text-[var(--acton-navy)]">
                      {report.standardized_address ?? report.input_address}
                    </td>
                    <td className="py-3 pr-4 text-[var(--acton-muted)]">{report.apn ?? "—"}</td>
                    <td className="py-3 pr-4 text-[var(--acton-muted)]">
                      {report.jurisdiction_name ?? "—"}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={statusTone(report.status)}>{report.status}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-[var(--acton-muted)]">
                      {report.creator_name ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-[var(--acton-muted)]">
                      {formatDate(report.created_at)}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={
                            report.status === "complete"
                              ? `/reports/${report.id}`
                              : `/reports/${report.id}/processing`
                          }
                          className="font-semibold text-[var(--acton-navy)] underline"
                        >
                          Open
                        </Link>
                        {report.status === "failed" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={retryingId === report.id}
                            onClick={() => handleRetry(report.id)}
                          >
                            {retryingId === report.id ? "Retrying..." : "Retry"}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
