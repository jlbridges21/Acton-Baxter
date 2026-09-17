/**
 * Money helpers — integer cents only, never float storage.
 */

import { ValidationError } from "@/lib/errors";

/**
 * Parse a typed amount (with or without $ / commas) into positive integer cents.
 * Rejects empty, NaN, zero, and negative values.
 */
export function parseAmountToCents(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) {
    throw new ValidationError("Amount is required");
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new ValidationError("Amount must be greater than zero");
    }
    // Avoid float drift: treat as dollars with at most 2 decimal places
    const cents = Math.round(raw * 100);
    if (cents <= 0) throw new ValidationError("Amount must be greater than zero");
    return cents;
  }

  const trimmed = String(raw).trim();
  if (!trimmed) throw new ValidationError("Amount is required");

  const cleaned = trimmed
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/usd/gi, "");

  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new ValidationError("Enter a valid amount (e.g. 42.50)");
  }

  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [dollarsPart, fractionPart = ""] = unsigned.split(".");
  const dollars = Number.parseInt(dollarsPart || "0", 10);
  const frac = (fractionPart + "00").slice(0, 2);
  const centsPart = Number.parseInt(frac, 10);
  const cents = dollars * 100 + centsPart;
  if (negative || cents <= 0) {
    throw new ValidationError("Amount must be greater than zero");
  }
  return cents;
}

/** Format cents for display (e.g. 4250 → "$42.50"). */
export function formatCentsAsUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars}.${String(rem).padStart(2, "0")}`;
}

/** Format cents for spreadsheet export (e.g. 4250 → "42.50"). */
export function formatCentsAsDecimalDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${dollars}.${String(rem).padStart(2, "0")}`;
}
