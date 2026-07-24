"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pending]);

  async function sendQuestion(question: string) {
    if (pending) return;
    setShowSuggestions(false);
    const userMessage: ChatUiMessage = {
      id: `user-${crypto.randomUUID()}`,
      role: "user",
      content: question,
    };
    setMessages((prev) => [...prev, userMessage]);
    setPending(true);

    try {
      const response = await fetch("/api/baxter/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          conversationId,
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
    }
  }

  return (
    <div className="flex h-[min(34rem,72vh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-[var(--acton-border)] bg-white shadow-xl sm:w-[24rem]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--acton-border)] bg-[var(--acton-navy)] px-3 py-2.5 text-white">
        <div className="flex min-w-0 items-center gap-2">
          <BaxterAvatar size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Baxter</p>
            <p className="truncate text-xs text-white/80">Acton ADU teammate</p>
          </div>
        </div>
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

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto bg-[var(--acton-gray-50)] p-3"
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

      <p className="border-t border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-2 text-[11px] leading-snug text-[var(--acton-muted)]">
        Baxter answers from approved Acton knowledge when available, and can also help with general
        questions. Verify important decisions with the responsible team member.
      </p>

      <BaxterChatInput disabled={pending} onSend={sendQuestion} />
    </div>
  );
}
