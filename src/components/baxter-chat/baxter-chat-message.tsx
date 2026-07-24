"use client";

import { BaxterSourceList } from "./baxter-source-list";
import type { BaxterAnswerMode, BaxterSourceReference } from "@/lib/baxter-ai/types";
import { answerModeLabel } from "@/lib/baxter-ai/classify";
import { cn } from "@/lib/utils";
import { BaxterMessageFeedback } from "./baxter-message-feedback";

export type ChatUiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: BaxterSourceReference[];
  insufficientKnowledge?: boolean;
  answerMode?: BaxterAnswerMode | null;
  isError?: boolean;
  conversationId?: string | null;
};

export function BaxterChatMessage({ message }: { message: ChatUiMessage }) {
  const isUser = message.role === "user";
  const modeLabel = !isUser ? answerModeLabel(message.answerMode) : null;

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "w-full max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap",
          isUser
            ? "bg-[var(--acton-navy)] text-white"
            : message.isError
              ? "border border-red-200 bg-red-50 text-red-900"
              : message.insufficientKnowledge
                ? "border border-amber-200 bg-amber-50 text-[var(--acton-navy)]"
                : "border border-[var(--acton-border)] bg-white text-[var(--acton-navy)]",
        )}
      >
        {modeLabel ? (
          <p className="mb-1 text-[10px] font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
            {modeLabel}
          </p>
        ) : null}
        {message.content}
        {!isUser && message.sources && message.sources.length > 0 ? (
          <BaxterSourceList sources={message.sources} />
        ) : null}
        {!isUser && !message.isError && message.id !== "greeting" ? (
          <BaxterMessageFeedback
            messageId={message.id}
            conversationId={message.conversationId ?? null}
          />
        ) : null}
      </div>
    </div>
  );
}
