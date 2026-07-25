import { createHash } from "node:crypto";
import type {
  DetectedTable,
  ParsedWorkbook,
  SpreadsheetRowRecord,
  SpreadsheetSummaryMetrics,
} from "./types";
import { parseCellValue } from "./values";

const MAX_SHEETS = 12;
const MAX_ROWS = 500;
const MAX_COLS = 40;

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function nonEmptyCount(row: string[]): number {
  return row.filter((c) => String(c ?? "").trim()).length;
}

function looksLikeHeaderRow(row: string[]): boolean {
  const cells = row.map((c) => String(c ?? "").trim()).filter(Boolean);
  if (cells.length < 3) return false;
  // Headers are mostly short textual labels, not long sentences or pure numbers
  const textual = cells.filter((c) => {
    if (/^\$?[\d,]+(\.\d+)?%?$/.test(c)) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return false;
    return c.length <= 48;
  });
  return textual.length / cells.length >= 0.7;
}

function sheetPriority(sheetName: string): number {
  const n = sheetName.toLowerCase();
  if (n.includes("raw")) return 10;
  if (n.includes("sales report") || n === "report") return 100;
  if (n.includes("report")) return 80;
  return 50;
}

function isSummaryLabel(cell: string): boolean {
  const n = cell.toLowerCase();
  return (
    n.startsWith("total ") ||
    n.startsWith("avg ") ||
    n.startsWith("average ") ||
    n.includes("total contracts") ||
    n.includes("total agreement") ||
    n.includes("total internal") ||
    n.includes("total gross") ||
    n.includes("avg margin")
  );
}

function rowToRecord(
  headers: string[],
  row: string[],
  meta: {
    sheetName: string;
    sheetGid: number | null;
    tableId: string;
    rowNumber: number;
    priority: number;
  },
): SpreadsheetRowRecord | null {
  const values: SpreadsheetRowRecord["values"] = {};
  let filled = 0;
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i]!;
    if (!header) continue;
    const cell = parseCellValue(row[i] ?? "");
    values[header] = cell;
    if (cell.display) filled += 1;
  }
  if (filled === 0) return null;

  // Skip pure summary rows that slipped into the table body
  const firstHeader = headers.find((h) => h);
  const firstVal = firstHeader ? (values[firstHeader]?.display ?? "") : "";
  if (isSummaryLabel(firstVal) && filled <= 3) return null;

  const displayLines = Object.entries(values)
    .filter(([, v]) => v.display)
    .map(([k, v]) => `${k}: ${v.display}`)
    .join("\n");
  const searchText = Object.entries(values)
    .filter(([, v]) => v.display)
    .map(([k, v]) => `${k} ${v.display}`)
    .join(" ");

  return {
    sheetName: meta.sheetName,
    sheetGid: meta.sheetGid,
    tableId: meta.tableId,
    rowNumber: meta.rowNumber,
    values,
    searchText,
    displayLines,
    priority: meta.priority,
  };
}

/**
 * Detect the most likely header row in a sheet grid (not always row 0).
 */
