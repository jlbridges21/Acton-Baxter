"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/pem-neat/copy-button";
import { SectionHeading } from "@/components/pem-neat/section-heading";
import { cn } from "@/lib/utils";

const LONG_TRANSCRIPT_THRESHOLD = 2000;

export function NeatSourcePanel({ transcript }: { transcript: string }) {
  const isLong = transcript.length > LONG_TRANSCRIPT_THRESHOLD;
  const [open, setOpen] = useState(!isLong);

  const preview = useMemo(() => {
    if (!isLong || open) return null;
    return `${transcript.slice(0, 400)}…`;
  }, [isLong, open, transcript]);

  return (
    <Card className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeading>Source</SectionHeading>
        <CopyButton getText={() => transcript} label="Copy Transcript" copiedLabel="Copied" />
      </div>

      {isLong ? (
        <button
          type="button"
          className="text-sm font-medium text-[var(--acton-navy)] underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Collapse transcript" : "Show full transcript"}
        </button>
      ) : null}

      <div
        className={cn(
          "rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)]",
          !open && isLong && "max-h-24 overflow-hidden",
        )}
      >
        <pre className="max-h-[32rem] overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--acton-navy)]">
          {open ? transcript : (preview ?? transcript)}
        </pre>
      </div>
      <p className="text-xs text-[var(--acton-muted)]">
        Stored exactly as entered — source of truth for regeneration.
      </p>
    </Card>
  );
}
