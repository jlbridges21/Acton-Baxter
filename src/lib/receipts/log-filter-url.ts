/**
 * Pure URL / filter-state helpers for Receipt Log lists (`/receipts/log`, `/receipts/mine`).
 */

import type { FeedbackRangePreset } from "@/lib/baxter-ai/feedback-date-ranges";
import { parseFeedbackRangePreset } from "@/lib/baxter-ai/feedback-date-ranges";
import { FEEDBACK_RANGE_PRESET_LINKS } from "@/lib/baxter-ai/feedback-filter-url";

export { FEEDBACK_RANGE_PRESET_LINKS, parseFeedbackRangePreset };
export type { FeedbackRangePreset };

export const RECEIPT_LOG_PATH = "/receipts/log";
export const RECEIPT_LOG_EXPORT_PATH = "/receipts/log/export";
export const MY_RECEIPTS_PATH = "/receipts/mine";
export const MY_RECEIPTS_EXPORT_PATH = "/receipts/mine/export";

export type ReceiptLogDateField = "logged" | "purchased";
export type ReceiptLogEntryType = "all" | "photo" | "manual";
export type ReceiptLogSortField = "logged" | "purchased" | "user" | "job" | "vendor" | "amount";
export type ReceiptLogSortDir = "asc" | "desc";

export type ReceiptLogFiltersState = {
  range: FeedbackRangePreset;
  dateField: ReceiptLogDateField;
  customStart: string;
  customEnd: string;
  userIds: string[];
  jobIds: string[];
  vendors: string[];
  amountMin: string;
  amountMax: string;
  entryType: ReceiptLogEntryType;
  q: string;
  sort: ReceiptLogSortField;
  dir: ReceiptLogSortDir;
};

export const DEFAULT_RECEIPT_LOG_FILTERS: ReceiptLogFiltersState = {
  range: "this_month",
  dateField: "logged",
  customStart: "",
  customEnd: "",
  userIds: [],
  jobIds: [],
  vendors: [],
  amountMin: "",
  amountMax: "",
  entryType: "all",
  q: "",
  sort: "logged",
  dir: "desc",
};

export function countActiveReceiptLogFilters(
  state: ReceiptLogFiltersState,
  options?: { ignoreUserFilter?: boolean },
): number {
  let n = 0;
  if (state.range !== "this_month") n += 1;
  if (state.dateField !== "logged") n += 1;
  if (!options?.ignoreUserFilter) n += state.userIds.length;
  n += state.jobIds.length;
  n += state.vendors.length;
  if (state.amountMin.trim()) n += 1;
  if (state.amountMax.trim()) n += 1;
  if (state.entryType !== "all") n += 1;
  if (state.q.trim()) n += 1;
  if (state.range === "custom" && (state.customStart || state.customEnd)) n += 1;
  return n;
}

export function buildReceiptLogHref(
  input: Partial<ReceiptLogFiltersState> & { offset?: number },
  basePath: string = RECEIPT_LOG_PATH,
): string {
  const state: ReceiptLogFiltersState = {
    ...DEFAULT_RECEIPT_LOG_FILTERS,
    ...input,
    userIds: input.userIds ?? DEFAULT_RECEIPT_LOG_FILTERS.userIds,
    jobIds: input.jobIds ?? DEFAULT_RECEIPT_LOG_FILTERS.jobIds,
    vendors: input.vendors ?? DEFAULT_RECEIPT_LOG_FILTERS.vendors,
  };
  const params = new URLSearchParams();
  params.set("range", state.range);
  if (state.dateField !== "logged") params.set("dateField", state.dateField);
  if (state.range === "custom") {
    if (state.customStart) params.set("start", state.customStart);
    if (state.customEnd) params.set("end", state.customEnd);
  }
  for (const id of state.userIds) {
    if (id) params.append("user", id);
  }
  for (const id of state.jobIds) {
    if (id) params.append("job", id);
  }
  for (const vendor of state.vendors) {
    if (vendor) params.append("vendor", vendor);
  }
  if (state.amountMin.trim()) params.set("amountMin", state.amountMin.trim());
  if (state.amountMax.trim()) params.set("amountMax", state.amountMax.trim());
  if (state.entryType !== "all") params.set("entryType", state.entryType);
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.sort !== "logged") params.set("sort", state.sort);
  if (state.dir !== "desc") params.set("dir", state.dir);
  if (input.offset && input.offset > 0) params.set("offset", String(input.offset));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function parseReceiptLogDateField(raw: string | null | undefined): ReceiptLogDateField {
  return raw === "purchased" ? "purchased" : "logged";
}

export function parseReceiptLogEntryType(raw: string | null | undefined): ReceiptLogEntryType {
  if (raw === "photo" || raw === "manual") return raw;
  return "all";
}

export function parseReceiptLogSortField(raw: string | null | undefined): ReceiptLogSortField {
  const allowed: ReceiptLogSortField[] = ["logged", "purchased", "user", "job", "vendor", "amount"];
  return allowed.find((s) => s === raw) ?? "logged";
}

export function parseReceiptLogSortDir(raw: string | null | undefined): ReceiptLogSortDir {
  return raw === "asc" ? "asc" : "desc";
}

/** Parse Next.js / URLSearchParams-style receipt log filters (shared by page + export). */
export function parseReceiptLogFiltersFromParams(
  get: (key: string) => string | null | undefined,
  getAll?: (key: string) => string[],
): ReceiptLogFiltersState {
  const list = (key: string): string[] => {
    const values = getAll
      ? getAll(key)
      : (() => {
          const single = get(key);
          return single ? [single] : [];
        })();
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      for (const part of value.split(",")) {
        const trimmed = part.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
    return out;
  };

  return {
    range: parseFeedbackRangePreset(get("range")),
    dateField: parseReceiptLogDateField(get("dateField")),
    customStart: get("start") ?? "",
    customEnd: get("end") ?? "",
    userIds: list("user"),
    jobIds: list("job"),
    vendors: list("vendor"),
    amountMin: get("amountMin") ?? "",
    amountMax: get("amountMax") ?? "",
    entryType: parseReceiptLogEntryType(get("entryType")),
    q: get("q") ?? "",
    sort: parseReceiptLogSortField(get("sort")),
    dir: parseReceiptLogSortDir(get("dir")),
  };
}
