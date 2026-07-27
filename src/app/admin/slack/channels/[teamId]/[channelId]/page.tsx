import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getSlackChannelActivityDetail } from "@/lib/slack/admin";

export default async function AdminSlackChannelPage({
  params,
}: {
  params: Promise<{ teamId: string; channelId: string }>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const { teamId, channelId } = await params;
  const detail = await getSlackChannelActivityDetail(
    decodeURIComponent(teamId),
    decodeURIComponent(channelId),
  );
  if (!detail) notFound();

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
            {detail.channel.label}
          </h1>
          <p className="text-sm text-[var(--acton-muted)]">
            {detail.channel.conversationCount} conversations · {detail.channel.userCount} users ·{" "}
            {detail.channel.messageCount} messages
          </p>
        </div>

        <Card className="p-4">
          <CardTitle>Participants</CardTitle>
          <ul className="mt-3 space-y-1 text-sm">
            {detail.participants.length === 0 ? (
              <li className="text-[var(--acton-muted)]">No participants yet.</li>
            ) : (
              detail.participants.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/admin/slack/users/${encodeURIComponent(detail.channel.teamId)}/${encodeURIComponent(p.id)}`}
                    className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                  >
                    {p.label}
                  </Link>
                </li>
              ))
            )}
          </ul>
          <details className="mt-3 text-xs text-[var(--acton-muted)]">
            <summary className="cursor-pointer font-semibold">Technical details</summary>
            <p className="mt-1">Slack channel: {detail.channel.channelId}</p>
            <p>Team: {detail.channel.teamId}</p>
          </details>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Conversations</h2>
          {detail.conversations.map((c) => (
            <Card key={c.conversationId} className="p-4">
              <CardTitle className="text-base">{c.userLabel}</CardTitle>
              <CardDescription className="mt-1">
                {new Date(c.lastActivityAt).toLocaleString()} · {c.messageCount} messages
              </CardDescription>
              <p className="mt-2 text-sm">{c.firstQuestion || "(no question yet)"}</p>
              <Link
                href={`/admin/slack/conversations/${c.conversationId}`}
                className="mt-2 inline-block text-xs font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
              >
                Open conversation
              </Link>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
