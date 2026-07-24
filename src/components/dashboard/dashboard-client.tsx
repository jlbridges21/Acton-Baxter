"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Link2, PlusCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

function reportHref(report: ReportListItem) {
  return report.status === "complete"
    ? `/reports/${report.id}`
    : `/reports/${report.id}/processing`;
}

export function DashboardClient({
  reports,
  isAdmin = false,
}: {
  reports: ReportListItem[];
  isAdmin?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [createdBy, setCreatedBy] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const creators = useMemo(() => {
    const names = new Set<string>();
    for (const report of reports) {
      if (report.creator_name) names.add(report.creator_name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [reports]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesStatus = status === "all" || report.status === status;
      const matchesCreator = !isAdmin || createdBy === "all" || report.creator_name === createdBy;
      const matchesQuery =
        !q ||
        report.input_address.toLowerCase().includes(q) ||
        report.standardized_address?.toLowerCase().includes(q) ||
        report.apn?.toLowerCase().includes(q) ||
        report.jurisdiction_name?.toLowerCase().includes(q);
      return matchesStatus && matchesCreator && matchesQuery;
    });
  }, [reports, query, status, createdBy, isAdmin]);

  const counts = useMemo(() => {
    return {
      total: reports.length,
      complete: reports.filter((report) => report.status === "complete").length,
      researching: reports.filter((report) => ["queued", "researching"].includes(report.status))
        .length,
      failed: reports.filter((report) => report.status === "failed").length,
    };
  }, [reports]);

  async function copyReportLink(report: ReportListItem) {
    const url = `${window.location.origin}${reportHref(report)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(report.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Property Research</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Research California properties and prepare for Partnership Evaluation Meetings.
          </p>
        </div>
        <Link
          href="/reports/new"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--acton-yellow)] px-4 text-sm font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-yellow-dark)]"
        >
          <PlusCircle className="h-4 w-4" />
          New Property Research
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total reports", value: counts.total },
          { label: "Complete", value: counts.complete },
          { label: "In progress", value: counts.researching },
          { label: "Failed", value: counts.failed },
        ].map((item) => (
          <Card key={item.label}>
            <p className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
              {item.label}
            </p>
            <p className="mt-2 text-3xl font-bold text-[var(--acton-navy)]">{item.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Recent reports</CardTitle>
            <CardDescription>Search by address or APN and filter by status.</CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-[240px]">
              <Search className="absolute top-3 left-3 h-4 w-4 text-[var(--acton-muted)]" />
              <Input
                className="pl-9"
                placeholder="Search address or APN"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              className="h-11 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-navy)]"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="queued">Queued</option>
              <option value="researching">Researching</option>
              <option value="complete">Complete</option>
              <option value="failed">Failed</option>
            </select>
            {isAdmin && creators.length > 0 ? (
              <select
                className="h-11 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-navy)]"
                value={createdBy}
                onChange={(event) => setCreatedBy(event.target.value)}
              >
                <option value="all">All creators</option>
                {creators.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-4 py-10 text-center">
            <p className="text-sm font-semibold text-[var(--acton-navy)]">No reports yet</p>
            <p className="mt-1 text-sm text-[var(--acton-muted)]">
              Start with a California property address to generate your first research package.
            </p>
            <Link
              href="/reports/new"
              className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white"
            >
              Create first report
            </Link>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--acton-border)] text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                <tr>
                  <th className="py-2 pr-4 font-medium">Address</th>
                  <th className="py-2 pr-4 font-medium">APN</th>
                  <th className="py-2 pr-4 font-medium">Jurisdiction</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 8).map((report) => (
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
                      {formatDate(report.created_at)}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={reportHref(report)}
                          className="font-semibold text-[var(--acton-navy)] underline"
                        >
                          Open
                        </Link>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void copyReportLink(report)}
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          {copiedId === report.id ? "Copied" : "Copy link"}
                        </Button>
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
