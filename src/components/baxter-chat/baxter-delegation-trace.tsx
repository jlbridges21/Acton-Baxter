"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import type { BaxterDelegationSummary } from "@/lib/baxter-ai/types";

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Working",
  awaiting_approval: "Done — draft awaiting review",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * One-line trace of a Baxter → specialist hand-off. Details stay high level; the full
 * task record is behind its own permission check.
 */
export function BaxterDelegationTrace({ delegation }: { delegation: BaxterDelegationSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 rounded-lg border border-[var(--acton-border)] bg-[var(--acton-gray-50)] text-xs whitespace-normal text-[var(--acton-navy)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex-1">
          Baxter assigned this to <b>{delegation.agentName}</b> ({delegation.agentTitle})
          <span className="text-[var(--acton-muted)]">
            {" "}
            · {STATUS_LABELS[delegation.status] ?? delegation.status}
          </span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="space-y-1 border-t border-[var(--acton-border)] px-2.5 py-2">
          <p>
            <span className="text-[var(--acton-muted)]">Why: </span>
            {delegation.explanation}
          </p>
          {delegation.outcome ? (
            <p>
              <span className="text-[var(--acton-muted)]">Outcome: </span>
              {delegation.outcome.replace(/_/g, " ")}
            </p>
          ) : null}
          {delegation.pendingApprovals ? (
            <p>{delegation.pendingApprovals} item(s) waiting for human review.</p>
          ) : null}
          <Link href={`/ai/tasks/${delegation.taskId}`} className="font-semibold underline">
            View task record
          </Link>
        </div>
      ) : null}
    </div>
  );
}