export function detectHeaderRowIndex(grid: string[][]): number | null {
  let bestIdx: number | null = null;
  let bestScore = -1;
  const limit = Math.min(grid.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const row = (grid[i] ?? []).map((c) => String(c ?? "").trim());
    if (!looksLikeHeaderRow(row)) continue;
    const width = nonEmptyCount(row);
    // Prefer rows followed by similarly wide data rows
    let consistent = 0;
    for (let j = i + 1; j < Math.min(i + 6, grid.length); j += 1) {
      const next = nonEmptyCount((grid[j] ?? []).map((c) => String(c ?? "").trim()));
      if (next >= Math.max(2, width - 2) && next <= width + 2) consistent += 1;
    }
    const score = width * 2 + consistent * 5 - i * 0.1;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Extract summary metrics from rows above/beside the main table (Total Contracts, etc.).
 */
export function extractSummaryMetrics(
  grid: string[][],
  sheetName: string,
  headerRowIndex: number | null,
): SpreadsheetSummaryMetrics[] {
  const metrics: Record<string, ReturnType<typeof parseCellValue>> = {};
  const scanEnd = headerRowIndex == null ? Math.min(grid.length, 30) : headerRowIndex;
  for (let i = 0; i < scanEnd; i += 1) {
    const row = (grid[i] ?? []).map((c) => String(c ?? "").trim());
    for (let c = 0; c < row.length - 1; c += 1) {
      const label = row[c] ?? "";
      const value = row[c + 1] ?? "";
      if (label && value && isSummaryLabel(label)) {
        metrics[label] = parseCellValue(value);
      }
    }
    // Also: single-cell "Total Contracts 27" patterns are rare; skip
  }
  if (Object.keys(metrics).length === 0) return [];
  const displayLines = Object.entries(metrics)
    .map(([k, v]) => `${k}: ${v.display}`)
    .join("\n");
  const searchText = Object.entries(metrics)
    .map(([k, v]) => `${k} ${v.display}`)
    .join(" ");
  return [{ sheetName, metrics, searchText, displayLines }];
}

export function extractNotes(grid: string[][], headerRowIndex: number | null): string[] {
  const notes: string[] = [];
  const scanEnd = headerRowIndex == null ? Math.min(grid.length, 25) : headerRowIndex;
  for (let i = 0; i < scanEnd; i += 1) {
    const row = (grid[i] ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
    if (row.length === 1 && row[0]!.length > 40) {
      notes.push(row[0]!);
    } else if (
      row.length >= 1 &&
      /internal cost reflects|lower confidence|yellow/i.test(row.join(" "))
    ) {
      notes.push(row.join(" "));
    }
  }
  return notes;
}

export function parseSheetGrid(input: {
  sheetName: string;
  sheetGid?: number | null;
  grid: string[][];
}): {
  tables: DetectedTable[];
  summaryMetrics: SpreadsheetSummaryMetrics[];
  notes: string[];
  warnings: string[];
  contentSections: string[];
} {
  const warnings: string[] = [];
  const limited = input.grid
    .slice(0, MAX_ROWS)
    .map((r) => r.slice(0, MAX_COLS).map((c) => String(c ?? "").trim()));
  if (input.grid.length > MAX_ROWS) {
    warnings.push(`Sheet “${input.sheetName}” truncated to ${MAX_ROWS} rows.`);
  }

  const headerIdx = detectHeaderRowIndex(limited);
  const summaryMetrics = extractSummaryMetrics(limited, input.sheetName, headerIdx);
  const notes = extractNotes(limited, headerIdx);
  const priority = sheetPriority(input.sheetName);
  const contentSections: string[] = [];
  const tables: DetectedTable[] = [];

  contentSections.push(`## Sheet: ${input.sheetName}`);

  if (headerIdx == null) {
    warnings.push(`No clear header row detected on “${input.sheetName}”; using raw grid fallback.`);
    // Fallback: first non-empty row as header if possible
    const first = limited.findIndex((r) => nonEmptyCount(r) >= 2);
    if (first < 0) {
      contentSections.push("(empty sheet)");
      return { tables, summaryMetrics, notes, warnings, contentSections };
    }
    const headers = (limited[first] ?? []).map((c, i) => c || `Column ${i + 1}`);
    const tableId = hash(`${input.sheetName}:${first}`);
    const rows: SpreadsheetRowRecord[] = [];
    for (let i = first + 1; i < limited.length; i += 1) {
      const rec = rowToRecord(headers, limited[i] ?? [], {
        sheetName: input.sheetName,
        sheetGid: input.sheetGid ?? null,
        tableId,
        rowNumber: i + 1,
        priority,
      });
      if (rec) rows.push(rec);
    }
    tables.push({
      id: tableId,
      sheetName: input.sheetName,
      sheetGid: input.sheetGid ?? null,
      headerRowIndex: first,
      headers,
      startRow: first + 1,
      endRow: limited.length - 1,
      rows,
      priority,
      warnings,
    });
  } else {
    const headers = (limited[headerIdx] ?? []).map((c, i) => c || `Column ${i + 1}`);
    const tableId = hash(`${input.sheetName}:${headerIdx}:${headers.join("|")}`);
    const rows: SpreadsheetRowRecord[] = [];
    for (let i = headerIdx + 1; i < limited.length; i += 1) {
      if (nonEmptyCount(limited[i] ?? []) === 0) continue;
      const rec = rowToRecord(headers, limited[i] ?? [], {
        sheetName: input.sheetName,
        sheetGid: input.sheetGid ?? null,
        tableId,
        rowNumber: i + 1,
        priority,
      });
      if (rec) rows.push(rec);
    }
    tables.push({
      id: tableId,
      sheetName: input.sheetName,
      sheetGid: input.sheetGid ?? null,
      headerRowIndex: headerIdx,
      headers,
      startRow: headerIdx + 1,
      endRow: limited.length - 1,
      rows,
      priority,
      warnings: [],
    });

    contentSections.push(`Detected table headers: ${headers.join(" | ")}`);
    contentSections.push(`Data rows: ${rows.length}`);
    for (const row of rows) {
      contentSections.push("");
      contentSections.push(row.displayLines);
    }
  }

  if (summaryMetrics.length) {
    contentSections.push("");
    contentSections.push("### Summary metrics");
    for (const s of summaryMetrics) contentSections.push(s.displayLines);
  }
  if (notes.length) {
    contentSections.push("");
    contentSections.push("### Notes");
    for (const n of notes) contentSections.push(n);
  }

  return { tables, summaryMetrics, notes, warnings, contentSections };
}

export function parseWorkbookFromSheets(
  title: string,
  sheets: Array<{ name: string; gid?: number | null; grid: string[][] }>,
): ParsedWorkbook {
  const warnings: string[] = [];
  let truncated = false;
  const parsedSheets: ParsedWorkbook["sheets"] = [];
  const contentParts: string[] = [`Spreadsheet: ${title}`];

  const limitedSheets = sheets.slice(0, MAX_SHEETS);
  if (sheets.length > MAX_SHEETS) {
    truncated = true;
    warnings.push(`Workbook truncated to ${MAX_SHEETS} sheets.`);
  }

  for (const sheet of limitedSheets) {
    if (sheet.grid.length > MAX_ROWS) truncated = true;
    const result = parseSheetGrid({
      sheetName: sheet.name,
      sheetGid: sheet.gid ?? null,
      grid: sheet.grid,
    });
    warnings.push(...result.warnings);
    parsedSheets.push({
      name: sheet.name,
      gid: sheet.gid ?? null,
      rawGrid: sheet.grid
        .slice(0, MAX_ROWS)
        .map((r) => r.slice(0, MAX_COLS).map((c) => String(c ?? "").trim())),
      tables: result.tables,
      summaryMetrics: result.summaryMetrics,
      notes: result.notes,
      warnings: result.warnings,
    });
    contentParts.push(result.contentSections.join("\n"));
  }

  return {
    title,
    sheets: parsedSheets,
    contentText: contentParts.join("\n\n"),
    warnings,
    truncated,
  };
}
