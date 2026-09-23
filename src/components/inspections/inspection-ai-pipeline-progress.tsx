"use client";

/**
 * Server-sourced AI pipeline progress (transcribe + summarize as one bar).
 * Always dismissible (×). Dismissal is stored in localStorage per inspection + processing run.
 * Error / finished-with-errors never auto-hide — only explicit dismiss clears them.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { AsyncRunProgress } from "@/components/ui/async-run-progress";
import { computeAiPipelineProgress } from "@/lib/inspections/ai/pipeline-progress";
import type { SiteInspectionSummary } from "@/lib/inspections/record-types";
import { cn } from "@/lib/utils";

/**
 * Scope dismiss to one inspection's processing run (startedAt).
 * A later re-run with a new startedAt shows the panel again; other inspections are unaffected.
 */
export function aiProgressDismissStorageKey(
  inspectionId: string,
  startedAt: string | null | undefined,
): string {
  return `baxter.inspection.aiProgress.dismissed.${inspectionId}.${startedAt ?? "none"}`;
}

function readDismissed(
  inspectionId: string | undefined,
  startedAt: string | null | undefined,
): boolean {
  if (!inspectionId || typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(aiProgressDismissStorageKey(inspectionId, startedAt)) === "1"
    );
  } catch {
    return false;
  }
}

export function InspectionAiPipelineProgress({
  inspection,
  inspectionId,
  className,
  compact = false,
}: {
  inspection: Pick<
    SiteInspectionSummary,
    | "aiProcessingStatus"
    | "aiProcessingPhase"
    | "aiProcessingMessage"
    | "aiProcessingVideosTotal"
    | "aiProcessingVideosDone"
    | "aiProcessingSummariesTotal"
    | "aiProcessingSummariesDone"
    | "aiProcessingStartedAt"
    | "aiProcessingFinishedAt"
  >;
  /** Required for dismiss persistence. */
  inspectionId?: string;
  className?: string;
  compact?: boolean;
}) {
  const status = inspection.aiProcessingStatus;
  const view = computeAiPipelineProgress(inspection);
  const startedAt = inspection.aiProcessingStartedAt;

  // Parent remounts with a key when startedAt/status changes so storage is re-read.
  const [dismissed, setDismissed] = useState(() => readDismissed(inspectionId, startedAt));

  if (status === "idle") return null;
  if (view.runStatus === "idle") return null;
  if (dismissed) return null;

  const runStatus =
    view.runStatus === "running" ? "running" : view.runStatus === "failed" ? "failed" : "complete";

  function dismiss() {
    setDismissed(true);
    if (!inspectionId) return;
    try {
      window.localStorage.setItem(aiProgressDismissStorageKey(inspectionId, startedAt), "1");
    } catch {
      /* ignore quota / private mode */
    }
  }

  return (
    <AsyncRunProgress
      className={cn(compact && "border-0 bg-transparent p-0 shadow-none", className)}
      title={compact ? "AI processing" : "Transcription & summaries"}
      description={
        compact
          ? undefined
          : "Videos are transcribed, then checklist items with video get an AI summary."
      }
      steps={[]}
      compact
      runStatus={runStatus}
      progressPercent={view.percent}
      progressPhaseLabel={view.phaseLabel}
      headerAside={
        <button
          type="button"
          className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)]"
          aria-label="Dismiss status"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dismiss();
          }}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      }
      friendlyError={
        view.runStatus === "failed"
          ? (inspection.aiProcessingMessage ?? "AI processing failed")
          : view.finishedWithErrors
            ? inspection.aiProcessingMessage
            : null
      }
    />
  );
}
