"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import type { FeedbackAskerOption } from "@/lib/baxter-ai/feedback-inquiries";
import type { FeedbackRangePreset, FeedbackSortDirection } from "@/lib/baxter-ai/feedback";

const RANGE_OPTIONS: Array<{ value: FeedbackRangePreset; label: string }> = [
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_year", label: "This year" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "all_time", label: "All time" },
  { value: "custom", label: "Custom" },
];

export type FeedbackFiltersState = {
  range: FeedbackRangePreset;
  rating: "all" | "positive" | "negative" | "none";
  channel: "all" | "web" | "slack";
  sort: FeedbackSortDirection;
  askerKey: string;
  department: string;
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
  if (state.askerKey) n += 1;
  if (state.department) n += 1;
  if (state.range === "custom" && (state.customStart || state.customEnd)) n += 1;
  return n;
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
  const [askerQuery, setAskerQuery] = useState(() => {
    const match = askerOptions.find((a) => a.key === initial.askerKey);
    return match?.label ?? "";
  });

  const filteredAskers = askerOptions.filter((a) =>
    a.label.toLowerCase().includes(askerQuery.trim().toLowerCase()),
  );

  return (
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--acton-navy)]">Date range</span>
              <select
                name="range"
                defaultValue={initial.range}
                className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
              >
                {RANGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
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
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--acton-navy)]">Asked by</span>
              <input
                type="search"
                value={askerQuery}
                onChange={(e) => setAskerQuery(e.target.value)}
                placeholder="Type to narrow askers…"
                className="mb-2 h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
              />
              <select
                name="asker"
                defaultValue={initial.askerKey}
                className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
              >
                <option value="">All askers</option>
                {filteredAskers.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label} ({a.channel})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--acton-navy)]">Department</span>
              <input
                list="feedback-dept-options"
                name="department"
                defaultValue={initial.department}
                placeholder="All departments"
                className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
              />
              <datalist id="feedback-dept-options">
                {departmentOptions.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </label>
          </div>

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
  );
}
