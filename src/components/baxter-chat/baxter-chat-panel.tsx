"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { BaxterAvatar } from "./baxter-avatar";
import { BaxterChatInput } from "./baxter-chat-input";
import { BaxterChatMessage, type ChatUiMessage } from "./baxter-chat-message";
import { Button } from "@/components/ui/button";
import type { BaxterAnswerMode, BaxterSourceReference } from "@/lib/baxter-ai/types";

const GREETING: ChatUiMessage = {
  id: "greeting",
  role: "assistant",
  answerMode: "identity",
  content:
    "Hi, I’m Baxter, Acton ADU’s internal AI assistant. I can answer questions, explain information, help with writing, and search approved Acton knowledge. What can I help with?",
};

const SUGGESTIONS = [
  "What can you do?",
  "Who is Baxter?",
  "Explain a RACI matrix.",
  "What approved Acton knowledge can you access?",
];

export function BaxterChatPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatUiMessage[]>([GREETING]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pending]);

  async function sendQuestion(question: string) {
    if (pending || inFlightRef.current) return;
    const trimmed = question.trim();
    if (!trimmed) return;

    // Local /clear without waiting on network when possible — still call API for audit
    const isClear = trimmed === "/clear";

    inFlightRef.current = true;
    setShowSuggestions(false);
    const clientRequestId = crypto.randomUUID();
    const userMessage: ChatUiMessage = {
      id: `user-${clientRequestId}`,
      role: "user",
      content: trimmed,
    };
    startTransition(() => {
      setMessages((prev) => [...prev, userMessage]);
    });
    setPending(true);

    try {
      const response = await fetch("/api/baxter/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          conversationId: isClear ? conversationId : conversationId,
          clientRequestId,
        }),
      });
      const payload = (await response.json()) as {
        conversationId?: string;
        message?: {
          id?: string;
          answer?: string;
          confidence?: string;
          insufficientKnowledge?: boolean;
          sources?: BaxterSourceReference[];
          answerMode?: BaxterAnswerMode | null;
          errorCode?: string | null;
        };
        error?: { message?: string; code?: string };
      };

      if (!response.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${crypto.randomUUID()}`,
            role: "assistant",
            content:
              payload.error?.message ?? "Baxter couldn’t answer that right now. Please try again.",
            isError: true,
            conversationId: conversationId,
          },
        ]);
        return;
      }

      if (isClear) {
        setConversationId(payload.conversationId ?? null);
        setShowSuggestions(true);
        setMessages([
          GREETING,
          {
            id: payload.message?.id ?? `clear-${crypto.randomUUID()}`,
            role: "assistant",
            content: payload.message?.answer ?? "Conversation cleared.",
            answerMode: "identity",
            conversationId: payload.conversationId ?? null,
          },
        ]);
        return;
      }

      if (payload.conversationId) {
        setConversationId(payload.conversationId);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: payload.message?.id ?? `assistant-${crypto.randomUUID()}`,
          role: "assistant",
          content: payload.message?.answer ?? "Baxter couldn’t answer that right now.",
          sources: payload.message?.sources ?? [],
          insufficientKnowledge: Boolean(payload.message?.insufficientKnowledge),
          answerMode: payload.message?.answerMode ?? null,
          conversationId: payload.conversationId ?? conversationId,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${crypto.randomUUID()}`,
          role: "assistant",
          content: "Baxter couldn’t answer that right now. Please try again.",
          isError: true,
        },
      ]);
    } finally {
      setPending(false);
      inFlightRef.current = false;
    }
  }

  return (
    <div className="flex h-[min(32rem,calc(100dvh-5.5rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-[var(--acton-border)] bg-white shadow-xl sm:w-[24rem]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--acton-border)] bg-[var(--acton-navy)] px-3 py-2.5 text-white">
        <div className="flex min-w-0 items-center gap-2">
          <BaxterAvatar size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Baxter</p>
            <p className="truncate text-xs text-white/80">Acton ADU teammate</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 gap-1 bg-white/10 px-2 text-xs text-white hover:bg-white/20"
            onClick={() => void sendQuestion("/clear")}
            disabled={pending}
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New chat</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 w-8 shrink-0 bg-white/10 p-0 text-white hover:bg-white/20"
            onClick={onClose}
            aria-label="Close Baxter chat"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto bg-[var(--acton-gray-50)] p-3"
      >
        {messages.map((message) => (
          <BaxterChatMessage key={message.id} message={message} />
        ))}
        {showSuggestions && messages.length <= 1 ? (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={pending}
                onClick={() => void sendQuestion(suggestion)}
                className="rounded-full border border-[var(--acton-border)] bg-white px-3 py-1.5 text-left text-xs font-medium text-[var(--acton-navy)] hover:bg-[var(--acton-gray-100)]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        {pending ? (
          <p className="text-xs text-[var(--acton-muted)]" aria-live="polite">
            Baxter is thinking…
          </p>
        ) : null}
      </div>

      <p className="shrink-0 border-t border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-1.5 text-[10px] leading-snug text-[var(--acton-muted)]">
        Official Acton answers cite Sources. General help is labeled. Verify important decisions
        with your team. Type /clear to start fresh.
      </p>

      <div className="shrink-0">
        <BaxterChatInput disabled={pending} onSend={sendQuestion} />
      </div>
    </div>
  );
}
