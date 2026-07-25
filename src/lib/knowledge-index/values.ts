import type { ParsedCellValue } from "./types";

export function parseCellValue(raw: unknown): ParsedCellValue {
  const display = String(raw ?? "").trim();
  if (!display) {
    return { display: "", numeric: null, percent: null, dateIso: null, kind: "empty" };
  }

  // Percent
  const percentMatch = display.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (percentMatch) {
    const pct = Number(percentMatch[1]);
    return {
      display,
      numeric: pct,
      percent: pct,
      dateIso: null,
      kind: "percent",
    };
  }

  // Currency / number with $ and commas
  const currencyLike = /^\$?\s*-?[\d,]+(?:\.\d+)?$/.test(display.replace(/\s/g, ""));
  if (currencyLike || /^-?\d[\d,]*\.?\d*$/.test(display)) {
    const numeric = Number(display.replace(/[$,\s]/g, ""));
    if (Number.isFinite(numeric)) {
      return {
        display,
        numeric,
        percent: null,
        dateIso: null,
        kind: display.includes("$") ? "currency" : "number",
      };
    }
  }

  // Date (avoid timezone shift — treat as calendar date)
  const dateIso = parseDisplayDate(display);
  if (dateIso) {
    return { display, numeric: null, percent: null, dateIso, kind: "date" };
  }

  return { display, numeric: null, percent: null, dateIso: null, kind: "text" };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export function parseDisplayDate(display: string): string | null {
  const trimmed = display.trim();
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Mar 27, 2025 / March 27, 2025
  const m1 = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m1) {
    const month = MONTHS[m1[1]!.toLowerCase()];
    const day = Number(m1[2]);
    const year = Number(m1[3]);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // 3/27/2025 or 03-27-2025
  const m2 = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m2) {
    const month = Number(m2[1]);
    const day = Number(m2[2]);
    const year = Number(m2[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

export function formatFriendlyDate(display: string, dateIso: string | null): string {
  if (!dateIso) return display;
  const [y, m, d] = dateIso.split("-").map(Number);
  if (!y || !m || !d) return display;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

export function normalizeHeaderKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[%$]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeEntityText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
