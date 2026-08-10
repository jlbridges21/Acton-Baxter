"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import type { FeedbackAskerOption } from "@/lib/baxter-ai/feedback-inquiries";
import {
  buildFeedbackFilterHref,
  countActiveFeedbackFilters,
  FEEDBACK_RANGE_PRESET_LINKS,
  type FeedbackFiltersState,
} from "@/lib/baxter-ai/feedback-filter-url";

export {
  buildFeedbackFilterHref,
  countActiveFeedbackFilters,
  FEEDBACK_RANGE_PRESET_LINKS,
  type FeedbackFiltersState,
} from "@/lib/baxter-ai/feedback-filter-url";

export function FeedbackFiltersPanel({
  initial,
  askerOptions,
  departmentOptions,
}: {
  initial: FeedbackFiltersState;
  askerOptions: FeedbackAskerOption[];
  departmentOptions: string[];
}) {
  const askerKeys = initial.askerKeys ?? [];
  const departments = initial.departments ?? [];
  const activeCount = useMemo(
    () => countActiveFeedbackFilters({ ...initial, askerKeys, departments }),
    [initial, askerKeys, departments],
  );
  const [open, setOpen] = useState(activeCount > 0);
  const [showCustomDates, setShowCustomDates] = useState(initial.range === "custom");
  const [askerQuery, setAskerQuery] = useState("");
  const [selectedAskers, setSelectedAskers] = useState<string[]>(() => [...askerKeys]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>(() => [...departments]);

  const filteredAskers = (askerOptions ?? []).filter((a) =>
    (a.label ?? "").toLowerCase().includes(askerQuery.trim().toLowerCase()),
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
                  {(departmentOptions ?? []).length === 0 ? (
                    <p className="px-1 py-1 text-xs text-[var(--acton-muted)]">No departments</p>
                  ) : (
                    (departmentOptions ?? []).map((d) => (
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
