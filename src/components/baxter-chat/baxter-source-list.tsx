"use client";

import type { BaxterSourceReference } from "@/lib/baxter-ai/types";

export function BaxterSourceList({ sources }: { sources: BaxterSourceReference[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-2">
      <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
        Sources
      </p>
      <ul className="mt-1 space-y-1">
        {sources.map((source) => (
          <li
            key={`${source.citationLabel}-${source.title}`}
            className="text-xs text-[var(--acton-navy)]"
          >
            {source.sourceUrl ? (
              <a
                href={source.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {source.citationLabel}
              </a>
            ) : (
              <span>{source.citationLabel}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
