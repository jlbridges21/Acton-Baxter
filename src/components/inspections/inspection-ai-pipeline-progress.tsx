"use client";

/**
 * Server-sourced AI pipeline progress (transcribe + summarize as one bar).
 * Auto-hides on clean completion; finished-with-errors / failed stay until dismissed.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { AsyncRunProgress } from "@/components/ui/async-run-progress";
import { computeAiPipelineProgress } from "@/lib/inspections/ai/pipeline-progress";
import type { SiteInspectionSummary } from "@/lib/inspections/record-types";
import { cn } from "@/lib/utils";

function dismissStorageKey(inspectionId: string, finishedAt: string | null | undefined): string {
  return `baxter.inspection.aiProgress.dismissed.${inspectionId}.${finishedAt ?? "none"}`;
}

function readDismissed(inspectionId: string | undefined, finishedAt: string | null | undefined) {
  if (!inspectionId || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(dismissStorageKey(inspectionId, finishedAt)) === "1";
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
    | "aiProcessingFinishedAt"
  >;
  /** Required for dismiss persistence on the detail view. */
  inspectionId?: string;
  className?: string;
  compact?: boolean;
}) {
  const status = inspection.aiProcessingStatus;
  const view = computeAiPipelineProgress(inspection);
  const dismissible =
    view.runStatus === "failed" || (view.runStatus === "complete" && view.finishedWithErrors);

  // Parent should remount with a key when finishedAt changes so this re-reads storage.
  const [dismissed, setDismissed] = useState(() =>
    dismissible ? readDismissed(inspectionId, inspection.aiProcessingFinishedAt) : false,
  );

  if (status === "idle") return null;
  if (view.runStatus === "idle") return null;

  // Clean success: hide everywhere — summaries themselves convey completion.
  if (view.runStatus === "complete" && !view.finishedWithErrors) {
    return null;
  }

  if (dismissed) return null;

  const runStatus =
    view.runStatus === "running" ? "running" : view.runStatus === "failed" ? "failed" : "complete";

  function dismiss() {
    setDismissed(true);
    if (!inspectionId) return;
    try {
      window.localStorage.setItem(
        dismissStorageKey(inspectionId, inspection.aiProcessingFinishedAt),
        "1",
      );
    } catch {
      /* ignore */
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
        dismissible ? (
          <button
            type="button"
            className="ml-auto rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)]"
            aria-label="Dismiss status"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dismiss();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null
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
