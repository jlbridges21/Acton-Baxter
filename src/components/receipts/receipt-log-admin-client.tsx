"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCentsAsUsd } from "@/lib/receipts/amount";
import {
  buildReceiptLogHref,
  type ReceiptLogFiltersState,
  type ReceiptLogSortField,
} from "@/lib/receipts/log-filter-url";
import type { ReceiptLogRow } from "@/lib/receipts/log-query";

function ExpandableText({ text, emptyLabel = "—" }: { text: string | null; emptyLabel?: string }) {
  const [open, setOpen] = useState(false);
  if (!text?.trim()) {
    return <span className="text-[var(--acton-muted)]">{emptyLabel}</span>;
  }
  const collapsed = text.length > 80 && !open;
  return (
    <button
      type="button"
      className="max-w-full text-left text-sm text-[var(--acton-navy)] hover:underline"
      onClick={() => setOpen((v) => !v)}
      title={open ? "Collapse" : "Expand"}
    >
      {collapsed ? `${text.slice(0, 80)}…` : text}
    </button>
  );
}

function SortHeader({
  label,
  field,
  filters,
  align = "left",
}: {
  label: string;
  field: ReceiptLogSortField;
  filters: ReceiptLogFiltersState;
  align?: "left" | "right";
}) {
  const active = filters.sort === field;
  const nextDir = active && filters.dir === "asc" ? "desc" : "asc";
  const href = buildReceiptLogHref({
    ...filters,
    sort: field,
    dir: active
      ? nextDir
      : field === "logged" || field === "purchased" || field === "amount"
        ? "desc"
        : "asc",
  });
  const arrow = active ? (filters.dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th className={`py-2 pr-3 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <Link
        href={href}
        className={`inline-flex items-center gap-0.5 hover:text-[var(--acton-navy)] ${
          active ? "text-[var(--acton-navy)]" : "text-[var(--acton-muted)]"
        }`}
      >
        {label}
        {arrow}
      </Link>
    </th>
  );
}

function PhotoCell({ row }: { row: ReceiptLogRow }) {
  if (!row.photoStoragePath) {
    return <span className="text-xs text-[var(--acton-muted)]">No photo</span>;
  }
  if (!row.photoSignedUrl) {
    return (
      <a
        href={row.photoPermalink}
        className="text-xs font-medium text-sky-700 hover:underline"
        target="_blank"
        rel="noreferrer"
      >
        View photo
      </a>
    );
  }
  return (
    <a href={row.photoPermalink} target="_blank" rel="noreferrer" className="inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
      <img
        src={row.photoSignedUrl}
        alt={`Receipt from ${row.vendor}`}
        className="h-12 w-12 rounded border border-[var(--acton-border)] object-cover"
      />
    </a>
  );
}

export function ReceiptLogAdminClient({
  rows,
  filters,
  totalMatching,
  totalAmountCents,
  hasMore,
  nextOffset,
  exportHref,
}: {
  rows: ReceiptLogRow[];
  filters: ReceiptLogFiltersState;
  totalMatching: number;
  totalAmountCents: number;
  hasMore: boolean;
  nextOffset: number;
  exportHref: string;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(row: ReceiptLogRow) {
    const ok = window.confirm(
      `Soft-delete this receipt from ${row.vendor} (${formatCentsAsUsd(row.amountCents)})? It will disappear from the log, totals, and export.`,
    );
    if (!ok) return;
    setDeletingId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/receipts/${row.id}`, { method: "DELETE" });
      const payload = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(payload.error?.message ?? "Could not delete receipt");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete receipt");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--acton-muted)]">
          Showing {rows.length} of {totalMatching} · Total{" "}
          <span className="font-semibold text-[var(--acton-navy)]">
            {formatCentsAsUsd(totalAmountCents)}
          </span>
        </p>
        <a
          href={exportHref}
          className="inline-flex min-h-11 items-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-medium text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
        >
          Export CSV
        </a>
      </div>

      {error ? (
        <p
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-[var(--acton-border)] text-xs">
            <tr>
              <SortHeader label="User" field="user" filters={filters} />
              <SortHeader label="Logged" field="logged" filters={filters} />
              <SortHeader label="Purchased" field="purchased" filters={filters} />
              <th className="py-2 pr-3 font-medium text-[var(--acton-muted)]">Photo</th>
              <SortHeader label="Job" field="job" filters={filters} />
              <SortHeader label="Vendor" field="vendor" filters={filters} />
              <SortHeader label="Amount" field="amount" filters={filters} align="right" />
              <th className="py-2 pr-3 font-medium text-[var(--acton-muted)]">Items</th>
              <th className="py-2 pr-3 font-medium text-[var(--acton-muted)]">Description</th>
              <th className="py-2 font-medium text-[var(--acton-muted)]" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-[var(--acton-muted)]">
                  No receipts match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--acton-border)]/70 align-top">
                  <td className="py-3 pr-3 font-medium text-[var(--acton-navy)]">
                    {row.submitterName}
                  </td>
                  <td className="py-3 pr-3 text-[var(--acton-muted)]">
                    {row.createdAt.slice(0, 10)}
                  </td>
                  <td className="py-3 pr-3 text-[var(--acton-muted)]">{row.purchasedOn}</td>
                  <td className="py-3 pr-3">
                    <PhotoCell row={row} />
                  </td>
                  <td className="max-w-[180px] py-3 pr-3 text-[var(--acton-navy)]">
                    <span className="line-clamp-2">{row.jobLabel}</span>
                    {row.isCustomJob ? (
                      <span className="mt-0.5 block text-[10px] font-medium tracking-wide text-amber-800 uppercase">
                        Custom
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 text-[var(--acton-navy)]">{row.vendor}</td>
                  <td className="py-3 pr-3 text-right font-medium text-[var(--acton-navy)] tabular-nums">
                    {formatCentsAsUsd(row.amountCents)}
                  </td>
                  <td className="max-w-[160px] py-3 pr-3">
                    <ExpandableText text={row.items} />
                  </td>
                  <td className="max-w-[200px] py-3 pr-3">
                    <ExpandableText text={row.description} />
                  </td>
                  <td className="py-3 text-right">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={deletingId === row.id}
                      onClick={() => void handleDelete(row)}
                    >
                      {deletingId === row.id ? "…" : "Delete"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {rows.length === 0 ? (
          <p className="rounded-md border border-[var(--acton-border)] px-3 py-6 text-center text-sm text-[var(--acton-muted)]">
            No receipts match these filters.
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="rounded-md border border-[var(--acton-border)] bg-white px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--acton-navy)]">{row.vendor}</p>
                  <p className="mt-0.5 text-xs text-[var(--acton-muted)]">
                    {row.submitterName} · purchased {row.purchasedOn}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--acton-muted)]">
                    Logged {row.createdAt.slice(0, 10)} · {row.jobLabel}
                    {row.isCustomJob ? " (custom)" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-[var(--acton-navy)] tabular-nums">
                    {formatCentsAsUsd(row.amountCents)}
                  </p>
                  <div className="mt-2">
                    <PhotoCell row={row} />
                  </div>
                </div>
              </div>
              {row.items ? (
                <p className="mt-2 text-xs text-[var(--acton-navy)]">
                  <ExpandableText text={row.items} />
                </p>
              ) : null}
              {row.description ? (
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  <ExpandableText text={row.description} />
                </p>
              ) : null}
              <div className="mt-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-11 w-full"
                  disabled={deletingId === row.id}
                  onClick={() => void handleDelete(row)}
                >
                  {deletingId === row.id ? "Deleting…" : "Delete"}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {hasMore ? (
        <div className="flex justify-center">
          <Link
            href={buildReceiptLogHref({ ...filters, offset: nextOffset })}
            className="inline-flex min-h-11 items-center rounded-md border border-[var(--acton-border)] px-4 text-sm font-medium text-[var(--acton-navy)]"
          >
            Load more
          </Link>
        </div>
      ) : null}
    </div>
  );
}
