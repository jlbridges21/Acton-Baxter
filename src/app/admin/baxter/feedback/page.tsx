import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  FeedbackFiltersPanel,
  type FeedbackFiltersState,
} from "@/components/admin/feedback-filters-panel";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import {
  getFeedbackDashboard,
  parseFeedbackRangePreset,
  resolveFeedbackDateRange,
  type FeedbackSortDirection,
} from "@/lib/baxter-ai/feedback";

const PAGE_SIZE = 50;

function paramString(raw: string | string[] | undefined): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}

function parseRating(raw: string | undefined): "all" | "positive" | "negative" | "none" {
  if (raw === "positive" || raw === "negative" || raw === "none") return raw;
  // Back-compat with older up/down URLs
  if (raw === "up") return "positive";
  if (raw === "down") return "negative";
  return "all";
}

function parseChannel(raw: string | undefined): "all" | "web" | "slack" {
  if (raw === "web" || raw === "slack") return raw;
  return "all";
}

function parseSort(raw: string | undefined): FeedbackSortDirection {
  return raw === "oldest" ? "oldest" : "newest";
}

function buildHref(input: {
  range: string;
  rating: string;
  channel: string;
  sort: string;
  asker?: string;
  department?: string;
  start?: string;
  end?: string;
  offset?: number;
}): string {
  const params = new URLSearchParams();
  params.set("range", input.range);
  if (input.rating !== "all") params.set("rating", input.rating);
  if (input.channel !== "all") params.set("channel", input.channel);
  if (input.sort !== "newest") params.set("sort", input.sort);
  if (input.asker) params.set("asker", input.asker);
  if (input.department) params.set("department", input.department);
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
  const channel = parseChannel(paramString(params.channel));
  const sort = parseSort(paramString(params.sort));
  const askerKey = paramString(params.asker) ?? "";
  const department = paramString(params.department) ?? "";
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
    channel,
    askerKey: askerKey || null,
    department: department || null,
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

  const filterState: FeedbackFiltersState = {
    range: rangePreset,
    rating,
    channel,
    sort,
    askerKey,
    department,
    customStart,
    customEnd,
  };

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Baxter feedback</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Every Baxter answer in the selected range, with thumbs status. Date boundaries use
            Pacific Time. Filter state lives in the URL.
          </p>
        </div>

        <FeedbackFiltersPanel
          initial={filterState}
          askerOptions={dashboard.askerOptions}
          departmentOptions={dashboard.departmentOptions}
        />

        <div>
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Summary</h2>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">
            Inquiry-based counts: positive + negative + no feedback = total inquiries for the
            current range/channel/asker/department filters. “No feedback given” is neutral.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardTitle>Total inquiries</CardTitle>
            <CardDescription className="mt-2 text-3xl font-bold text-[var(--acton-navy)]">
              {dashboard.totalInquiries}
            </CardDescription>
            <p className="mt-2 text-xs text-[var(--acton-muted)]">
              {dashboard.channelBreakdown.slack} Slack · {dashboard.channelBreakdown.web} web
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
            <CardTitle>Of rated inquiries</CardTitle>
            <CardDescription className="mt-2 text-2xl font-semibold text-emerald-700">
              {positiveOfRated} positive
            </CardDescription>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              {dashboard.positiveCount} / {ratedTotal} rated
            </p>
          </Card>
          <Card>
            <CardTitle>Of all inquiries</CardTitle>
            <CardDescription className="mt-2 text-2xl font-semibold text-[var(--acton-navy)]">
              {anyFeedbackOfInquiries} received any feedback
            </CardDescription>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              {ratedTotal} / {dashboard.totalInquiries}
            </p>
          </Card>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">
            Inquiries ({dashboard.totalMatchingRows})
          </h2>
          {dashboard.rows.length === 0 ? (
            <p className="text-sm text-[var(--acton-muted)]">No inquiries match this filter.</p>
          ) : (
            dashboard.rows.map((row) => (
              <Card key={row.messageId}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      row.summarizedRating === "positive"
                        ? "rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                        : row.summarizedRating === "negative"
                          ? "rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"
                          : "rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
                    }
                  >
                    {row.summarizedRating === "positive"
                      ? "Positive"
                      : row.summarizedRating === "negative"
                        ? "Negative"
                        : "No feedback"}
                  </span>
                  <span className="rounded bg-[var(--acton-soft)] px-2 py-0.5 text-xs font-medium text-[var(--acton-navy)]">
                    {row.channel === "slack" ? "Slack" : "Web"}
                  </span>
                  <CardDescription className="!mt-0">
                    {new Date(row.createdAt).toLocaleString()} · Asked by {row.askerLabel}
                    {row.department ? ` · ${row.department}` : " · Unassigned"}
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
                {row.feedbackEntries.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--acton-muted)]">No feedback</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {row.feedbackEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-soft)]/40 px-3 py-2 text-sm"
                      >
                        <p className="font-medium text-[var(--acton-navy)]">
                          {entry.rating === "up" ? "👍 Positive" : "👎 Negative"} ·{" "}
                          {entry.commenterLabel}
                          <span className="ml-2 text-xs font-normal text-[var(--acton-muted)]">
                            {new Date(entry.createdAt).toLocaleString()}
                          </span>
                        </p>
                        {entry.comment ? (
                          <p className="mt-1 whitespace-pre-wrap text-[var(--acton-navy)]">
                            {entry.comment}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-[var(--acton-muted)]">
                  Mode: {row.answerMode ?? "—"} · Sources: {row.sourceCount}
                  {row.errorCode ? ` · Error: ${row.errorCode}` : ""}
                </p>
              </Card>
            ))
          )}

          {hasMore ? (
            <Link
              href={buildHref({
                range: rangePreset,
                rating,
                channel,
                sort,
                asker: askerKey,
                department,
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
