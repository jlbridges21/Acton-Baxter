/**
 * Pure URL / filter-state helpers for the Baxter feedback admin page.
 * Must stay free of React client/server directives so both the server page
 * (Load more link) and the client filters panel can import them.
 */

import type { FeedbackRangePreset, FeedbackSortDirection } from "./feedback-date-ranges";

export const FEEDBACK_RANGE_PRESET_LINKS: Array<{
  value: Exclude<FeedbackRangePreset, "custom">;
  label: string;
}> = [
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_year", label: "This year" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "all_time", label: "All time" },
];

export type FeedbackFiltersState = {
  range: FeedbackRangePreset;
  rating: "all" | "positive" | "negative" | "none";
  channel: "all" | "web" | "slack";
  sort: FeedbackSortDirection;
  /** Multi-select asker keys (empty = no filter). */
  askerKeys: string[];
  /** Multi-select departments (empty = no filter). */
  departments: string[];
  customStart: string;
  customEnd: string;
};

export function countActiveFeedbackFilters(state: FeedbackFiltersState): number {
  let n = 0;
  // Default range is this_month
  if (state.range !== "this_month") n += 1;
  if (state.rating !== "all") n += 1;
  if (state.channel !== "all") n += 1;
  if (state.sort !== "newest") n += 1;
  // Each multi-select value counts toward the badge
  n += (state.askerKeys ?? []).length;
  n += (state.departments ?? []).length;
  if (state.range === "custom" && (state.customStart || state.customEnd)) n += 1;
  return n;
}

/** Build a feedback admin URL preserving non-range filters (for preset quick-links). */
export function buildFeedbackFilterHref(input: {
  range: FeedbackRangePreset;
  rating?: string;
  channel?: string;
  sort?: string;
  askerKeys?: string[] | null;
  departments?: string[] | null;
  start?: string;
  end?: string;
  offset?: number;
}): string {
  const params = new URLSearchParams();
  params.set("range", input.range);
  if (input.rating && input.rating !== "all") params.set("rating", input.rating);
  if (input.channel && input.channel !== "all") params.set("channel", input.channel);
  if (input.sort && input.sort !== "newest") params.set("sort", input.sort);
  for (const key of input.askerKeys ?? []) {
    if (key) params.append("asker", key);
  }
  for (const dept of input.departments ?? []) {
    if (dept) params.append("department", dept);
  }
  if (input.range === "custom") {
    if (input.start) params.set("start", input.start);
    if (input.end) params.set("end", input.end);
  }
  if (input.offset && input.offset > 0) params.set("offset", String(input.offset));
  const qs = params.toString();
  return qs ? `/admin/baxter/feedback?${qs}` : "/admin/baxter/feedback";
}
