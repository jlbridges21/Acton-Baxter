import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getSlackConversationDetail } from "@/lib/slack/admin";

export default async function AdminSlackConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const { id } = await params;
  const detail = await getSlackConversationDetail(id);
  if (!detail) notFound();

  const { conversation, teamId, channelId, threadOrUser, messages } = detail;

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Link
            href="/admin/slack"
            className="text-xs font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
          >
            ← Back to Slack admin
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">Slack conversation</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            {conversation.user_display_name ?? conversation.external_user_id ?? "Slack user"}
          </p>
        </div>

        <Card>
          <CardTitle>Conversation metadata</CardTitle>
          <dl className="mt-3 grid gap-2 text-sm text-[var(--acton-navy)] md:grid-cols-2">
            <div>Channel type: slack</div>
            <div>Team ID: {teamId ?? "—"}</div>
            <div>Channel ID: {channelId ?? "—"}</div>
            <div>Thread / user key: {threadOrUser ?? "—"}</div>
            <div>Slack user ID: {conversation.external_user_id ?? "—"}</div>
            <div>Started: {new Date(conversation.created_at).toLocaleString()}</div>
            <div className="break-all md:col-span-2">
              External thread ID: {conversation.external_thread_id ?? "—"}
            </div>
          </dl>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Messages</h2>
          {messages.map((message) => (
            <Card key={message.id}>
              <CardTitle className="text-base capitalize">{message.role}</CardTitle>
              <CardDescription className="mt-1">
                {new Date(message.createdAt).toLocaleString()}
                {message.answerMode ? ` · ${message.answerMode}` : ""}
                {message.modelProvider ? ` · ${message.modelProvider}` : ""}
                {message.modelName ? ` / ${message.modelName}` : ""}
                {typeof message.latencyMs === "number" ? ` · ${message.latencyMs}ms` : ""}
              </CardDescription>
              <p className="mt-3 text-sm whitespace-pre-wrap text-[var(--acton-navy)]">
                {message.content}
              </p>
              {message.sources.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-[var(--acton-muted)]">
                  {message.sources.map((source, index) => (
                    <li key={`${message.id}-src-${index}`}>
                      {source.title ?? source.citationLabel ?? "Source"}
                      {source.sourceUrl ? ` — ${source.sourceUrl}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {message.errorCode ? (
                <p className="mt-2 text-xs font-semibold text-red-700">
                  Error: {message.errorCode}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
