"use client";

/**
 * Server-sourced AI pipeline progress (transcribe + summarize as one bar).
 */

import { AsyncRunProgress } from "@/components/ui/async-run-progress";
import { computeAiPipelineProgress } from "@/lib/inspections/ai/pipeline-progress";
import type { SiteInspectionSummary } from "@/lib/inspections/record-types";
import { cn } from "@/lib/utils";

export function InspectionAiPipelineProgress({
  inspection,
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
  >;
  className?: string;
  compact?: boolean;
}) {
  const status = inspection.aiProcessingStatus;
  if (status === "idle") return null;

  const view = computeAiPipelineProgress(inspection);
  if (view.runStatus === "idle") return null;

  // Hide quiet "complete" on cards after success with no errors — keep finished-with-errors visible.
  if (compact && view.runStatus === "complete" && !view.finishedWithErrors) {
    return null;
  }

  const runStatus =
    view.runStatus === "running" ? "running" : view.runStatus === "failed" ? "failed" : "complete";

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
