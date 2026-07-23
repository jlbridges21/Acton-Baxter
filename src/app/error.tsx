"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--acton-gray-50)] px-4 text-center">
      <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-[var(--acton-muted)]">
        An unexpected application error occurred. You can try again or return to the dashboard.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)]"
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
