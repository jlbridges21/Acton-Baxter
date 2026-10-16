"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useSurveyToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const show = useCallback((next: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    setMessage(next);
    timer.current = window.setTimeout(() => setMessage(null), 2200);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return { message, show };
}

export function SurveyToast({ message }: { message: string | null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-4"
    >
      {message ? (
        <div className="rounded-md bg-[var(--acton-navy)] px-4 py-2 text-sm font-medium text-white shadow-lg">
          {message}
        </div>
      ) : null}
    </div>
  );
}
