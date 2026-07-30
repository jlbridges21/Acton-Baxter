"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { mergeConversationTimelineNewestFirst } from "@/lib/connectors/ghl/conversation-sort";

type Message = {
  id: string;
  direction: string;
  actorLabel: string;
  fromAddress?: string | null;
  channel: string;
  subject?: string | null;
  body: string;
  bodyPreview?: string;
  hasFullBody?: boolean;
  at: string | null;
  dateAdded?: string | null;
  status?: string | null;
  attachments?: number;
  contentSource?: string | null;
};

export function GhlConversationDetailClient() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId;
  const [contactName, setContactName] = useState("Conversation");
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState<string | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [latestActivity, setLatestActivity] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [channelFilter, setChannelFilter] = useState<"all" | "Email" | "SMS" | "Call">("all");

  const load = useCallback(
    async (opts?: { lastMessageId?: string; append?: boolean }) => {
      if (!opts?.append) setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/connectors/ghl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get_conversation_detail",
            conversationId,
            lastMessageId: opts?.lastMessageId,
            limit: 30,
          }),
        });
        const json = await response.json();
        if (!json.result?.pass || !json.result.data) {
          setError(json.result?.message || "Couldn't load conversation.");
          return;
        }
        const data = json.result.data;
        setContactName(data.contactName || "Conversation");
        setContactId(data.contactId || null);
        setContactEmail(data.contactEmail || null);
        setContactPhone(data.contactPhone || null);
        setChannel(data.channel || null);
        setLatestActivity(data.latestActivityLabel || null);
        setHasMore(Boolean(data.hasMore));
        setMessages((prev) =>
          opts?.append
            ? mergeConversationTimelineNewestFirst(prev, data.messages as Message[])
            : mergeConversationTimelineNewestFirst([], data.messages as Message[]),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load conversation.");
      } finally {
        setLoading(false);
      }
    },
    [conversationId],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function copyBody(message: Message) {
    try {
      await navigator.clipboard.writeText(message.body || "");
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError("Couldn't copy message body.");
    }
  }

  if (loading) {
    return <p className="p-6 text-sm text-[var(--acton-muted)]">Opening conversation…</p>;
  }

  if (error && messages.length === 0) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-red-700">{error}</p>
        <Button onClick={() => void load()} variant="secondary" size="sm">
          Retry
        </Button>
      </div>
    );
  }

  const visible =
    channelFilter === "all"
      ? messages
      : messages.filter((m) => m.channel === channelFilter || m.channel?.includes(channelFilter));

  // Newest-first: oldest message is at the bottom — use it as pagination cursor.
  const oldestLoadedId = messages.length ? messages[messages.length - 1]?.id : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link
          href="/admin/connectors/ghl?tab=conversations"
          className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
        >
          ← Conversations
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--acton-fg)]">{contactName}</h1>
        <p className="text-sm text-[var(--acton-muted)]">
          {[contactEmail, contactPhone].filter(Boolean).join(" · ") || "No email/phone"}
        </p>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          {channel || "Conversation"}
          {latestActivity ? ` · Latest ${latestActivity}` : null}
          {contactId ? (
            <>
              {" · "}
              <Link
                href={`/admin/connectors/ghl/contacts/${contactId}`}
                className="text-[var(--acton-navy)] hover:underline"
              >
                Open contact
              </Link>
            </>
          ) : null}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "Email", "SMS", "Call"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setChannelFilter(f)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
              channelFilter === f
                ? "border-sky-600 bg-sky-50 text-sky-800"
                : "border-[var(--acton-border)] text-[var(--acton-muted)]"
            }`}
          >
            {f === "all" ? "All types" : f}
          </button>
        ))}
      </div>

      <Card className="divide-y divide-[var(--acton-border)] p-0">
        {visible.length === 0 ? (
          <p className="p-4 text-sm text-[var(--acton-muted)]">No messages in this window.</p>
        ) : (
          visible.map((m) => {
            const expanded = Boolean(expandedIds[m.id]);
            const preview = m.bodyPreview || m.body.slice(0, 400);
            const showExpand = Boolean(m.hasFullBody || (m.body && m.body.length > 400));
            const displayBody = expanded ? m.body : preview;
            return (
              <div
                key={m.id}
                className={`space-y-1 px-4 py-3 text-sm ${
                  m.direction === "outbound" ? "bg-slate-50" : "bg-white"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--acton-muted)]">
                  <span className="font-medium text-[var(--acton-fg)]">{m.actorLabel}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      m.direction === "inbound"
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {m.direction === "inbound"
                      ? "Inbound"
                      : m.direction === "outbound"
                        ? "Outbound"
                        : "Unknown"}
                  </span>
                  <span>{m.channel}</span>
                  <span>{m.at || "—"}</span>
                  <button
                    type="button"
                    onClick={() => void copyBody(m)}
                    className="ml-auto text-[11px] font-medium text-sky-700 hover:underline"
                  >
                    {copiedId === m.id ? "Copied" : "Copy"}
                  </button>
                </div>
                {m.subject ? (
                  <p className="text-sm font-medium text-[var(--acton-fg)]">{m.subject}</p>
                ) : null}
                {m.fromAddress ? (
                  <p className="text-xs text-[var(--acton-muted)]">From: {m.fromAddress}</p>
                ) : null}
                <p className="whitespace-pre-wrap text-[var(--acton-fg)]">
                  {displayBody || "(no body)"}
                </p>
                {showExpand ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-sky-700 hover:underline"
                    onClick={() => setExpandedIds((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                  >
                    {expanded ? "Show less" : "Show full email"}
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </Card>

      {hasMore ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void load({
              append: true,
              lastMessageId: oldestLoadedId,
            })
          }
        >
          Load earlier messages
        </Button>
      ) : null}

      <p className="text-xs text-[var(--acton-muted)]">
        Messaging is read-only. Sending email/SMS through Baxter is not enabled. Newest messages
        appear at the top.
      </p>
    </div>
  );
}
