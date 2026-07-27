import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getSlackUserActivityDetail } from "@/lib/slack/admin";

export default async function AdminSlackUserPage({
  params,
}: {
  params: Promise<{ teamId: string; slackUserId: string }>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const { teamId, slackUserId } = await params;
  const detail = await getSlackUserActivityDetail(
    decodeURIComponent(teamId),
    decodeURIComponent(slackUserId),
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
          <div className="mt-3 flex items-center gap-3">
            {detail.user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={detail.user.avatarUrl}
                alt=""
                className="h-12 w-12 rounded-full border border-[var(--acton-border)]"
              />
            ) : null}
            <div>
              <h1 className="text-2xl font-bold text-[var(--acton-navy)]">
                {detail.user.displayName}
              </h1>
              <p className="text-sm text-[var(--acton-muted)]">
                {detail.user.conversationCount} conversations · {detail.user.messageCount} messages
              </p>
            </div>
          </div>
        </div>

        <Card className="p-4">
          <CardTitle>Summary</CardTitle>
          <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <div>
              First activity:{" "}
              {detail.user.firstActiveAt
                ? new Date(detail.user.firstActiveAt).toLocaleString()
                : "—"}
            </div>
            <div>
              Last activity:{" "}
              {detail.user.lastActiveAt ? new Date(detail.user.lastActiveAt).toLocaleString() : "—"}
            </div>
            <div className="md:col-span-2">
              Channels used: {detail.user.channels.join(", ") || "—"}
            </div>
          </dl>
          <details className="mt-3 text-xs text-[var(--acton-muted)]">
            <summary className="cursor-pointer font-semibold">Technical details</summary>
            <p className="mt-1">Slack user: {detail.user.slackUserId}</p>
            <p>Team: {detail.user.teamId}</p>
          </details>
        </Card>

        {detail.groups.map((group) => (
          <div key={group.channelLabel} className="space-y-3">
            <h2 className="text-lg font-semibold text-[var(--acton-navy)]">{group.channelLabel}</h2>
            {group.conversations.map((c) => (
              <Card key={c.conversationId} className="p-4">
                <CardTitle className="text-base">Conversation</CardTitle>
                <CardDescription className="mt-1">
                  {new Date(c.startedAt).toLocaleDateString()} · {c.messageCount} messages
                  {c.needsAttention ? " · Needs attention" : ""}
                </CardDescription>
                <p className="mt-2 text-sm text-[var(--acton-navy)]">
                  {c.firstQuestion || "(no question yet)"}
                </p>
                <Link
                  href={`/admin/slack/conversations/${c.conversationId}`}
                  className="mt-2 inline-block text-xs font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                >
                  Open conversation
                </Link>
              </Card>
            ))}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
