import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getFeedbackAdminSummary } from "@/lib/baxter-ai/feedback";

export default async function BaxterFeedbackAdminPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const summary = await getFeedbackAdminSummary();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Baxter feedback</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Lightweight thumbs feedback from the web chat. No hidden prompts are stored.
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

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">
            Recent negative feedback
          </h2>
          {summary.recentNegative.length === 0 ? (
            <p className="text-sm text-[var(--acton-muted)]">No negative feedback yet.</p>
          ) : (
            summary.recentNegative.map((row) => (
              <Card key={row.id}>
                <CardDescription>{new Date(row.createdAt).toLocaleString()}</CardDescription>
                {"questionExcerpt" in row && row.questionExcerpt ? (
                  <p className="mt-2 text-sm font-semibold text-[var(--acton-navy)]">
                    Q: {row.questionExcerpt}
                  </p>
                ) : null}
                {"answerExcerpt" in row && row.answerExcerpt ? (
                  <p className="mt-1 text-sm text-[var(--acton-muted)]">A: {row.answerExcerpt}</p>
                ) : null}
                <p className="mt-2 text-xs text-[var(--acton-muted)]">
                  Mode: {"answerMode" in row ? (row.answerMode ?? "—") : "—"} · Sources:{" "}
                  {"sourceCount" in row ? (row.sourceCount ?? 0) : 0}
                  {"errorCode" in row && row.errorCode ? ` · Error: ${row.errorCode}` : ""}
                </p>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
