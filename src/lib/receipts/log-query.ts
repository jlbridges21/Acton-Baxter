/**
 * Filter / sort / summarize Receipt Log rows — pure helpers for admin list + CSV.
 */

import {
  inDateRange,
  isoToZonedDateInput,
  resolveFeedbackDateRange,
  type DateRangeBounds,
} from "@/lib/baxter-ai/feedback-date-ranges";
import { parseAmountToCents } from "./amount";
import type {
  ReceiptLogDateField,
  ReceiptLogEntryType,
  ReceiptLogFiltersState,
  ReceiptLogSortDir,
  ReceiptLogSortField,
} from "./log-filter-url";

export type ReceiptLogRow = {
  id: string;
  submittedBy: string;
  /** Primary display: full_name → email → truncated id. */
  submitterName: string;
  /** Auth email when known (disambiguates same-name accounts). */
  submitterEmail: string | null;
  /** Filter/CSV label — name with email when both exist. */
  submitterLabel: string;
  jobId: string | null;
  customJobLabel: string | null;
  /** Display label — expense job label or custom one-off text. */
  jobLabel: string;
  /** True when this receipt used a free-text custom_job_label. */
  isCustomJob: boolean;
  amountCents: number;
  vendor: string;
  purchasedOn: string;
  items: string | null;
  description: string | null;
  photoStoragePath: string | null;
  /** Short-lived signed URL for on-page thumbnails (null when no photo). */
  photoSignedUrl: string | null;
  /** Durable admin permalink for CSV / copy — never a signed URL. */
  photoPermalink: string;
  createdAt: string;
  updatedAt: string;
};

/** Facet / filter id for a one-off custom label. */
export function customJobFilterId(label: string): string {
  return `custom:${label.trim()}`;
}

export function parseCustomJobFilterId(id: string): string | null {
  if (!id.startsWith("custom:")) return null;
  const label = id.slice("custom:".length).trim();
  return label || null;
}

export type ReceiptLogQueryInput = {
  filters: ReceiptLogFiltersState;
  /** Pre-resolved range bounds (optional — resolved from filters when omitted). */
  range?: DateRangeBounds;
  limit?: number;
  offset?: number;
};

export type ReceiptLogQueryResult = {
  rows: ReceiptLogRow[];
  totalMatching: number;
  totalAmountCents: number;
  /** Facets for filter UI (derived from non-deleted corpus before multi-selects). */
  facets: {
    users: Array<{ id: string; label: string }>;
    jobs: Array<{ id: string; label: string }>;
    vendors: string[];
  };
};

function purchasedInRange(purchasedOn: string, range: DateRangeBounds): boolean {
  if (!range.start && !range.end) return true;
  const startYmd = range.start ? isoToZonedDateInput(range.start) : null;
  const endYmd = range.end ? isoToZonedDateInput(range.end) : null;
  if (startYmd && purchasedOn < startYmd) return false;
  if (endYmd && purchasedOn > endYmd) return false;
  return true;
}

function parseOptionalDollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return parseAmountToCents(trimmed);
  } catch {
    // Allow 0 as lower bound typed by admins
    if (trimmed === "0" || trimmed === "0.00" || trimmed === "$0" || trimmed === "$0.00") {
      return 0;
    }
    return null;
  }
}

