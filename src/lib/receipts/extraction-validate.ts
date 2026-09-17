/**
 * Post-extraction validation for receipt OCR — date plausibility + arithmetic checks.
 * Lowers confidence and adds warnings; never invents replacement values.
 */

import {
  RECEIPT_DATE_MAX_PAST_DAYS,
  RECEIPT_LOW_CONFIDENCE,
  type ReceiptExtraction,
} from "./extraction-schema";

export type ValidateReceiptExtractionOptions = {
  now?: Date;
  /** Max days a purchase date may precede today before it is flagged. */
  maxPastDays?: number;
};

function parseIsoDateUtc(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Expand a 2-digit year relative to `now`.
 * Prefers the century that yields a date near today (not a past-century default).
 */
export function expandTwoDigitYear(twoDigit: number, now: Date = new Date()): number {
  if (!Number.isInteger(twoDigit) || twoDigit < 0 || twoDigit > 99) {
    throw new Error("twoDigit year must be 0–99");
  }
  const currentYear = now.getFullYear();
  const century = Math.floor(currentYear / 100) * 100;
  let candidate = century + twoDigit;
  // If more than 1 year in the future, pull back a century (e.g. yy=99 in 2026 → 1999).
  if (candidate > currentYear + 1) candidate -= 100;
  // If more than ~80 years in the past, push forward a century (e.g. yy=05 in 2026 → 2005 stays;
  // yy=90 in 2026 → 1990; if somehow century+yy is too old relative to sliding window, leave it —
  // receipt dates rarely need +100 here after the future clamp).
  if (candidate < currentYear - 80) candidate += 100;
  return candidate;
}

/**
 * Parse common printed date forms into YYYY-MM-DD, expanding 2-digit years vs `now`.
 * Returns null when unparseable — does not invent.
 */
export function normalizePrintedReceiptDate(raw: string, now: Date = new Date()): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return trimmed;

  const us = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(trimmed);
  if (!us) return null;
  const month = Number(us[1]);
  const day = Number(us[2]);
  let year = Number(us[3]);
  if (us[3]!.length === 2) year = expandTwoDigitYear(year, now);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return parseIsoDateUtc(candidate) ? candidate : null;
}

export function scoreReceiptExtraction(extraction: ReceiptExtraction): number {
  let score =
    extraction.confidence.amount +
    extraction.confidence.vendor +
    extraction.confidence.purchasedOn +
    extraction.confidence.items * 0.25;
  if (extraction.amountCents != null) score += 0.6;
  if (extraction.vendor) score += 0.35;
  if (extraction.purchasedOn) score += 0.35;
  for (const w of extraction.warnings) {
    if (/suspicious|mismatch|implausible|arithmetic|disagree/i.test(w)) score -= 0.45;
  }
  return score;
}

/**
 * Flag implausible dates and arithmetic mismatches by lowering confidence + warnings.
 * Does not replace extracted values with invented corrections.
 */
export function validateReceiptExtraction(
  extraction: ReceiptExtraction,
  options?: ValidateReceiptExtractionOptions,
): ReceiptExtraction {
  const now = options?.now ?? new Date();
  const maxPastDays = options?.maxPastDays ?? RECEIPT_DATE_MAX_PAST_DAYS;
  const warnings = [...extraction.warnings];
  const confidence = { ...extraction.confidence };
  let purchasedOn = extraction.purchasedOn;

  // Re-normalize if model returned a non-ISO that slipped through (defensive).
  if (purchasedOn && !/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn)) {
    purchasedOn = normalizePrintedReceiptDate(purchasedOn, now);
  }

  if (purchasedOn) {
    const parsed = parseIsoDateUtc(purchasedOn);
    if (!parsed) {
      warnings.push("Purchase date could not be validated — confirm with the photo.");
      confidence.purchasedOn = Math.min(confidence.purchasedOn, 0.3);
      purchasedOn = null;
    } else {
      const today = startOfUtcDay(now);
      const purchase = startOfUtcDay(parsed);
      const dayMs = 86_400_000;
      const daysAhead = Math.round((purchase.getTime() - today.getTime()) / dayMs);
      const daysBehind = Math.round((today.getTime() - purchase.getTime()) / dayMs);

      if (daysAhead > 0) {
        warnings.push(
          `Purchase date ${purchasedOn} is in the future relative to today — confirm the printed year.`,
        );
        confidence.purchasedOn = Math.min(confidence.purchasedOn, 0.35);
      } else if (daysBehind > maxPastDays) {
        warnings.push(
          `Purchase date ${purchasedOn} is more than ${Math.round(maxPastDays / 365)} years before today — confirm the printed year (do not silently accept).`,
        );
        confidence.purchasedOn = Math.min(confidence.purchasedOn, 0.35);
      }
    }
  }

  const lineItems = extraction.lineItemAmountsCents ?? [];
  if (extraction.amountCents != null && lineItems.length >= 2) {
    const sum = lineItems.reduce((a, b) => a + b, 0);
    if (sum > 0 && sum !== extraction.amountCents) {
      warnings.push(
        `Line items sum to ${(sum / 100).toFixed(2)} but extracted total is ${(extraction.amountCents / 100).toFixed(2)} — re-check digits.`,
      );
      confidence.amount = Math.min(confidence.amount, 0.4);
    }
  }

  const crossChecks = extraction.crossCheckAmountsCents ?? [];
  if (extraction.amountCents != null && crossChecks.length > 0) {
    const disagree = crossChecks.filter((c) => c !== extraction.amountCents);
    if (disagree.length > 0) {
      warnings.push(
        "Printed totals disagree across labels (e.g. balance vs amount due) — confirm the payable total.",
      );
      confidence.amount = Math.min(confidence.amount, 0.4);
    }
  }

  // Ensure flagged fields surface in the UI attention band.
  if (confidence.purchasedOn <= RECEIPT_LOW_CONFIDENCE && purchasedOn) {
    // already low
  }

  return {
    ...extraction,
    purchasedOn,
    confidence,
    warnings: Array.from(new Set(warnings)),
  };
}

/** True when validation/confidence suggests another orientation pass is worthwhile. */
export function shouldRetryReceiptExtractionOrientation(extraction: ReceiptExtraction): boolean {
  if (!extraction.amountCents && !extraction.vendor && !extraction.purchasedOn) return true;
  if (extraction.confidence.amount > 0 && extraction.confidence.amount <= RECEIPT_LOW_CONFIDENCE) {
    return true;
  }
  if (extraction.purchasedOn && extraction.confidence.purchasedOn <= RECEIPT_LOW_CONFIDENCE) {
    return true;
  }
  if (
    extraction.warnings.some((w) =>
      /mismatch|disagree|future|years before|arithmetic|re-check/i.test(w),
    )
  ) {
    return true;
  }
  const avg =
    (extraction.confidence.amount +
      extraction.confidence.vendor +
      extraction.confidence.purchasedOn) /
    3;
  return avg < 0.6;
}
