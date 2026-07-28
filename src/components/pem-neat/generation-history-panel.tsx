"use client";

import { useMemo, useState } from "react";
import type { PemNeatGenerationRow } from "@/lib/pem-neat/types";

function formatWhen(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function shortHash(hash: string | null) {
  if (!hash) return "—";
  return `${hash.slice(0, 8)}…`;
}

export function GenerationHistoryPanel({
  generations,
  currentTranscriptHash,
}: {
  generations: PemNeatGenerationRow[];
  currentTranscriptHash: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ordered = useMemo(
    () => [...generations].sort((a, b) => b.generation_index - a.generation_index),
    [generations],
  );

  if (ordered.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--acton-border)] bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-[var(--acton-navy)]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Generation History
        <span className="text-[var(--acton-muted)]">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <ul className="space-y-3 border-t border-[var(--acton-border)] px-4 py-3 text-sm">
          {ordered.map((gen) => {
            const isCurrent =
              gen.status === "completed" &&
              gen.transcript_hash &&
              currentTranscriptHash &&
              gen.transcript_hash === currentTranscriptHash;
            return (
              <li key={gen.id} className="rounded-md bg-[var(--acton-gray-50)] px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-[var(--acton-navy)]">
                    Generation {gen.generation_index}
                    {isCurrent ? (
                      <span className="ml-2 text-xs font-semibold text-emerald-700">Current</span>
                    ) : null}
                  </p>
                  <p className="text-[var(--acton-muted)]">{formatWhen(gen.created_at)}</p>
                </div>
                <p className="mt-1 text-[var(--acton-muted)]">
                  {gen.status === "completed" ? "Completed" : "Failed"}
                  {gen.model_provider || gen.model_name
                    ? ` · ${[gen.model_provider, gen.model_name].filter(Boolean).join(" / ")}`
                    : ""}
                </p>
                <p className="mt-0.5 text-xs text-[var(--acton-muted)]">
                  Source transcript: {shortHash(gen.transcript_hash)}
                  {gen.status === "failed" && gen.error_code ? ` · ${gen.error_code}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
