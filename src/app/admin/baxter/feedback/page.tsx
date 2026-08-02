import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listFeedbackForAdmin, type BaxterFeedbackRating } from "@/lib/baxter-ai/feedback";

const PAGE_SIZE = 50;

function parseRating(raw: string | string[] | undefined): "all" | BaxterFeedbackRating {
  const value = typeof raw === "string" ? raw : "all";
  if (value === "up" || value === "down") return value;
  return "all";
}

function filterHref(rating: "all" | BaxterFeedbackRating) {
  if (rating === "all") return "/admin/baxter/feedback";
  return `/admin/baxter/feedback?rating=${rating}`;
}

export default async function BaxterFeedbackAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const params = await searchParams;
  const rating = parseRating(params.rating);
  const offsetRaw = typeof params.offset === "string" ? Number(params.offset) : 0;
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  const summary = await listFeedbackForAdmin({ rating, limit: PAGE_SIZE, offset });
  const hasMore = offset + summary.rows.length < summary.totalMatching;
  const nextOffset = offset + PAGE_SIZE;

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Baxter feedback</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Thumbs feedback from web chat and Slack reactions. No hidden prompts are stored.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardTitle>Positive</CardTitle>
            <CardDescription className="mt-2 text-3xl font-bold text-emerald-700">
              {summary.positiveCount}
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Negative</CardTitle>
            <CardDescription className="mt-2 text-3xl font-bold text-red-700">
              {summary.negativeCount}
            </CardDescription>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--acton-muted)]">Filter:</span>
          {(
            [
              ["all", "All"],
              ["up", "Positive"],
              ["down", "Negative"],
            ] as const
          ).map(([key, label]) => {
            const active = rating === key;
            return (
              <Link
                key={key}
                href={filterHref(key)}
                className={
                  active
                    ? "rounded-md bg-[var(--acton-navy)] px-3 py-1 font-medium text-white"
                    : "rounded-md border border-[var(--acton-border)] px-3 py-1 text-[var(--acton-navy)] hover:bg-[var(--acton-soft)]"
                }
              >
                {label}
              </Link>
            );
          })}
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">
            Feedback ({summary.totalMatching})
          </h2>
          {summary.rows.length === 0 ? (
            <p className="text-sm text-[var(--acton-muted)]">No feedback matches this filter.</p>
          ) : (
            summary.rows.map((row) => (
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
              href={`/admin/baxter/feedback?rating=${rating}&offset=${nextOffset}`}
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
