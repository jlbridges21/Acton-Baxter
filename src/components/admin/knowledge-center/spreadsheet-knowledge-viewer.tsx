"use client";

import { useMemo, useState } from "react";

type WorkbookSheet = {
  name: string;
  gid?: number | null;
  grid: string[][];
};

type WorkbookMeta = {
  title?: string;
  sheets?: WorkbookSheet[];
  warnings?: string[];
};

function looksLikeHeader(row: string[]): boolean {
  const cells = row.filter((c) => c.trim());
  if (cells.length < 3) return false;
  const textual = cells.filter((c) => !/^\$?[\d,]+(\.\d+)?%?$/.test(c) && c.length <= 48);
  return textual.length / cells.length >= 0.7;
}

function detectHeaderIndex(grid: string[][]): number {
  for (let i = 0; i < Math.min(grid.length, 40); i += 1) {
    if (looksLikeHeader(grid[i] ?? [])) return i;
  }
  return 0;
}

export function SpreadsheetKnowledgeViewer({
  title,
  workbook,
  sourceUrl,
}: {
  title: string;
  workbook: WorkbookMeta;
  sourceUrl?: string | null;
}) {
  const sheets = workbook.sheets ?? [];
  const [tab, setTab] = useState(sheets[0]?.name ?? "");
  const [search, setSearch] = useState("");
  const active = sheets.find((s) => s.name === tab) ?? sheets[0];

  const { headers, rows, headerIndex } = useMemo(() => {
    const grid = active?.grid ?? [];
    const hi = detectHeaderIndex(grid);
    const headersRow = (grid[hi] ?? []).map((c) => c || "");
    const body = grid.slice(hi + 1).filter((r) => r.some((c) => String(c).trim()));
    return { headers: headersRow, rows: body, headerIndex: hi };
  }, [active]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(q)));
  }, [rows, search]);

  if (!sheets.length) {
    return (
      <p className="text-sm text-[var(--acton-muted)]">
        Spreadsheet structure is not indexed yet. Use Rebuild Baxter index or re-sync from Google.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--acton-navy)]">{title}</p>
          <p className="text-xs text-[var(--acton-muted)]">
            {filtered.length} rows
            {headerIndex > 0 ? ` · table starts at row ${headerIndex + 1}` : ""}
          </p>
        </div>
        {sourceUrl ? (
          <a
            href={
              active?.gid != null
                ? `${sourceUrl}${sourceUrl.includes("?") ? "&" : "?"}gid=${active.gid}`
                : sourceUrl
            }
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold underline"
          >
            Open in Google Sheets
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--acton-border)]">
        {sheets.map((sheet) => (
          <button
            key={sheet.name}
            type="button"
            onClick={() => setTab(sheet.name)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold ${
              (active?.name ?? tab) === sheet.name
                ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
                : "border-transparent text-[var(--acton-muted)]"
            }`}
          >
            {sheet.name}
          </button>
        ))}
      </div>

      <input
        className="w-full max-w-md rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
        placeholder="Search rows…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search spreadsheet rows"
      />

      <div className="overflow-x-auto rounded-lg border border-[var(--acton-border)]">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-[var(--acton-gray-50)]">
            <tr>
              {headers.map((header, idx) => (
                <th
                  key={`${header}-${idx}`}
                  className="border-b border-[var(--acton-border)] px-3 py-2 font-semibold whitespace-nowrap text-[var(--acton-navy)]"
                >
                  {header || `Column ${idx + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, rIdx) => (
              <tr key={rIdx} className="odd:bg-white even:bg-[var(--acton-gray-50)]/40">
                {headers.map((_, cIdx) => {
                  const cell = String(row[cIdx] ?? "");
                  const align =
                    /^\$/.test(cell) || /%$/.test(cell) || /^-?[\d,]+(\.\d+)?$/.test(cell)
                      ? "text-right tabular-nums"
                      : "text-left";
                  return (
                    <td
                      key={cIdx}
                      className={`border-b border-[var(--acton-border)]/60 px-3 py-2 whitespace-nowrap ${align}`}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
