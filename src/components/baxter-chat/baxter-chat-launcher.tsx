"use client";

import { useEffect, useState } from "react";
import { ASK_BAXTER_EVENT, takeBaxterDraft } from "@/lib/search/client";
import { BaxterAvatar } from "./baxter-avatar";
import { BaxterChatPanel } from "./baxter-chat-panel";

export function BaxterChatLauncher() {
  const [open, setOpen] = useState(false);
  // A question handed over from Global Search ("Ask Baxter"), prefilled — never auto-sent.
  const [draft, setDraft] = useState<{ text: string; key: number } | null>(null);

  useEffect(() => {
    const pending = takeBaxterDraft();
    if (pending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate a hand-off from Global Search
      setDraft({ text: pending, key: Date.now() });
      setOpen(true);
    }
    const onAsk = () => {
      const text = takeBaxterDraft();
      if (!text) return;
      setDraft({ text, key: Date.now() });
      setOpen(true);
    };
    window.addEventListener(ASK_BAXTER_EVENT, onAsk);
    return () => window.removeEventListener(ASK_BAXTER_EVENT, onAsk);
  }, []);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open ? (
        <div className="pointer-events-auto">
          <BaxterChatPanel
            key={draft?.key ?? "chat"}
            initialDraft={draft?.text}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : null}

      {!open ? (
        <button
          type="button"
          className="group pointer-events-auto inline-flex items-center gap-2 rounded-full border border-[var(--acton-border)] bg-white py-2 pr-4 pl-2 shadow-lg transition hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)]"
          onClick={() => setOpen(true)}
          aria-label="Ask Baxter"
        >
          <BaxterAvatar size={44} />
          <span className="text-sm font-semibold text-[var(--acton-navy)]">Ask Baxter</span>
        </button>
      ) : null}
    </div>
  );
}
