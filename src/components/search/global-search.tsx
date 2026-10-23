"use client";

/**
 * Header entry point for Global Search: the magnifying-glass button (far right of the header)
 * and the ⌘K / Ctrl+K shortcut. The shortcut needs the modifier, so plain typing — including
 * the letter K in any field — is never intercepted.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchModal } from "./search-modal";

function subscribeNoop() {
  return () => undefined;
}

/** Apple platforms show ⌘; others Ctrl. Server render assumes ⌘ (matches the spec tooltip). */
function useIsMac(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
      return /mac|iphone|ipad|ipod/i.test(platform) || platform === "";
    },
    () => true,
  );
}

export function isSearchShortcut(e: KeyboardEvent): boolean {
  return (
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey &&
    !e.isComposing &&
    (e.key === "k" || e.key === "K")
  );
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const isMac = useIsMac();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to the header button.
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      setOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const label = `Search Baxter — ${isMac ? "⌘K" : "Ctrl+K"}`;

  return (
    <>
      <span className="group relative inline-flex">
        <Button
          ref={buttonRef}
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Search Baxter"
          aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="global-search-button"
          onClick={() => setOpen(true)}
        >
          <Search className="h-4 w-4" />
        </Button>
        <span
          role="tooltip"
          className="pointer-events-none absolute top-full right-0 z-50 mt-1.5 hidden rounded-md bg-[var(--acton-navy)] px-2 py-1 text-xs whitespace-nowrap text-white shadow group-focus-within:block group-hover:block"
        >
          {label}
        </span>
      </span>
      {open ? <SearchModal onClose={close} isMac={isMac} /> : null}
    </>
  );
}