export function rowMatchesReceiptLogFilters(
  row: ReceiptLogRow,
  filters: ReceiptLogFiltersState,
  range: DateRangeBounds,
): boolean {
  if (filters.dateField === "purchased") {
    if (!purchasedInRange(row.purchasedOn, range)) return false;
  } else if (!inDateRange(row.createdAt, range)) {
    return false;
  }

  if (filters.userIds.length > 0 && !filters.userIds.includes(row.submittedBy)) return false;
  if (filters.jobIds.length > 0) {
    const matchesJob = filters.jobIds.some((id) => {
      const custom = parseCustomJobFilterId(id);
      if (custom != null) {
        return (
          row.isCustomJob &&
          (row.customJobLabel ?? "").trim().toLowerCase() === custom.toLowerCase()
        );
      }
      return row.jobId === id;
    });
    if (!matchesJob) return false;
  }
  if (filters.vendors.length > 0) {
    const vendorKey = row.vendor.trim().toLowerCase();
    if (!filters.vendors.some((v) => v.trim().toLowerCase() === vendorKey)) return false;
  }

  const minCents = parseOptionalDollarsToCents(filters.amountMin);
  const maxCents = parseOptionalDollarsToCents(filters.amountMax);
  if (minCents != null && row.amountCents < minCents) return false;
  if (maxCents != null && row.amountCents > maxCents) return false;

  if (filters.entryType === "photo" && !row.photoStoragePath) return false;
  if (filters.entryType === "manual" && row.photoStoragePath) return false;

  const q = filters.q.trim().toLowerCase();
  if (q) {
    const hay = `${row.vendor}\n${row.items ?? ""}\n${row.description ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  return true;
}

function compareRows(
  a: ReceiptLogRow,
  b: ReceiptLogRow,
  sort: ReceiptLogSortField,
  dir: ReceiptLogSortDir,
): number {
  const sign = dir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sort) {
    case "logged":
      cmp = a.createdAt.localeCompare(b.createdAt);
      break;
    case "purchased":
      cmp = a.purchasedOn.localeCompare(b.purchasedOn);
      break;
    case "user":
      cmp = a.submitterName.localeCompare(b.submitterName, undefined, { sensitivity: "base" });
      break;
    case "job":
      cmp = a.jobLabel.localeCompare(b.jobLabel, undefined, { sensitivity: "base" });
      break;
    case "vendor":
      cmp = a.vendor.localeCompare(b.vendor, undefined, { sensitivity: "base" });
      break;
    case "amount":
      cmp = a.amountCents - b.amountCents;
      break;
    default:
      cmp = a.createdAt.localeCompare(b.createdAt);
  }
  if (cmp !== 0) return cmp * sign;
  // Stable tie-breaker
  return a.id.localeCompare(b.id) * sign;
}

export function queryReceiptLogRows(
  allRows: ReceiptLogRow[],
  input: ReceiptLogQueryInput,
): ReceiptLogQueryResult {
  const range =
    input.range ??
    resolveFeedbackDateRange({
      preset: input.filters.range,
      customStart: input.filters.customStart,
      customEnd: input.filters.customEnd,
    });

  // Facets from the full visible corpus (ignore multi-select / search / amount so options stay usable)
  const facetBase = allRows.filter((row) => {
    const soft: ReceiptLogFiltersState = {
      ...input.filters,
      userIds: [],
      jobIds: [],
      vendors: [],
      amountMin: "",
      amountMax: "",
      entryType: "all",
      q: "",
    };
    return rowMatchesReceiptLogFilters(row, soft, range);
  });

  const userMap = new Map<string, string>();
  const jobMap = new Map<string, string>();
  const vendorSet = new Set<string>();
  for (const row of facetBase) {
    userMap.set(row.submittedBy, row.submitterLabel || row.submitterName);
    if (row.isCustomJob && row.customJobLabel) {
      jobMap.set(customJobFilterId(row.customJobLabel), `${row.customJobLabel} (custom)`);
    } else if (row.jobId) {
      jobMap.set(row.jobId, row.jobLabel);
    }
    if (row.vendor.trim()) vendorSet.add(row.vendor.trim());
  }

  const matched = allRows
    .filter((row) => rowMatchesReceiptLogFilters(row, input.filters, range))
    .sort((a, b) => compareRows(a, b, input.filters.sort, input.filters.dir));

  const totalAmountCents = matched.reduce((sum, row) => sum + row.amountCents, 0);
  const offset = Math.max(0, input.offset ?? 0);
  const limit = input.limit ?? matched.length;
  const rows = matched.slice(offset, offset + limit);

  return {
    rows,
    totalMatching: matched.length,
    totalAmountCents,
    facets: {
      users: Array.from(userMap.entries())
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      jobs: Array.from(jobMap.entries())
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      vendors: Array.from(vendorSet).sort((a, b) => a.localeCompare(b)),
    },
  };
}

export function resolveReceiptLogRange(filters: ReceiptLogFiltersState): DateRangeBounds {
  return resolveFeedbackDateRange({
    preset: filters.range,
    customStart: filters.customStart,
    customEnd: filters.customEnd,
  });
}

/** Re-export types used by callers that only import query helpers. */
export type { ReceiptLogDateField, ReceiptLogEntryType };
