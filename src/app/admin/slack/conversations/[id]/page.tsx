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
  const userHref =
    teamId && conversation.external_user_id
      ? `/admin/slack/users/${encodeURIComponent(teamId)}/${encodeURIComponent(conversation.external_user_id)}`
      : null;
  const channelHref =
    teamId && channelId
      ? `/admin/slack/channels/${encodeURIComponent(teamId)}/${encodeURIComponent(channelId)}`
      : null;

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Link
            href="/admin/slack"
            className="text-xs font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
          >
            ← Back to Slack activity
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
            {userHref ? (
              <Link href={userHref} className="hover:underline">
                {detail.userLabel}
              </Link>
            ) : (
              detail.userLabel
            )}
          </h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            {channelHref ? (
              <Link href={channelHref} className="font-semibold hover:underline">
                {detail.channelLabel}
              </Link>
            ) : (
              detail.channelLabel
            )}
            {!detail.isDm ? " · Thread" : ""}
          </p>
        </div>

        <Card className="p-4">
          <CardTitle>Conversation</CardTitle>
          <CardDescription className="mt-2">
            Started {new Date(conversation.created_at).toLocaleString()}
            {conversation.last_message_at
              ? ` · Last activity ${new Date(conversation.last_message_at).toLocaleString()}`
              : ""}
          </CardDescription>
          <details className="mt-3 text-xs text-[var(--acton-muted)]">
            <summary className="cursor-pointer font-semibold">Technical details</summary>
            <dl className="mt-2 grid gap-1 md:grid-cols-2">
              <div>Slack user: {conversation.external_user_id ?? "—"}</div>
              <div>Slack channel: {channelId ?? "—"}</div>
              <div>Team: {teamId ?? "—"}</div>
              <div>Thread / user key: {threadOrUser ?? "—"}</div>
              <div className="break-all md:col-span-2">
                External thread ID: {conversation.external_thread_id ?? "—"}
              </div>
            </dl>
          </details>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Messages</h2>
          {messages.map((message) => {
            if (message.isSystemReset) {
              return (
                <div
                  key={message.id}
                  className="rounded-md border border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-2 text-center text-xs text-[var(--acton-muted)]"
                >
                  Conversation reset · {new Date(message.createdAt).toLocaleString()}
                </div>
              );
            }

            const isBaxter = message.role === "assistant";
            return (
              <div
                key={message.id}
                className={`rounded-lg border border-[var(--acton-border)] p-4 ${
                  isBaxter ? "bg-white" : "bg-[var(--acton-gray-50)]"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--acton-navy)]">
                    {message.speakerLabel}
                  </p>
                  <p className="text-xs text-[var(--acton-muted)]">
                    {new Date(message.createdAt).toLocaleString()}
                  </p>
                </div>
                <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--acton-navy)]">
                  {message.content}
                </p>
                {message.sources.length > 0 ? (
                  <div className="mt-3 border-t border-[var(--acton-border)] pt-2">
                    <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                      Sources
                    </p>
                    <ul className="mt-1 space-y-1 text-xs text-[var(--acton-muted)]">
                      {message.sources.map((source, index) => (
                        <li key={`${message.id}-src-${index}`}>
                          {source.title ?? source.citationLabel ?? "Source"}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {message.errorCode ? (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Needs attention: {message.errorCode}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
