/**
 * Project number parse / increment / validate / year rollover.
 * Format: L01-26017 → prefix L01, year 26, seq 017
 */

import { PROJECT_NUMBER_RE } from "./types";

export type ParsedProjectNumber = {
  raw: string;
  prefix: string;
  /** Full 5-digit suffix as integer (legacy). */
  numeric: number;
  year: number;
  seq: number;
};

export function parseProjectNumber(value: string): ParsedProjectNumber | null {
  const trimmed = value.trim().toUpperCase();
  const match = trimmed.match(PROJECT_NUMBER_RE);
  if (!match) return null;
  const prefix = match[1]!;
  const suffix = match[2]!;
  const numeric = Number(suffix);
  if (!Number.isFinite(numeric)) return null;
  const year = Number(suffix.slice(0, 2));
  const seq = Number(suffix.slice(2));
  if (!Number.isFinite(year) || !Number.isFinite(seq)) return null;
  return { raw: trimmed, prefix, numeric, year, seq };
}

export function formatProjectNumberParts(prefix: string, year: number, seq: number): string {
  if (year < 0 || year > 99) {
    throw new Error(`Project number year out of range: ${year}`);
  }
  if (seq < 0 || seq > 999) {
    throw new Error(`Project number sequence out of range: ${seq}`);
  }
  return `${prefix.toUpperCase()}-${String(year).padStart(2, "0")}${String(seq).padStart(3, "0")}`;
}

/** @deprecated Prefer formatProjectNumberParts — kept for simple +1 within same year. */
export function formatProjectNumber(prefix: string, numeric: number): string {
  if (numeric < 0 || numeric > 99999) {
    throw new Error(`Project number numeric part out of range: ${numeric}`);
  }
  return `${prefix.toUpperCase()}-${String(numeric).padStart(5, "0")}`;
}

export function incrementProjectNumber(value: string): string {
  const parsed = parseProjectNumber(value);
  if (!parsed) {
    throw new Error(
      `Could not parse project number "${value}". Expected format like L01-26017 (letter + 2 digits, hyphen, 5 digits).`,
    );
  }
  return formatProjectNumberParts(parsed.prefix, parsed.year, parsed.seq + 1);
}

/** Two-digit year from an ISO date (YYYY-MM-DD) or Date. */
export function twoDigitYearFromDate(date: string | Date | null | undefined): number {
  if (!date) return new Date().getFullYear() % 100;
  if (typeof date === "string") {
    const match = date.trim().match(/^(\d{4})/);
    if (match) return Number(match[1]) % 100;
  }
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return new Date().getFullYear() % 100;
  return d.getFullYear() % 100;
}

/** Last non-empty cell in column A values (Sheets API rows). */
export function lastNonEmptyColumnAValue(values: string[][] | null | undefined): {
  value: string;
  rowIndex: number; // 1-based spreadsheet row
} | null {
  if (!values?.length) return null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const cell = String(values[i]?.[0] ?? "").trim();
    if (cell) {
      return { value: cell, rowIndex: i + 1 };
    }
  }
  return null;
}

/**
 * Next project number from Master Project Log column A.
 * If the run's FP-paid year matches the last number's YY, increment seq.
 * If the run's year is newer, start `<prefix>-<newYY>001`.
 */
export function computeNextProjectNumberFromColumnA(
  values: string[][],
  options?: { referenceYear?: number },
): {
  nextNumber: string;
  sourceValue: string;
  sourceRowIndex: number;
  rolledOver: boolean;
} {
  const last = lastNonEmptyColumnAValue(values);
  if (!last) {
    throw new Error(
      "The Master Project Log column A is empty — cannot compute the next project number.",
    );
  }
  const parsed = parseProjectNumber(last.value);
  if (!parsed) {
    throw new Error(
      `The last project number in the Master Project Log (row ${last.rowIndex}: "${last.value}") is not in the expected format (e.g. L01-26017). Fix the log or enter a project number manually.`,
    );
  }

  const referenceYear = options?.referenceYear ?? new Date().getFullYear() % 100;
  if (referenceYear > parsed.year) {
    return {
      nextNumber: formatProjectNumberParts(parsed.prefix, referenceYear, 1),
      sourceValue: parsed.raw,
      sourceRowIndex: last.rowIndex,
      rolledOver: true,
    };
  }

  return {
    nextNumber: formatProjectNumberParts(parsed.prefix, parsed.year, parsed.seq + 1),
    sourceValue: parsed.raw,
    sourceRowIndex: last.rowIndex,
    rolledOver: false,
  };
}

/** Format FP paid date for Sheets USER_ENTERED — prefer M/D/YYYY to match typical logs. */
export function formatFpPaidDateForSheet(isoDate: string | null | undefined): string {
  if (!isoDate?.trim()) return "";
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate.trim();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return `${month}/${day}/${year}`;
}

export function columnAContainsProjectNumber(values: string[][], projectNumber: string): boolean {
  const target = projectNumber.trim().toUpperCase();
  for (const row of values) {
    const cell = String(row?.[0] ?? "")
      .trim()
      .toUpperCase();
    if (cell === target) return true;
  }
  return false;
}
