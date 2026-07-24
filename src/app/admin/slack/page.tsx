import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import {
  listMessagesForConversation,
  listRecentConversations,
} from "@/lib/baxter-ai/conversations";

export default async function AdminSlackPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const conversations = await listRecentConversations(40);
  const slackConversations = conversations.filter(
    (conversation) => conversation.channel === "slack",
  );

  const rows = await Promise.all(
    slackConversations.slice(0, 20).map(async (conversation) => {
      const messages = await listMessagesForConversation(conversation.id);
      const latestUser = [...messages].reverse().find((message) => message.role === "user");
      const latestAssistant = [...messages]
        .reverse()
        .find((message) => message.role === "assistant");
      const sources =
        latestAssistant &&
        Array.isArray((latestAssistant.metadata as { sources?: unknown }).sources)
          ? ((latestAssistant.metadata as { sources: Array<{ citationLabel?: string }> }).sources ??
            [])
          : [];
      return {
        conversation,
        question: latestUser?.content ?? "(no question yet)",
        answer: latestAssistant?.content ?? "",
        insufficient: latestAssistant?.insufficient_knowledge ?? false,
        errorCode: latestAssistant?.error_code ?? null,
        sources,
      };
    }),
  );

  const gaps = rows.filter((row) => row.insufficient);
  const errors = rows.filter((row) => row.errorCode);
  const questionCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.question.slice(0, 120);
    questionCounts.set(key, (questionCounts.get(key) ?? 0) + 1);
  }
  const commonQuestions = Array.from(questionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Slack activity</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Recent Baxter Slack conversations, knowledge gaps, and source usage.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardTitle className="text-base">Slack conversations</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              {slackConversations.length}
            </CardDescription>
          </Card>
          <Card>
            <CardTitle className="text-base">Knowledge gaps</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              {gaps.length}
            </CardDescription>
          </Card>
          <Card>
            <CardTitle className="text-base">Recent errors</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              {errors.length}
            </CardDescription>
          </Card>
        </div>

        <Card>
          <CardTitle>Most common recent questions</CardTitle>
          <ul className="mt-3 space-y-2 text-sm text-[var(--acton-navy)]">
            {commonQuestions.length === 0 ? (
              <li className="text-[var(--acton-muted)]">No Slack questions logged yet.</li>
            ) : (
              commonQuestions.map(([question, count]) => (
                <li key={question}>
                  <span className="font-semibold">{count}×</span> {question}
                </li>
              ))
            )}
          </ul>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Recent conversations</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--acton-muted)]">No Slack conversations yet.</p>
          ) : (
            rows.map((row) => (
              <Card key={row.conversation.id}>
                <CardTitle className="text-base">
                  {row.conversation.user_display_name ?? "Slack user"}
                </CardTitle>
                <CardDescription className="mt-2">
                  {row.conversation.last_message_at
                    ? new Date(row.conversation.last_message_at).toLocaleString()
                    : new Date(row.conversation.created_at).toLocaleString()}
                </CardDescription>
                <p className="mt-3 text-sm font-semibold text-[var(--acton-navy)]">
                  Q: {row.question}
                </p>
                <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--acton-muted)]">
                  A: {row.answer || "—"}
                </p>
                {row.sources.length > 0 ? (
                  <p className="mt-2 text-xs text-[var(--acton-navy)]">
                    Sources:{" "}
                    {row.sources.map((source) => source.citationLabel ?? "Source").join(" · ")}
                  </p>
                ) : null}
                {row.insufficient ? (
                  <p className="mt-2 text-xs font-semibold text-amber-800">Knowledge gap</p>
                ) : null}
                {row.errorCode ? (
                  <p className="mt-2 text-xs font-semibold text-red-700">Error: {row.errorCode}</p>
                ) : null}
                <Link
                  href={`/admin/slack?conversation=${row.conversation.id}`}
                  className="mt-3 inline-block text-xs font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                >
                  Open conversation
                </Link>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
