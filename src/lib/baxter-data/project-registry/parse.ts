/**
 * Parse Master Project Log grid (A–I) into typed rows.
 * Column order matches Project Setup append: number, short name, salesperson,
 * date, customer, street, city, ZIP, jurisdiction.
 */

import type { ProjectLogRow } from "./types";

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
] as const;

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

function mapHeaderIndex(headers: string[]): Record<keyof Omit<ProjectLogRow, "rowNumber">, number> {
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => {
    const n = normHeader(h);
    if (!n) return;
    if (/project\s*(number|no|#)|^\s*number\s*$/.test(n) || n === "project #")
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

  // Positional fallbacks (Project Setup write order A–I).
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
  };
}

function cell(row: string[], i: number): string {
  return (row[i] ?? "").trim();
}

/**
 * Convert a raw sheet grid into project log rows.
 */
export function parseMasterProjectLogGrid(grid: string[][]): ProjectLogRow[] {
  if (!grid.length) return [];

  let headerIdx = 0;
  let headers: string[] = [...DEFAULT_HEADERS];
  if (looksLikeHeaderRow(grid[0] ?? [])) {
    headers = (grid[0] ?? []).map((c) => c.trim());
    headerIdx = 0;
  } else {
    // No header — treat row 0 as data; still use default column mapping.
    headerIdx = -1;
  }

  const map = mapHeaderIndex(headers);
  const start = headerIdx + 1;
  const out: ProjectLogRow[] = [];

  for (let r = start; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const projectNumber = cell(row, map.projectNumber);
    if (!projectNumber) continue;
    // Skip non-project rows (notes, blanks).
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
      rowNumber: r + 1,
    });
  }
  return out;
}
