"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

export function BaxterMessageFeedback({
  messageId,
  conversationId,
}: {
  messageId: string;
  conversationId?: string | null;
}) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(next: "up" | "down") {
    if (busy || messageId.startsWith("error-") || messageId.startsWith("assistant-")) {
      // Unpersisted client-only ids cannot be rated.
      if (messageId.startsWith("error-") || messageId.startsWith("assistant-")) return;
    }
    // UUID check — only rate server message ids
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) return;

    setBusy(true);
    try {
      const response = await fetch("/api/baxter/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          conversationId: conversationId ?? undefined,
          rating: next,
        }),
      });
      if (response.ok) {
        setRating(next);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!/^[0-9a-f-]{36}$/i.test(messageId)) {
    return null;
  }

  return (
    <div className="mt-2 flex items-center gap-2 border-t border-[var(--acton-border)]/60 pt-2">
      <span className="text-[10px] text-[var(--acton-muted)]">Helpful?</span>
      <button
        type="button"
        disabled={busy}
        aria-label="Thumbs up"
        className={`rounded p-1 ${rating === "up" ? "text-emerald-700" : "text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"}`}
        onClick={() => void submit("up")}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label="Thumbs down"
        className={`rounded p-1 ${rating === "down" ? "text-red-700" : "text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"}`}
        onClick={() => void submit("down")}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
