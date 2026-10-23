"use client";

/**
 * Dexter, the reporting specialist, as a chat panel. Floating (bottom-right, expandable)
 * on a report, or inline on "Create with Dexter". Dexter answers and edits reports through
 * validated tools; report changes arrive as platform-verified artifacts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BarChart3, Loader2, Maximize2, Minimize2, Send, X } from "lucide-react";
import { AgentAvatar, aiFetch, errorMessage, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatArtifact, ChatMessage } from "./types";

const DEXTER_COLOR = "#0f766e";

type Pending = { requestId: string; steps: string[] };

export function DexterChat({
  reportId,
  variant = "floating",
  canChat,
  blockedReason,
  suggestions = [],
  onArtifact,
}: {
  reportId: string | null;
  variant?: "floating" | "inline";
  canChat: boolean;
  /** When set, sending is paused with this explanation (e.g. unsaved layout edits). */
  blockedReason?: string | null;
  suggestions?: string[];
  onArtifact?: (artifact: ChatArtifact) => void;
}) {
  const [open, setOpen] = useState(variant === "inline");
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!open) return;
    try {
      const res = await aiFetch<{ messages: ChatMessage[] }>(
        `/api/reports/chat${reportId ? `?reportId=${reportId}` : ""}`,
      );
      setMessages(res.messages);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [open, reportId]);
  useLoad(load);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, pending]);

  // Poll the task's progress while Dexter works.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(async () => {
      try {
        const p = await aiFetch<{ status: string; steps: string[] }>(
          `/api/reports/chat/progress?requestId=${pending.requestId}`,
        );
        setPending((cur) =>
          cur && cur.requestId === pending.requestId ? { ...cur, steps: p.steps } : cur,
        );
      } catch {
        // progress is best-effort
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [pending]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || pending || blockedReason) return;
    const requestId = crypto.randomUUID();
    setDraft("");
    setError(null);
    const optimistic: ChatMessage = {
      id: `local-${requestId}`,
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
      artifacts: [],
      outcome: null,
      failed: false,
    };
    setMessages((m) => [...m, optimistic]);
    setPending({ requestId, steps: [] });
    try {
      const res = await aiFetch<{ user: ChatMessage; reply: ChatMessage }>("/api/reports/chat", {
        method: "POST",
        body: JSON.stringify({ reportId, message, requestId }),
      });
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), res.user, res.reply]);
      for (const a of res.reply.artifacts) onArtifact?.(a);
    } catch (e) {
      setError(errorMessage(e));
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setDraft(message);
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  };

  if (variant === "floating" && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-30 inline-flex items-center gap-2 rounded-full bg-[var(--acton-navy)] py-2 pr-4 pl-2 text-sm font-semibold text-white shadow-lg hover:bg-[var(--acton-navy-dark)] focus-visible:ring-2 focus-visible:ring-[var(--acton-yellow)] focus-visible:outline-none print:hidden"
      >
        <AgentAvatar name="Dexter" url={null} size={32} color={DEXTER_COLOR} />
        Ask Dexter
      </button>
    );
  }

  const panel = (
    <section
      aria-label="Chat with Dexter"
      className={cn(
        "flex flex-col overflow-hidden border border-[var(--acton-border)] bg-white print:hidden",
        variant === "floating"
          ? cn(
              "fixed right-5 bottom-5 z-30 rounded-xl shadow-2xl",
              expanded
                ? "h-[min(85vh,900px)] w-[min(calc(100vw-2.5rem),760px)]"
                : "h-[min(75vh,600px)] w-[min(calc(100vw-2.5rem),400px)]",
            )
          : "h-[min(70vh,680px)] rounded-xl shadow-sm",
      )}
    >
      <header className="flex items-center gap-3 border-b border-[var(--acton-border)] px-4 py-3">
        <AgentAvatar name="Dexter" url={null} size={36} color={DEXTER_COLOR} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--acton-navy)]">Dexter</p>
          <p className="truncate text-xs text-[var(--acton-muted)]">
            AI Reporting &amp; Data Analytics Specialist
          </p>
        </div>
        {variant === "floating" ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded p-1.5 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)]"
              aria-label={expanded ? "Shrink chat" : "Expand chat"}
            >
              {expanded ? (
                <Minimize2 className="h-4 w-4" aria-hidden />
              ) : (
                <Maximize2 className="h-4 w-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1.5 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)]"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : null}
      </header>

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
        aria-live="polite"
      >
        {messages.length === 0 && !pending ? (
          <div className="space-y-3 text-sm text-[var(--acton-muted)]">
            <p>
              {reportId
                ? "Ask me about this report or tell me what to change — for example, add a chart, filter to a phase, or explain a number."
                : "Describe the report you need. I'll build it from live JobTread data and tell you if a field isn't available."}
            </p>
            {suggestions.length ? (
              <div className="flex flex-col gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!canChat || Boolean(blockedReason)}
                    onClick={() => void send(s)}
                    className="rounded-lg border border-[var(--acton-border)] px-3 py-2 text-left text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)] disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-[var(--acton-navy)] text-white"
                  : m.failed
                    ? "border border-red-200 bg-red-50 text-red-900"
                    : "bg-[var(--acton-gray-50)] text-[var(--acton-navy)]",
              )}
            >
              {m.content}
              {m.artifacts.map((a) => (
                <Link
                  key={`${a.id}-${a.version}`}
                  href={a.url}
                  className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--acton-border)] bg-white px-3 py-2 font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                >
                  <BarChart3 className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{a.title}</span>
                  <span className="ml-auto shrink-0 text-xs font-normal text-[var(--acton-muted)]">
                    v{a.version}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
        {pending ? (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl bg-[var(--acton-gray-50)] px-3.5 py-2 text-sm text-[var(--acton-navy)]">
              <p className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Dexter is working…
              </p>
              {pending.steps.length ? (
                <ul className="mt-1 list-disc pl-5 text-xs text-[var(--acton-muted)]">
                  {pending.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="border-t border-[var(--acton-border)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        {error ? (
          <p className="mb-2 text-xs text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        {blockedReason ? <p className="mb-2 text-xs text-amber-800">{blockedReason}</p> : null}
        {!canChat ? (
          <p className="mb-2 text-xs text-[var(--acton-muted)]">
            Chatting with Dexter needs “Chat directly” access. Ask an administrator.
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor={`dexter-input-${variant}`}>
            Message Dexter
          </label>
          <textarea
            id={`dexter-input-${variant}`}
            ref={inputRef}
            rows={variant === "inline" ? 3 : 2}
            value={draft}
            disabled={!canChat}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder={
              reportId
                ? "Ask about or change this report…"
                : "e.g. Show active projects by phase and project manager"
            }
            className="block min-h-10 flex-1 resize-none rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm text-[var(--acton-navy)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
          />
          <Button
            type="submit"
            aria-label="Send"
            disabled={!draft.trim() || Boolean(pending) || Boolean(blockedReason) || !canChat}
          >
            <Send className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </form>
    </section>
  );
  return panel;
}
