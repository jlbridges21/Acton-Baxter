"use client";

/**
 * Read-only AI summary for a checklist item that has video.
 * Regenerate control is absent unless the summary is stale.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  SiteInspectionDetail,
  SiteInspectionItemSummary,
} from "@/lib/inspections/record-types";

export function InspectionAiSummaryBlock({
  inspectionId,
  summary,
  hasVideo,
  onUpdated,
}: {
  inspectionId: string;
  summary: SiteInspectionItemSummary | undefined;
  hasVideo: boolean;
  onUpdated: (inspection: SiteInspectionDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasVideo) return null;

  const showRegenerate = Boolean(summary?.isStale && summary.status === "complete");

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/summaries/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotItemId: summary!.snapshotItemId }),
      });
      const json = (await res.json()) as {
        inspection?: SiteInspectionDetail;
        error?: { message?: string };
      };
      if (!res.ok || !json.inspection) {
        throw new Error(json.error?.message ?? "Could not regenerate summary");
      }
      onUpdated(json.inspection);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not regenerate summary");
    } finally {
      setBusy(false);
    }
  }

  if (!summary && !hasVideo) return null;

  const status = summary?.status;
  const text = summary?.summaryText?.trim() ?? "";

  return (
    <div className="rounded-md border border-[var(--acton-navy)]/15 bg-[var(--acton-navy)]/[0.04] px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold tracking-wide text-[var(--acton-navy)] uppercase">
          AI summary
        </p>
        <span className="rounded border border-[var(--acton-border)] bg-white px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
          AI-generated · read-only
        </span>
        {status === "processing" || status === "pending" ? (
          <span className="text-[11px] text-[var(--acton-muted)]" aria-live="polite">
            Generating…
          </span>
        ) : null}
        {status === "failed" ? (
          <span className="text-[11px] text-red-700">Summary failed</span>
        ) : null}
      </div>

      {text ? (
        <p className="text-[15px] leading-relaxed text-[var(--acton-navy)]">{text}</p>
      ) : status === "failed" ? (
        <p className="text-sm text-red-700">{summary?.error ?? "Could not generate summary"}</p>
      ) : status === "processing" || status === "pending" ? (
        <p className="text-sm text-[var(--acton-muted)]">
          Summary will appear when transcription finishes.
        </p>
      ) : (
        <p className="text-sm text-[var(--acton-muted)]">
          No summary yet — completes after site inspection is marked complete.
        </p>
      )}

      {showRegenerate ? (
        <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <Button
            type="button"
            variant="secondary"
            className="min-h-10 w-full sm:w-auto"
            disabled={busy}
            onClick={() => void regenerate()}
          >
            {busy ? "Regenerating…" : "Regenerate summary"}
          </Button>
          {summary?.staleReason ? (
            <p className="text-[11px] text-[var(--acton-muted)]">{summary.staleReason}</p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-1.5 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
