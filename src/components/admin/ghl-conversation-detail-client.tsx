"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Message = {
  id: string;
  direction: string;
  actorLabel: string;
  channel: string;
  body: string;
  at: string | null;
};

export function GhlConversationDetailClient() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId;
  const [contactName, setContactName] = useState("Conversation");
  const [contactId, setContactId] = useState<string | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        setChannel(data.channel || null);
        setHasMore(Boolean(data.hasMore));
        setMessages((prev) => (opts?.append ? [...data.messages, ...prev] : data.messages));
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

  if (loading) {
    return <p className="p-6 text-sm text-[var(--acton-muted)]">Opening conversation…</p>;
  }

  if (error) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-red-700">{error}</p>
        <Button onClick={() => void load()} variant="secondary" size="sm">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link
          href="/admin/connectors/ghl"
          className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
        >
          ← Acton CRM
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--acton-fg)]">{contactName}</h1>
        <p className="text-sm text-[var(--acton-muted)]">
          {channel || "Conversation"}
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

      {hasMore ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void load({
              append: true,
              lastMessageId: messages[0]?.id,
            })
          }
        >
          Load earlier messages
        </Button>
      ) : null}

      <Card className="divide-y divide-[var(--acton-border)] p-0">
        {messages.length === 0 ? (
          <p className="p-4 text-sm text-[var(--acton-muted)]">No messages in this window.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`space-y-1 px-4 py-3 text-sm ${
                m.direction === "outbound" ? "bg-slate-50" : "bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--acton-muted)]">
                <span className="font-medium text-[var(--acton-fg)]">{m.actorLabel}</span>
                <span>{m.channel}</span>
                <span>{m.at || "—"}</span>
              </div>
              <p className="whitespace-pre-wrap text-[var(--acton-fg)]">{m.body || "(no body)"}</p>
            </div>
          ))
        )}
      </Card>

      <p className="text-xs text-[var(--acton-muted)]">
        Messaging is read-only. Sending email/SMS through Baxter is not enabled.
      </p>
    </div>
  );
}
