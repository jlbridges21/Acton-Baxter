"use client";

import { BaxterSourceList } from "./baxter-source-list";
import { BaxterAvatar } from "./baxter-avatar";
import type { BaxterAnswerMode, BaxterSourceReference } from "@/lib/baxter-ai/types";
import { answerModeLabel } from "@/lib/baxter-ai/classify";
import { cn } from "@/lib/utils";

export type ChatUiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: BaxterSourceReference[];
  insufficientKnowledge?: boolean;
  answerMode?: BaxterAnswerMode | null;
  isError?: boolean;
};

export function BaxterChatMessage({ message }: { message: ChatUiMessage }) {
  const isUser = message.role === "user";
  const modeLabel = !isUser ? answerModeLabel(message.answerMode) : null;

  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? <BaxterAvatar size={28} className="mt-0.5 shrink-0" /> : null}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
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
      </div>
    </div>
  );
}
