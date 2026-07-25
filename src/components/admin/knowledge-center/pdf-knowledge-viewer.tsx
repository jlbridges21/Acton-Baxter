"use client";

import { useMemo, useState } from "react";

export type PdfPageView = {
  pageNumber: number;
  text: string;
};

export function PdfKnowledgeViewer({
  title,
  pages,
  sourceUrl,
  ocrStatus,
}: {
  title: string;
  pages: PdfPageView[];
  sourceUrl?: string | null;
  ocrStatus?: string | null;
}) {
  const sorted = useMemo(() => [...pages].sort((a, b) => a.pageNumber - b.pageNumber), [pages]);
  const [pageIndex, setPageIndex] = useState(0);
  const active = sorted[pageIndex] ?? sorted[0];

  if (!sorted.length) {
    return (
      <p className="text-sm text-[var(--acton-muted)]">
        PDF page text is not indexed yet. Use Reindex or re-sync from Google.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--acton-navy)]">{title}</p>
          <p className="text-xs text-[var(--acton-muted)]">
            {sorted.length} page{sorted.length === 1 ? "" : "s"}
            {ocrStatus ? ` · ${ocrStatus}` : ""}
          </p>
        </div>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold underline"
          >
            Open original
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-[var(--acton-border)] px-3 py-1.5 text-sm font-semibold text-[var(--acton-navy)] disabled:opacity-40"
          disabled={pageIndex <= 0}
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
        >
          Previous
        </button>
        <label className="flex items-center gap-2 text-sm text-[var(--acton-navy)]">
          Page
          <select
            className="rounded-md border border-[var(--acton-border)] px-2 py-1.5 text-sm"
            value={String(active?.pageNumber ?? sorted[0]!.pageNumber)}
            onChange={(e) => {
              const num = Number(e.target.value);
              const idx = sorted.findIndex((p) => p.pageNumber === num);
              if (idx >= 0) setPageIndex(idx);
            }}
            aria-label="PDF page"
          >
            {sorted.map((p) => (
              <option key={p.pageNumber} value={p.pageNumber}>
                {p.pageNumber}
              </option>
            ))}
          </select>
          of {sorted.length}
        </label>
        <button
          type="button"
          className="rounded-md border border-[var(--acton-border)] px-3 py-1.5 text-sm font-semibold text-[var(--acton-navy)] disabled:opacity-40"
          disabled={pageIndex >= sorted.length - 1}
          onClick={() => setPageIndex((i) => Math.min(sorted.length - 1, i + 1))}
        >
          Next
        </button>
      </div>

      <div className="rounded-lg border border-[var(--acton-border)] bg-white p-4">
        <p className="mb-2 text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
          Page {active?.pageNumber}
        </p>
        <div className="max-h-[28rem] overflow-auto text-sm leading-relaxed whitespace-pre-wrap text-[var(--acton-navy)]">
          {active?.text?.trim() || "No text extracted for this page."}
        </div>
      </div>
    </div>
  );
}

export function pdfPagesFromMeta(
  metadata: Record<string, unknown>,
  content?: string | null,
): PdfPageView[] {
  const fromMeta = Array.isArray(metadata.pdfPages)
    ? (metadata.pdfPages as Array<{ pageNumber?: number; text?: string }>)
        .map((p, idx) => ({
          pageNumber: typeof p.pageNumber === "number" ? p.pageNumber : idx + 1,
          text: String(p.text ?? "").trim(),
        }))
        .filter((p) => p.text.length > 0)
    : [];

  if (fromMeta.length) return fromMeta;

  const units = Array.isArray(metadata.units) ? metadata.units : [];
  const fromUnits = (units as Array<Record<string, unknown>>)
    .filter((u) => u.unit_type === "pdf_page")
    .map((u, idx) => {
      const structured = (u.structured_data ?? {}) as Record<string, unknown>;
      const meta = (u.metadata ?? {}) as Record<string, unknown>;
      const pageNumber =
        (typeof structured.pageNumber === "number" && structured.pageNumber) ||
        (typeof meta.pageNumber === "number" && meta.pageNumber) ||
        idx + 1;
      const raw = String(u.content ?? "");
      const text = raw.replace(/^Document:[^\n]*\nPage:\s*\d+\n?/i, "").trim();
      return { pageNumber, text };
    })
    .filter((p) => p.text.length > 0);

  if (fromUnits.length) return fromUnits;

  if (!content) return [];
  const sections = content.split(/\n(?=## Page\s+\d+)/i);
  const fromContent: PdfPageView[] = [];
  for (const section of sections) {
    const match = section.match(/^## Page\s+(\d+)\s*\n([\s\S]*)/i);
    if (!match) continue;
    const text = match[2]!.trim();
    if (!text) continue;
    fromContent.push({ pageNumber: Number(match[1]), text });
  }
  return fromContent;
}
