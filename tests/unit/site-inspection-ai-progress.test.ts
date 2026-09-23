import { describe, expect, it } from "vitest";
import { computeAiPipelineProgress } from "@/lib/inspections/ai/pipeline-progress";

describe("computeAiPipelineProgress", () => {
  it("weights transcription and summarization as one pipeline", () => {
    const mid = computeAiPipelineProgress({
      aiProcessingStatus: "processing",
      aiProcessingPhase: "transcribing",
      aiProcessingMessage: "Transcribing videos",
      aiProcessingVideosTotal: 4,
      aiProcessingVideosDone: 4,
      aiProcessingSummariesTotal: 4,
      aiProcessingSummariesDone: 0,
    });
    expect(mid.percent).toBe(50);
    expect(mid.phaseLabel).toBe("Transcribing videos");

    const summarizing = computeAiPipelineProgress({
      aiProcessingStatus: "processing",
      aiProcessingPhase: "summarizing",
      aiProcessingMessage: "Generating summaries",
      aiProcessingVideosTotal: 4,
      aiProcessingVideosDone: 4,
      aiProcessingSummariesTotal: 4,
      aiProcessingSummariesDone: 2,
    });
    expect(summarizing.percent).toBe(75);
    expect(summarizing.phaseLabel).toBe("Generating summaries");
  });

  it("reports finished-with-errors terminal state", () => {
    const view = computeAiPipelineProgress({
      aiProcessingStatus: "complete",
      aiProcessingPhase: "complete",
      aiProcessingMessage: "Finished with errors — 1 failed transcription",
      aiProcessingVideosTotal: 2,
      aiProcessingVideosDone: 2,
      aiProcessingSummariesTotal: 2,
      aiProcessingSummariesDone: 2,
    });
    expect(view.runStatus).toBe("complete");
    expect(view.finishedWithErrors).toBe(true);
    expect(view.percent).toBe(100);
  });
});
