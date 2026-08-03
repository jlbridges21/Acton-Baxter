import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import {
  getFeedbackDashboard,
  parseFeedbackRangePreset,
  resolveFeedbackDateRange,
  type BaxterFeedbackRating,
  type FeedbackRangePreset,
  type FeedbackSortDirection,
} from "@/lib/baxter-ai/feedback";

const PAGE_SIZE = 50;

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

function paramString(raw: string | string[] | undefined): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}

function parseRating(raw: string | undefined): "all" | BaxterFeedbackRating {
  if (raw === "up" || raw === "down") return raw;
  return "all";
}

function parseSort(raw: string | undefined): FeedbackSortDirection {
  return raw === "oldest" ? "oldest" : "newest";
}

function buildFeedbackHref(input: {
  range: FeedbackRangePreset;
  rating: "all" | BaxterFeedbackRating;
  sort: FeedbackSortDirection;
  start?: string;
  end?: string;
  offset?: number;
}): string {
  const params = new URLSearchParams();
  params.set("range", input.range);
  if (input.rating !== "all") params.set("rating", input.rating);
  if (input.sort !== "newest") params.set("sort", input.sort);
  if (input.range === "custom") {
    if (input.start) params.set("start", input.start);
    if (input.end) params.set("end", input.end);
  }
  if (input.offset && input.offset > 0) params.set("offset", String(input.offset));
  const qs = params.toString();
  return qs ? `/admin/baxter/feedback?${qs}` : "/admin/baxter/feedback";
}

function formatPct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}

