"use client";

/**
 * Read-only AI summary for a checklist item that has video.
 * Regenerate appears when stale; retry appears when failed — both with specific errors.
 */

import { useEffect, useState } from "react";
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

  // Poll while this item's summary is regenerating (server may finish after the POST returns).
  useEffect(() => {
    if (summary?.status !== "processing") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}`);
        const json = (await res.json()) as { inspection?: SiteInspectionDetail };
        if (!cancelled && json.inspection) onUpdated(json.inspection);
      } catch {
        /* ignore transient */
      }
    };
    const timer = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [inspectionId, onUpdated, summary?.status, summary?.snapshotItemId]);

  if (!hasVideo) return null;

  const showRegenerate = Boolean(summary?.isStale && summary.status === "complete");
  const showRetry = summary?.status === "failed";

  async function regenerate() {
    if (!summary) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/summaries/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotItemId: summary.snapshotItemId }),
      });
      const json = (await res.json()) as {
        inspection?: SiteInspectionDetail;
        error?: { message?: string };
      };
      if (!res.ok && !json.inspection) {
        throw new Error(json.error?.message ?? "Could not regenerate summary");
      }
      if (json.inspection) {
        onUpdated(json.inspection);
        const next = json.inspection.itemSummaries.find(
          (s) => s.snapshotItemId === summary.snapshotItemId,
        );
        if (next?.status === "failed") {
          setError(next.error ?? json.error?.message ?? "Summary regeneration failed");
        }
      }
      if (json.error?.message && !json.inspection) {
        setError(json.error.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not regenerate summary");
    } finally {
      setBusy(false);
    }
  }

  const status = summary?.status;
  const text = summary?.summaryText?.trim() ?? "";
  const failureReason = error || (status === "failed" ? summary?.error : null);

  return (
    <div className="rounded-md border border-[var(--acton-navy)]/15 bg-[var(--acton-navy)]/[0.04] px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold tracking-wide text-[var(--acton-navy)] uppercase">
          AI summary
        </p>
        <span className="rounded border border-[var(--acton-border)] bg-white px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
          AI-generated · read-only
        </span>
        {status === "processing" || status === "pending" || busy ? (
          <span className="text-[11px] text-[var(--acton-muted)]" aria-live="polite">
            {busy || status === "processing" ? "Regenerating…" : "Generating…"}
          </span>
        ) : null}
        {status === "failed" ? (
          <span className="text-[11px] text-red-700">Could not generate summary</span>
        ) : null}
      </div>

      {text ? (
        <p className="text-[15px] leading-relaxed text-[var(--acton-navy)]">{text}</p>
      ) : status === "failed" ? null : status === "processing" || status === "pending" || busy ? (
        <p className="text-sm text-[var(--acton-muted)]">Updating summary…</p>
      ) : (
        <p className="text-sm text-[var(--acton-muted)]">
          No summary yet — completes after site inspection is marked complete.
        </p>
      )}

      {failureReason ? (
        <p className="mt-1.5 text-sm text-red-700" role="alert">
          {failureReason}
        </p>
      ) : null}

      {showRegenerate || showRetry ? (
        <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <Button
            type="button"
            variant="secondary"
            className="min-h-10 w-full sm:w-auto"
            disabled={busy}
            onClick={() => void regenerate()}
          >
            {busy ? "Working…" : showRetry ? "Retry summary" : "Regenerate summary"}
          </Button>
          {showRegenerate && summary?.staleReason ? (
            <p className="text-[11px] text-[var(--acton-muted)]">{summary.staleReason}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
