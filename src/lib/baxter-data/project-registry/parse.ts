/**
 * Parse Master Project Log grid (A–J) into typed rows.
 * Column order matches Project Setup append: number, short name, salesperson,
 * date, customer, street, city, ZIP, jurisdiction, status (Open/Closed).
 *
 * The live sheet has a logo banner (rows 1–5) above the header row (row 6), so
 * the header is found by scanning the first rows rather than assuming row 1.
 */

import type { ProjectLogRow, ProjectLogStatus } from "./types";

const DEFAULT_HEADERS = [
  "project number",
  "short name",
  "salesperson",
  "date",
  "customer name",
  "street address",
  "city",
  "zip",
  "jurisdiction",
  "status",
] as const;

const HEADER_SCAN_ROWS = 15;

function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function looksLikeHeaderRow(cells: string[]): boolean {
  const joined = cells.map(normHeader).join(" ");
  return (
    /\bproject\b/.test(joined) &&
    (/\bcity\b/.test(joined) || /\bcustomer\b/.test(joined) || /\bzip\b/.test(joined))
  );
}

function looksLikeProjectNumber(value: string): boolean {
  return /^[A-Za-z]\d{2}-\d{4,6}$/.test(value.trim());
}

/** Column J cell → status. Anything other than Open/Closed (including blank) is "unknown". */
export function normalizeProjectLogStatus(value: string | null | undefined): ProjectLogStatus {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "open") return "open";
  if (v === "closed") return "closed";
  return "unknown";
}

type ColumnKey = keyof Omit<ProjectLogRow, "rowNumber">;

function mapHeaderIndex(headers: string[]): Record<ColumnKey, number> {
  const idx: Partial<Record<ColumnKey, number>> = {};
  headers.forEach((h, i) => {
    const n = normHeader(h);
    if (!n) return;
    // Status first so it can never fall into a broader pattern below.
    if (/^(project\s+)?status$/.test(n)) idx.status = i;
    else if (/project\s*(number|no|#)|^\s*number\s*$/.test(n) || n === "project #")
      idx.projectNumber = i;
    else if (/^(short\s*name|last\s*name|project\s*name|name)$/.test(n)) idx.shortName = i;
    else if (/sales|rep|advisor/.test(n)) idx.salesperson = i;
    else if (/^(date|fp|start|paid)/.test(n) || n.includes("fp paid")) idx.startDate = i;
    else if (/customer|homeowner|client/.test(n)) idx.customerName = i;
    else if (/street|address1|address/.test(n) && !/email/.test(n)) idx.street = i;
    else if (/^city$/.test(n)) idx.city = i;
    else if (/zip|postal/.test(n)) idx.postalCode = i;
    else if (/jurisdiction|muni|county/.test(n)) idx.jurisdiction = i;
  });

  // Positional fallbacks (Project Setup write order A–J).
  return {
    projectNumber: idx.projectNumber ?? 0,
    shortName: idx.shortName ?? 1,
    salesperson: idx.salesperson ?? 2,
    startDate: idx.startDate ?? 3,
    customerName: idx.customerName ?? 4,
    street: idx.street ?? 5,
    city: idx.city ?? 6,
    postalCode: idx.postalCode ?? 7,
    jurisdiction: idx.jurisdiction ?? 8,
    status: idx.status ?? 9,
  };
}

function cell(row: string[], i: number): string {
  return (row[i] ?? "").trim();
}

/**
 * Convert a raw sheet grid into project log rows.
 * `grid[0]` must be sheet row 1 so `rowNumber` stays the real 1-based sheet row.
 */
export function parseMasterProjectLogGrid(grid: string[][]): ProjectLogRow[] {
  if (!grid.length) return [];

  let headerIdx = -1;
  let headers: string[] = [...DEFAULT_HEADERS];
  const scanLimit = Math.min(grid.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < scanLimit; r++) {
    if (looksLikeHeaderRow(grid[r] ?? [])) {
      headerIdx = r;
      headers = (grid[r] ?? []).map((c) => c.trim());
      break;
    }
  }

  const map = mapHeaderIndex(headers);
  const start = headerIdx + 1;
  const out: ProjectLogRow[] = [];

  for (let r = start; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const projectNumber = cell(row, map.projectNumber);
    if (!projectNumber) continue;
    // Skip non-project rows (banner text, notes, blanks).
    if (!looksLikeProjectNumber(projectNumber) && !/^[A-Za-z]\d{2}-/.test(projectNumber)) {
      continue;
    }
    out.push({
      projectNumber,
      shortName: cell(row, map.shortName),
      salesperson: cell(row, map.salesperson),
      startDate: cell(row, map.startDate),
      customerName: cell(row, map.customerName),
      street: cell(row, map.street),
      city: cell(row, map.city),
      postalCode: cell(row, map.postalCode),
      jurisdiction: cell(row, map.jurisdiction),
      status: normalizeProjectLogStatus(row[map.status]),
      rowNumber: r + 1,
    });
  }
  return out;
}
