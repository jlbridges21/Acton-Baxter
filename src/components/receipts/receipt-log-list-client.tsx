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
  basePath,
  align = "left",
}: {
  label: string;
  field: ReceiptLogSortField;
  filters: ReceiptLogFiltersState;
  basePath: string;
  align?: "left" | "right";
}) {
  const active = filters.sort === field;
  const nextDir = active && filters.dir === "asc" ? "desc" : "asc";
  const href = buildReceiptLogHref(
    {
      ...filters,
      sort: field,
      dir: active
        ? nextDir
        : field === "logged" || field === "purchased" || field === "amount"
          ? "desc"
          : "asc",
    },
    basePath,
  );
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

function PhotoCell({ row, size = "sm" }: { row: ReceiptLogRow; size?: "sm" | "md" }) {
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
  const dim = size === "md" ? "h-16 w-16" : "h-12 w-12";
  return (
    <a href={row.photoPermalink} target="_blank" rel="noreferrer" className="inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
      <img
        src={row.photoSignedUrl}
        alt={`Receipt from ${row.vendor}`}
        className={`${dim} rounded border border-[var(--acton-border)] object-cover`}
      />
    </a>
  );
}

export type ReceiptLogListVariant = "admin" | "mine";

/**
 * Shared receipt list (table + cards). Admin adds user column + soft-delete;
 * mine is owner-scoped, read-only, with card-first mobile scanning.
 */
export function ReceiptLogListClient({
  rows,
  filters,
  totalMatching,
  totalAmountCents,
  hasMore,
  nextOffset,
  exportHref,
  basePath,
  variant,
}: {
  rows: ReceiptLogRow[];
  filters: ReceiptLogFiltersState;
  totalMatching: number;
  totalAmountCents: number;
  hasMore: boolean;
  nextOffset: number;
  exportHref: string;
  basePath: string;
  variant: ReceiptLogListVariant;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showUser = variant === "admin";
  const canDelete = variant === "admin";
  const cardFirst = variant === "mine";

  async function handleDelete(row: ReceiptLogRow) {
    if (!canDelete) return;
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

  const tableBreakpoint = cardFirst ? "lg" : "md";
  const tableClass =
    tableBreakpoint === "lg"
      ? "hidden overflow-x-auto lg:block"
      : "hidden overflow-x-auto md:block";
  const cardsClass = tableBreakpoint === "lg" ? "space-y-3 lg:hidden" : "space-y-2 md:hidden";

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

      <div className={tableClass}>
        <table
          className={`w-full text-left text-sm ${showUser ? "min-w-[960px]" : "min-w-[800px]"}`}
        >
          <thead className="border-b border-[var(--acton-border)] text-xs">
            <tr>
              {showUser ? (
                <SortHeader label="User" field="user" filters={filters} basePath={basePath} />
              ) : null}
              <SortHeader label="Logged" field="logged" filters={filters} basePath={basePath} />
              <SortHeader
                label="Purchased"
                field="purchased"
                filters={filters}
                basePath={basePath}
              />
              <th className="py-2 pr-3 font-medium text-[var(--acton-muted)]">Photo</th>
              <SortHeader label="Job" field="job" filters={filters} basePath={basePath} />
              <SortHeader label="Vendor" field="vendor" filters={filters} basePath={basePath} />
              <SortHeader
                label="Amount"
                field="amount"
                filters={filters}
                basePath={basePath}
                align="right"
              />
              <th className="py-2 pr-3 font-medium text-[var(--acton-muted)]">Items</th>
              <th className="py-2 pr-3 font-medium text-[var(--acton-muted)]">Description</th>
              {canDelete ? <th className="py-2 font-medium text-[var(--acton-muted)]" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={(showUser ? 9 : 8) + (canDelete ? 1 : 0)}
                  className="py-8 text-center text-[var(--acton-muted)]"
                >
                  No receipts match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--acton-border)]/70 align-top">
                  {showUser ? (
                    <td
                      className="py-3 pr-3 font-medium text-[var(--acton-navy)]"
                      title={row.submitterEmail ?? row.submitterLabel}
                    >
                      <span className="block">{row.submitterName}</span>
                      {row.submitterEmail ? (
                        <span className="mt-0.5 block text-xs font-normal text-[var(--acton-muted)]">
                          {row.submitterEmail}
                        </span>
                      ) : null}
                    </td>
                  ) : null}
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
                  {canDelete ? (
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
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={cardsClass}>
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
                  <p
                    className={`font-semibold text-[var(--acton-navy)] ${cardFirst ? "text-base" : "text-sm"}`}
                  >
                    {row.vendor}
                  </p>
                  {showUser ? (
                    <p
                      className="mt-0.5 text-xs text-[var(--acton-muted)]"
                      title={row.submitterEmail ?? undefined}
                    >
                      {row.submitterLabel || row.submitterName} · purchased {row.purchasedOn}
                    </p>
                  ) : (
                    <p
                      className={`mt-0.5 text-[var(--acton-muted)] ${cardFirst ? "text-sm" : "text-xs"}`}
                    >
                      Purchased {row.purchasedOn}
                    </p>
                  )}
                  <p
                    className={`mt-0.5 text-[var(--acton-muted)] ${cardFirst ? "text-sm" : "text-xs"}`}
                  >
                    Logged {row.createdAt.slice(0, 10)} · {row.jobLabel}
                    {row.isCustomJob ? " (custom)" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`font-semibold text-[var(--acton-navy)] tabular-nums ${cardFirst ? "text-lg" : "text-sm"}`}
                  >
                    {formatCentsAsUsd(row.amountCents)}
                  </p>
                  <div className="mt-2 flex justify-end">
                    <PhotoCell row={row} size={cardFirst ? "md" : "sm"} />
                  </div>
                </div>
              </div>
              {row.items ? (
                <p className={`mt-2 text-[var(--acton-navy)] ${cardFirst ? "text-sm" : "text-xs"}`}>
                  <ExpandableText text={row.items} />
                </p>
              ) : null}
              {row.description ? (
                <p
                  className={`mt-1 text-[var(--acton-muted)] ${cardFirst ? "text-sm" : "text-xs"}`}
                >
                  <ExpandableText text={row.description} />
                </p>
              ) : null}
              {canDelete ? (
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
              ) : null}
            </div>
          ))
        )}
      </div>

      {hasMore ? (
        <div className="flex justify-center">
          <Link
            href={buildReceiptLogHref({ ...filters, offset: nextOffset }, basePath)}
            className="inline-flex min-h-11 items-center rounded-md border border-[var(--acton-border)] px-4 text-sm font-medium text-[var(--acton-navy)]"
          >
            Load more
          </Link>
        </div>
      ) : null}
    </div>
  );
}
