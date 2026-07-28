"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { AdminSlackDiagnosticsClient } from "@/components/admin/admin-slack-diagnostics-client";

type Overview = {
  cards: {
    activeUsers: number;
    conversations: number;
    messages: number;
    activeChannels: number;
    errors24h: number;
  };
  users: Array<{
    slackUserId: string;
    teamId: string;
    displayName: string;
    avatarUrl: string | null;
    conversationCount: number;
    messageCount: number;
    lastActiveAt: string | null;
    channels: string[];
    needsAttention: boolean;
  }>;
  channels: Array<{
    channelId: string;
    teamId: string;
    label: string;
    isDm: boolean;
    conversationCount: number;
    userCount: number;
    messageCount: number;
    lastActiveAt: string | null;
    needsAttention: boolean;
  }>;
  conversations: Array<{
    conversationId: string;
    userLabel: string;
    channelLabel: string;
    lastActivityAt: string;
    userMessageCount: number;
    firstQuestion: string;
    needsAttention: boolean;
    sourceCount: number;
  }>;
};

type SnapshotExtras = {
  health: { label: string; status: string; details: string };
  config: Record<string, unknown>;
  stats: {
    processedLast24h: number;
    pendingJobs: number;
    failedJobs: number;
    duplicatesIgnored: number;
    lastValidEventAt: string | null;
    lastCompletedAt: string | null;
    lastFailedAt: string | null;
    recentErrorCodes: string[];
  };
  identity?: {
    usersResolved: number;
    usersTotal: number;
    channelsResolved: number;
    channelsTotal: number;
    lastMetadataRefresh: string | null;
  };
};

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
      {value ? "Yes" : "No"}
    </span>
  );
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function AdminSlackActivityClient({
  overview,
  extras,
  initialTab = "activity",
  initialView = "users",
}: {
  overview: Overview;
  extras: SnapshotExtras;
  initialTab?: "activity" | "health" | "settings";
  initialView?: "users" | "channels";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(initialTab);
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  const q = searchParams.get("q") ?? "";
  const kind = searchParams.get("kind") ?? "all";
  const sort = searchParams.get("sort") ?? "recent";
  const range = searchParams.get("range") ?? "all";

  function updateQuery(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v || v === "all" || (k === "sort" && v === "recent")) params.delete(k);
      else params.set(k, v);
    }
    router.push(`/admin/slack?${params.toString()}`);
  }

  async function refreshNames() {
    setBusy(true);
    setBackfillMsg(null);
    try {
      const res = await fetch("/api/admin/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh_names" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Refresh failed");
      const result = data.result as {
        usersResolved: number;
        channelsResolved: number;
      };
      setBackfillMsg(
        `Resolved ${result.usersResolved} users and ${result.channelsResolved} channels.`,
      );
      router.refresh();
    } catch (error) {
      setBackfillMsg(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  const tabs = useMemo(
    () =>
      [
        { id: "activity" as const, label: "Activity" },
        { id: "health" as const, label: "Health" },
        { id: "settings" as const, label: "Settings" },
      ] as const,
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Slack</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            See who is using Baxter in Slack, where they are chatting, and open conversations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <Button
              key={t.id}
              type="button"
              size="sm"
              variant={tab === t.id ? "primary" : "secondary"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {tab === "activity" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {(
              [
                ["Active users", overview.cards.activeUsers],
                ["Conversations", overview.cards.conversations],
                ["Messages", overview.cards.messages],
                ["Active channels", overview.cards.activeChannels],
                ["Errors (24h)", overview.cards.errors24h],
              ] as const
            ).map(([label, value]) => (
              <Card key={label} className="p-4">
                <CardTitle className="text-sm font-medium text-[var(--acton-muted)]">
                  {label}
                </CardTitle>
                <p className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">{value}</p>
              </Card>
            ))}
          </div>

          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Filters</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void refreshNames()}
              >
                {busy ? "Refreshing…" : "Refresh Slack names"}
              </Button>
            </div>
            {backfillMsg ? (
              <p className="text-xs text-[var(--acton-muted)]">{backfillMsg}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <input
                className="min-w-[200px] flex-1 rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
                placeholder="Search users, channels, conversation text"
                defaultValue={q}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    updateQuery({ q: (e.target as HTMLInputElement).value });
                  }
                }}
              />
              <select
                className="rounded-md border border-[var(--acton-border)] px-2 py-2 text-sm"
                value={kind}
                onChange={(e) => updateQuery({ kind: e.target.value })}
              >
                <option value="all">All</option>
                <option value="dm">Direct Messages</option>
                <option value="channels">Channels</option>
                <option value="recent">Recent</option>
                <option value="errors">Has errors</option>
              </select>
              <select
                className="rounded-md border border-[var(--acton-border)] px-2 py-2 text-sm"
                value={range}
                onChange={(e) => updateQuery({ range: e.target.value })}
              >
                <option value="all">Any time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
              <select
                className="rounded-md border border-[var(--acton-border)] px-2 py-2 text-sm"
                value={sort}
                onChange={(e) => updateQuery({ sort: e.target.value })}
              >
                <option value="recent">Most recent</option>
                <option value="name">Name</option>
                <option value="conversations">Most conversations</option>
                <option value="messages">Most messages</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={view === "users" ? "primary" : "secondary"}
                onClick={() => setView("users")}
              >
                Users
              </Button>
              <Button
                type="button"
                size="sm"
                variant={view === "channels" ? "primary" : "secondary"}
                onClick={() => setView("channels")}
              >
                Channels
              </Button>
            </div>
          </Card>

          {view === "users" ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Users</h2>
              {overview.users.length === 0 ? (
                <p className="text-sm text-[var(--acton-muted)]">
                  No Baxter Slack conversations yet.
                </p>
              ) : (
                overview.users.map((user) => (
                  <Card key={`${user.teamId}:${user.slackUserId}`} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <InitialsAvatar name={user.displayName} size={40} />
                        <div className="min-w-0">
                          <CardTitle className="text-base">{user.displayName}</CardTitle>
                          <CardDescription className="mt-1">
                            {user.conversationCount} conversations · {user.messageCount} messages
                            {user.needsAttention ? " · Needs attention" : ""}
                          </CardDescription>
                          <p className="mt-1 text-xs text-[var(--acton-muted)]">
                            Last active: {formatWhen(user.lastActiveAt)}
                          </p>
                          <p className="mt-1 text-xs text-[var(--acton-muted)]">
                            Channels: {user.channels.join(", ") || "—"}
                          </p>
                        </div>
                      </div>
                      <Link
                        href={`/admin/slack/users/${encodeURIComponent(user.teamId)}/${encodeURIComponent(user.slackUserId)}`}
                        className="text-sm font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                      >
                        View conversations
                      </Link>
                    </div>
                  </Card>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Channels</h2>
              {overview.channels.length === 0 ? (
                <p className="text-sm text-[var(--acton-muted)]">
                  No Baxter Slack conversations yet.
                </p>
              ) : (
                overview.channels.map((channel) => (
                  <Card key={`${channel.teamId}:${channel.channelId}`} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{channel.label}</CardTitle>
                        <CardDescription className="mt-1">
                          {channel.conversationCount} conversations · {channel.userCount} users ·{" "}
                          {channel.messageCount} messages
                          {channel.needsAttention ? " · Needs attention" : ""}
                        </CardDescription>
                        <p className="mt-1 text-xs text-[var(--acton-muted)]">
                          Last active: {formatWhen(channel.lastActiveAt)}
                        </p>
                      </div>
                      <Link
                        href={`/admin/slack/channels/${encodeURIComponent(channel.teamId)}/${encodeURIComponent(channel.channelId)}`}
                        className="text-sm font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                      >
                        View activity
                      </Link>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Recent conversations</h2>
            {overview.conversations.slice(0, 12).map((c) => (
              <Card key={c.conversationId} className="p-4">
                <CardTitle className="text-base">
                  {c.userLabel}
                  <span className="font-normal text-[var(--acton-muted)]"> · {c.channelLabel}</span>
                </CardTitle>
                <CardDescription className="mt-1">
                  {formatWhen(c.lastActivityAt)} · {c.userMessageCount} user messages
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
        </>
      ) : null}

      {tab === "health" ? (
        <div className="space-y-4">
          <Card className="p-4">
            <CardTitle>Slack</CardTitle>
            <CardDescription className="mt-2 text-lg font-semibold text-[var(--acton-navy)]">
              {extras.health.status === "healthy" ||
              extras.health.label.toLowerCase().includes("ok")
                ? "Connected"
                : extras.health.label}{" "}
              <span className="text-sm font-normal text-[var(--acton-muted)]">
                ({extras.health.status})
              </span>
            </CardDescription>
            <p className="mt-2 text-sm text-[var(--acton-muted)]">{extras.health.details}</p>
            {extras.identity ? (
              <ul className="mt-3 space-y-1 text-sm text-[var(--acton-navy)]">
                <li>
                  Users: {extras.identity.usersResolved} resolved
                  {extras.identity.usersTotal ? ` of ${extras.identity.usersTotal} seen` : ""}
                </li>
                <li>
                  Channels: {extras.identity.channelsResolved} resolved
                  {extras.identity.channelsTotal ? ` of ${extras.identity.channelsTotal} seen` : ""}
                </li>
                <li>Last metadata refresh: {formatWhen(extras.identity.lastMetadataRefresh)}</li>
              </ul>
            ) : null}
          </Card>
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="p-4">
              <CardTitle className="text-base">Events (24h)</CardTitle>
              <p className="mt-2 text-2xl font-bold">{extras.stats.processedLast24h}</p>
            </Card>
            <Card className="p-4">
              <CardTitle className="text-base">Pending jobs</CardTitle>
              <p className="mt-2 text-2xl font-bold">{extras.stats.pendingJobs}</p>
            </Card>
            <Card className="p-4">
              <CardTitle className="text-base">Failed jobs</CardTitle>
              <p className="mt-2 text-2xl font-bold">{extras.stats.failedJobs}</p>
            </Card>
            <Card className="p-4">
              <CardTitle className="text-base">Duplicates ignored</CardTitle>
              <p className="mt-2 text-2xl font-bold">{extras.stats.duplicatesIgnored}</p>
            </Card>
          </div>
          <details className="rounded-lg border border-[var(--acton-border)] bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--acton-navy)]">
              Advanced health signals
            </summary>
            <ul className="mt-3 space-y-1 text-sm text-[var(--acton-muted)]">
              <li>Last valid event: {extras.stats.lastValidEventAt ?? "—"}</li>
              <li>Last successful reply: {extras.stats.lastCompletedAt ?? "—"}</li>
              <li>Last failed reply: {extras.stats.lastFailedAt ?? "—"}</li>
              <li>
                Recent error codes:{" "}
                {extras.stats.recentErrorCodes.length
                  ? extras.stats.recentErrorCodes.join(", ")
                  : "none"}
              </li>
            </ul>
            <div className="mt-4">
              <AdminSlackDiagnosticsClient />
            </div>
          </details>
        </div>
      ) : null}

      {tab === "settings" ? (
        <Card className="p-4">
          <CardTitle>Slack configuration</CardTitle>
          <dl className="mt-3 grid gap-2 text-sm text-[var(--acton-navy)] md:grid-cols-2">
            <div>
              Integration enabled: <YesNo value={Boolean(extras.config.integrationEnabled)} />
            </div>
            <div>
              Signing secret present: <YesNo value={Boolean(extras.config.signingSecretPresent)} />
            </div>
            <div>
              Bot token present: <YesNo value={Boolean(extras.config.botTokenPresent)} />
            </div>
            <div>
              DMs enabled: <YesNo value={Boolean(extras.config.dmsEnabled)} />
            </div>
            <div>
              Channel mentions enabled:{" "}
              <YesNo value={Boolean(extras.config.channelMentionsEnabled)} />
            </div>
            <div>Allowed channels: {String(extras.config.allowedChannelCount ?? 0)}</div>
            <div className="break-all md:col-span-2">
              Events endpoint: {String(extras.config.eventsEndpointUrl ?? "")}
            </div>
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