export default async function BaxterFeedbackAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const params = await searchParams;
  const rangePreset = parseFeedbackRangePreset(paramString(params.range));
  const rating = parseRating(paramString(params.rating));
  const sort = parseSort(paramString(params.sort));
  const customStart = paramString(params.start) ?? "";
  const customEnd = paramString(params.end) ?? "";
  const offsetRaw = Number(paramString(params.offset) ?? "0");
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  const rangeBounds = resolveFeedbackDateRange({
    preset: rangePreset,
    customStart: rangePreset === "custom" ? customStart : null,
    customEnd: rangePreset === "custom" ? customEnd : null,
  });

  const dashboard = await getFeedbackDashboard({
    rating,
    sort,
    range: rangeBounds,
    limit: PAGE_SIZE,
    offset,
  });

  const hasMore = offset + dashboard.rows.length < dashboard.totalMatchingRows;
  const nextOffset = offset + PAGE_SIZE;
  const ratedTotal = dashboard.positiveCount + dashboard.negativeCount;
  const positiveOfRated = formatPct(dashboard.positiveCount, ratedTotal);
  const anyFeedbackOfInquiries = formatPct(ratedTotal, dashboard.totalInquiries);

  const chip = (active: boolean) =>
    active
      ? "rounded-md bg-[var(--acton-navy)] px-3 py-1 font-medium text-white"
      : "rounded-md border border-[var(--acton-border)] px-3 py-1 text-[var(--acton-navy)] hover:bg-[var(--acton-soft)]";

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Baxter feedback</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Reporting dashboard for web chat and Slack thumbs feedback. Date boundaries use Pacific
            Time (America/Los_Angeles). Filter state is in the URL so views are bookmarkable.
          </p>
        </div>

        <Card>
          <CardTitle>Filters</CardTitle>
          <form method="get" action="/admin/baxter/feedback" className="mt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-[var(--acton-navy)]">Date range</span>
                <select
                  name="range"
                  defaultValue={rangePreset}
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
                  defaultValue={rating}
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                >
                  <option value="all">All</option>
                  <option value="up">Positive</option>
                  <option value="down">Negative</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-[var(--acton-navy)]">Sort</span>
                <select
                  name="sort"
                  defaultValue={sort}
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </label>
              <div className="flex items-end">
                <Button type="submit" className="w-full md:w-auto">
                  Apply filters
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-[var(--acton-navy)]">
                  Custom start (Pacific) — used when range is Custom
                </span>
                <input
                  type="date"
                  name="start"
                  defaultValue={customStart}
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
                  defaultValue={customEnd}
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                />
              </label>
            </div>
            <p className="text-xs text-[var(--acton-muted)]">
              Quick links:{" "}
              {RANGE_OPTIONS.filter((o) => o.value !== "custom").map((opt, i) => (
                <span key={opt.value}>
                  {i > 0 ? " · " : null}
                  <Link
                    href={buildFeedbackHref({
                      range: opt.value,
                      rating,
                      sort,
                    })}
                    className="underline"
                  >
                    {opt.label}
                  </Link>
                </span>
              ))}
            </p>
          </form>
        </Card>

        <div>
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Summary</h2>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">
            For the selected date range. “No feedback given” is neutral — it means no thumbs rating
            was recorded, not that the answer was poor.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardTitle>Total inquiries</CardTitle>
            <CardDescription className="mt-2 text-3xl font-bold text-[var(--acton-navy)]">
              {dashboard.totalInquiries}
            </CardDescription>
            <p className="mt-2 text-xs text-[var(--acton-muted)]">
              Baxter assistant replies · {dashboard.channelBreakdown.slack} Slack,{" "}
              {dashboard.channelBreakdown.web} web
            </p>
          </Card>
          <Card>
            <CardTitle>Positive</CardTitle>
            <CardDescription className="mt-2 text-3xl font-bold text-emerald-700">
              {dashboard.positiveCount}
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Negative</CardTitle>
            <CardDescription className="mt-2 text-3xl font-bold text-red-700">
              {dashboard.negativeCount}
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>No feedback given</CardTitle>
            <CardDescription className="mt-2 text-3xl font-bold text-[var(--acton-muted)]">
              {dashboard.noFeedbackCount}
            </CardDescription>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardTitle>Of rated responses</CardTitle>
            <CardDescription className="mt-2 text-2xl font-semibold text-emerald-700">
              {positiveOfRated} positive
            </CardDescription>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              {dashboard.positiveCount} up / {ratedTotal} rated (thumbs given in range)
            </p>
          </Card>
          <Card>
            <CardTitle>Of all responses</CardTitle>
            <CardDescription className="mt-2 text-2xl font-semibold text-[var(--acton-navy)]">
              {anyFeedbackOfInquiries} received any feedback
            </CardDescription>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              {ratedTotal} ratings / {dashboard.totalInquiries} inquiries
            </p>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--acton-muted)]">List rating:</span>
          {(
            [
              ["all", "All"],
              ["up", "Positive"],
              ["down", "Negative"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={buildFeedbackHref({
                range: rangePreset,
                rating: key,
                sort,
                start: customStart,
                end: customEnd,
              })}
              className={chip(rating === key)}
            >
              {label}
            </Link>
          ))}
          <span className="ml-2 text-[var(--acton-muted)]">Sort:</span>
          <Link
            href={buildFeedbackHref({
              range: rangePreset,
              rating,
              sort: "newest",
              start: customStart,
              end: customEnd,
            })}
            className={chip(sort === "newest")}
          >
            Newest
          </Link>
          <Link
            href={buildFeedbackHref({
              range: rangePreset,
              rating,
              sort: "oldest",
              start: customStart,
              end: customEnd,
            })}
            className={chip(sort === "oldest")}
          >
            Oldest
          </Link>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">
            Feedback ({dashboard.totalMatchingRows})
          </h2>
          {dashboard.rows.length === 0 ? (
            <p className="text-sm text-[var(--acton-muted)]">No feedback matches this filter.</p>
          ) : (
            dashboard.rows.map((row) => (
              <Card key={row.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      row.rating === "up"
                        ? "rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                        : "rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"
                    }
                  >
                    {row.rating === "up" ? "Positive" : "Negative"}
                  </span>
                  <span className="rounded bg-[var(--acton-soft)] px-2 py-0.5 text-xs font-medium text-[var(--acton-navy)]">
                    {row.channel === "slack" ? "Slack" : "Web"}
                  </span>
                  <CardDescription className="!mt-0">
                    {new Date(row.createdAt).toLocaleString()} · {row.commenterLabel}
                  </CardDescription>
                </div>
                {row.questionExcerpt ? (
                  <p className="mt-2 text-sm font-semibold text-[var(--acton-navy)]">
                    Q: {row.questionExcerpt}
                  </p>
                ) : null}
                {row.answerExcerpt ? (
                  <p className="mt-1 text-sm text-[var(--acton-muted)]">A: {row.answerExcerpt}</p>
                ) : null}
                {row.comment ? (
                  <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--acton-navy)]">
                    Comment: {row.comment}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-[var(--acton-muted)]">
                  Mode: {row.answerMode ?? "—"} · Sources: {row.sourceCount}
                  {row.errorCode ? ` · Error: ${row.errorCode}` : ""}
                </p>
              </Card>
            ))
          )}

          {hasMore ? (
            <Link
              href={buildFeedbackHref({
                range: rangePreset,
                rating,
                sort,
                start: customStart,
                end: customEnd,
                offset: nextOffset,
              })}
              className="inline-block text-sm font-medium text-[var(--acton-navy)] underline"
            >
              Load more
            </Link>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
