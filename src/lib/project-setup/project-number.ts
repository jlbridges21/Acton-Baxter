/**
 * Project number parse / increment / validate.
 * Format: L01-26017 → prefix L01, numeric 26017 → next L01-26018
 */

import { PROJECT_NUMBER_RE } from "./types";

export type ParsedProjectNumber = {
  raw: string;
  prefix: string;
  numeric: number;
};

export function parseProjectNumber(value: string): ParsedProjectNumber | null {
  const trimmed = value.trim().toUpperCase();
  const match = trimmed.match(PROJECT_NUMBER_RE);
  if (!match) return null;
  const prefix = match[1]!;
  const numeric = Number(match[2]);
  if (!Number.isFinite(numeric)) return null;
  return { raw: trimmed, prefix, numeric };
}

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
  return formatProjectNumber(parsed.prefix, parsed.numeric + 1);
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

export function computeNextProjectNumberFromColumnA(values: string[][]): {
  nextNumber: string;
  sourceValue: string;
  sourceRowIndex: number;
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
  return {
    nextNumber: formatProjectNumber(parsed.prefix, parsed.numeric + 1),
    sourceValue: parsed.raw,
    sourceRowIndex: last.rowIndex,
  };
}
