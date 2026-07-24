"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BaxterChatInput({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (question: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");

  async function submit() {
    const question = value.trim();
    if (!question || disabled) return;
    setValue("");
    await onSend(question);
  }

  return (
    <div className="border-t border-[var(--acton-border)] bg-white p-3">
      <label htmlFor="baxter-chat-input" className="sr-only">
        Ask Baxter
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="baxter-chat-input"
          rows={2}
          value={value}
          disabled={disabled}
          placeholder="Ask about approved Acton procedures…"
          className="min-h-[64px] flex-1 resize-none rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm text-[var(--acton-navy)] outline-none focus:border-[var(--acton-navy)] disabled:opacity-60"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={disabled || !value.trim()}
          onClick={() => void submit()}
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-[var(--acton-muted)]">
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
}
