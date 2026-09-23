/**
 * Single-pipeline progress for site-inspection AI (transcribe + summarize).
 */

import type { AiProcessingPhase, AiProcessingStatus } from "../record-types";

export type AiPipelineProgressInput = {
  aiProcessingStatus: AiProcessingStatus;
  aiProcessingPhase: AiProcessingPhase | null;
  aiProcessingMessage: string | null;
  aiProcessingVideosTotal: number;
  aiProcessingVideosDone: number;
  aiProcessingSummariesTotal: number;
  aiProcessingSummariesDone: number;
};

export type AiPipelineProgressView = {
  /** 0–100 proportional across transcription + summarization. */
  percent: number;
  phaseLabel: string;
  runStatus: "running" | "complete" | "failed" | "idle";
  /** True when complete but message mentions errors. */
  finishedWithErrors: boolean;
};

/**
 * Weight transcription and summarization equally when both exist.
 * If one side has zero work, the other owns the full bar.
 */
export function computeAiPipelineProgress(input: AiPipelineProgressInput): AiPipelineProgressView {
  const videoTotal = Math.max(0, input.aiProcessingVideosTotal);
  const videoDone = Math.min(videoTotal, Math.max(0, input.aiProcessingVideosDone));
  const summaryTotal = Math.max(0, input.aiProcessingSummariesTotal);
  const summaryDone = Math.min(summaryTotal, Math.max(0, input.aiProcessingSummariesDone));

  const videoWeight = videoTotal > 0 ? 1 : 0;
  const summaryWeight = summaryTotal > 0 ? 1 : 0;
  const weightSum = videoWeight + summaryWeight;

  let percent = 0;
  if (weightSum === 0) {
    percent =
      input.aiProcessingStatus === "complete" || input.aiProcessingStatus === "failed" ? 100 : 0;
  } else {
    const videoFrac = videoTotal > 0 ? videoDone / videoTotal : 1;
    const summaryFrac = summaryTotal > 0 ? summaryDone / summaryTotal : 1;
    percent = Math.round(
      ((videoWeight * videoFrac + summaryWeight * summaryFrac) / weightSum) * 100,
    );
  }

  const phase = input.aiProcessingPhase;
  let phaseLabel = "Preparing…";
  if (input.aiProcessingStatus === "queued") {
    phaseLabel = "Queued…";
  } else if (phase === "transcribing" || (!phase && input.aiProcessingStatus === "processing")) {
    phaseLabel = "Transcribing videos";
  } else if (phase === "summarizing") {
    phaseLabel = "Generating summaries";
  } else if (input.aiProcessingStatus === "complete") {
    phaseLabel = input.aiProcessingMessage?.includes("error")
      ? (input.aiProcessingMessage ?? "Finished with errors")
      : (input.aiProcessingMessage ?? "Complete");
  } else if (input.aiProcessingStatus === "failed") {
    phaseLabel = input.aiProcessingMessage ?? "AI processing failed";
  }

  const finishedWithErrors =
    input.aiProcessingStatus === "complete" &&
    Boolean(input.aiProcessingMessage?.toLowerCase().includes("error"));

  let runStatus: AiPipelineProgressView["runStatus"] = "idle";
  if (input.aiProcessingStatus === "queued" || input.aiProcessingStatus === "processing") {
    runStatus = "running";
  } else if (input.aiProcessingStatus === "failed") {
    runStatus = "failed";
  } else if (input.aiProcessingStatus === "complete") {
    runStatus = "complete";
  }

  return { percent, phaseLabel, runStatus, finishedWithErrors };
}
