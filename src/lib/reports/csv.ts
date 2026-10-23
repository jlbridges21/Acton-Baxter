/**
 * CSV export. Values come from an already-authorized execution result, so only fields
 * the viewer may see are written. Cells that a spreadsheet would treat as a formula are
 * prefixed with an apostrophe (CSV injection guard).
 */

import type { CellValue } from "./compute";

function cell(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  let text = Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !(typeof value === "number")) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: CellValue[][]): string {
  return (
    [headers.map((h) => cell(h)), ...rows.map((r) => r.map((v) => cell(v)))]
      .map((r) => r.join(","))
      .join("\r\n") + "\r\n"
  );
}

export function csvFilename(title: string): string {
  const base =
    title
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "report";
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
}
