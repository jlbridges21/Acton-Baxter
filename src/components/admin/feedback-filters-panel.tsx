"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import type { FeedbackAskerOption } from "@/lib/baxter-ai/feedback-inquiries";
import type { FeedbackRangePreset, FeedbackSortDirection } from "@/lib/baxter-ai/feedback";

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
  n += state.askerKeys.length;
  n += state.departments.length;
  if (state.range === "custom" && (state.customStart || state.customEnd)) n += 1;
  return n;
}

/** Build a feedback admin URL preserving non-range filters (for preset quick-links). */
export function buildFeedbackFilterHref(input: {
  range: FeedbackRangePreset;
  rating?: string;
  channel?: string;
  sort?: string;
  askerKeys?: string[];
  departments?: string[];
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

export function FeedbackFiltersPanel({
  initial,
  askerOptions,
  departmentOptions,
}: {
  initial: FeedbackFiltersState;
  askerOptions: FeedbackAskerOption[];
  departmentOptions: string[];
}) {
  const activeCount = useMemo(() => countActiveFeedbackFilters(initial), [initial]);
  const [open, setOpen] = useState(activeCount > 0);
  const [showCustomDates, setShowCustomDates] = useState(initial.range === "custom");
  const [askerQuery, setAskerQuery] = useState("");
  const [selectedAskers, setSelectedAskers] = useState<string[]>(() => [...initial.askerKeys]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>(() => [
    ...initial.departments,
  ]);

  const filteredAskers = askerOptions.filter((a) =>
    a.label.toLowerCase().includes(askerQuery.trim().toLowerCase()),
  );

  function toggleAsker(key: string) {
    setSelectedAskers((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function toggleDepartment(dept: string) {
    setSelectedDepartments((prev) =>
      prev.includes(dept) ? prev.filter((d) => d !== dept) : [...prev, dept],
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Filters</CardTitle>
          <div className="flex items-center gap-2">
            {activeCount > 0 ? (
              <span className="rounded-full bg-[var(--acton-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--acton-navy)]">
                {activeCount} active
              </span>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Hide filters" : "Filters"}
            </Button>
          </div>
        </div>

        {open ? (
          <form method="get" action="/admin/baxter/feedback" className="mt-4 space-y-4">
            {/* Preserve current range when applying other filters via the form. */}
            <input type="hidden" name="range" value={initial.range} />

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-[var(--acton-navy)]">Rating</span>
                <select
                  name="rating"
                  defaultValue={initial.rating}
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                >
                  <option value="all">All</option>
                  <option value="positive">Positive</option>
                  <option value="negative">Negative</option>
                  <option value="none">No feedback</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-[var(--acton-navy)]">Channel</span>
                <select
                  name="channel"
                  defaultValue={initial.channel}
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                >
                  <option value="all">All</option>
                  <option value="web">Web</option>
                  <option value="slack">Slack</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-[var(--acton-navy)]">Sort</span>
                <select
                  name="sort"
                  defaultValue={initial.sort}
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <fieldset className="block text-sm">
                <legend className="mb-1 block font-medium text-[var(--acton-navy)]">
                  Asked by
                </legend>
                <input
                  type="search"
                  value={askerQuery}
                  onChange={(e) => setAskerQuery(e.target.value)}
                  placeholder="Type to narrow askers…"
                  className="mb-2 h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                />
                {/* Keep selected askers in the form even when filtered out of the list. */}
                {selectedAskers
                  .filter((key) => !filteredAskers.some((a) => a.key === key))
                  .map((key) => (
                    <input key={`hidden-asker-${key}`} type="hidden" name="asker" value={key} />
                  ))}
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--acton-border)] bg-white p-2">
                  {filteredAskers.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-[var(--acton-muted)]">
                      No matching askers
                    </p>
                  ) : (
                    filteredAskers.map((a) => (
                      <label
                        key={a.key}
                        className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-[var(--acton-soft)]"
                      >
                        <input
                          type="checkbox"
                          name="asker"
                          value={a.key}
                          checked={selectedAskers.includes(a.key)}
                          onChange={() => toggleAsker(a.key)}
                          className="mt-0.5"
                        />
                        <span className="text-sm text-[var(--acton-navy)]">
                          {a.label}{" "}
                          <span className="text-xs text-[var(--acton-muted)]">({a.channel})</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  {selectedAskers.length === 0
                    ? "No askers selected — showing all."
                    : `${selectedAskers.length} selected`}
                </p>
              </fieldset>

              <fieldset className="block text-sm">
                <legend className="mb-1 block font-medium text-[var(--acton-navy)]">
                  Department
                </legend>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--acton-border)] bg-white p-2">
                  {departmentOptions.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-[var(--acton-muted)]">No departments</p>
                  ) : (
                    departmentOptions.map((d) => (
                      <label
                        key={d}
                        className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-[var(--acton-soft)]"
                      >
                        <input
                          type="checkbox"
                          name="department"
                          value={d}
                          checked={selectedDepartments.includes(d)}
                          onChange={() => toggleDepartment(d)}
                          className="mt-0.5"
                        />
                        <span className="text-sm text-[var(--acton-navy)]">{d}</span>
                      </label>
                    ))
                  )}
                </div>
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  {selectedDepartments.length === 0
                    ? "No departments selected — showing all."
                    : `${selectedDepartments.length} selected`}
                </p>
              </fieldset>
            </div>

            {showCustomDates || initial.range === "custom" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-[var(--acton-navy)]">
                    Custom start (Pacific)
                  </span>
                  <input
                    type="date"
                    name="start"
                    defaultValue={initial.customStart}
                    className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-[var(--acton-navy)]">
                    Custom end (Pacific, inclusive)
                  </span>
                  <input
                    type="date"
                    name="end"
                    defaultValue={initial.customEnd}
                    className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                  />
                </label>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit">Apply filters</Button>
              <a
                href="/admin/baxter/feedback"
                className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] px-4 text-sm font-semibold text-[var(--acton-navy)]"
              >
                Reset
              </a>
            </div>
          </form>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium text-[var(--acton-muted)]">Date range:</span>
        {FEEDBACK_RANGE_PRESET_LINKS.map((opt) => {
          const active = initial.range === opt.value;
          return (
            <Link
              key={opt.value}
              href={buildFeedbackFilterHref({
                range: opt.value,
                rating: initial.rating,
                channel: initial.channel,
                sort: initial.sort,
                askerKeys: initial.askerKeys,
                departments: initial.departments,
              })}
              className={
                active
                  ? "font-semibold text-[var(--acton-navy)] underline decoration-2 underline-offset-4"
                  : "text-[var(--acton-navy)] underline underline-offset-2 hover:decoration-2"
              }
              aria-current={active ? "page" : undefined}
            >
              {opt.label}
            </Link>
          );
        })}
        <Link
          href={buildFeedbackFilterHref({
            range: "custom",
            rating: initial.rating,
            channel: initial.channel,
            sort: initial.sort,
            askerKeys: initial.askerKeys,
            departments: initial.departments,
            start: initial.customStart,
            end: initial.customEnd,
          })}
          onClick={() => {
            setOpen(true);
            setShowCustomDates(true);
          }}
          className={
            initial.range === "custom"
              ? "font-semibold text-[var(--acton-navy)] underline decoration-2 underline-offset-4"
              : "text-[var(--acton-navy)] underline underline-offset-2 hover:decoration-2"
          }
          aria-current={initial.range === "custom" ? "page" : undefined}
        >
          Custom range
        </Link>
      </div>
    </div>
  );
}
