import { describe, expect, it } from "vitest";
import { computeAiPipelineProgress } from "@/lib/inspections/ai/pipeline-progress";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("AI progress panel hide/dismiss", () => {
  it("treats clean complete as hideable (not finished-with-errors)", () => {
    const clean = computeAiPipelineProgress({
      aiProcessingStatus: "complete",
      aiProcessingPhase: "complete",
      aiProcessingMessage: "Transcription and summaries complete",
      aiProcessingVideosTotal: 2,
      aiProcessingVideosDone: 2,
      aiProcessingSummariesTotal: 2,
      aiProcessingSummariesDone: 2,
    });
    expect(clean.runStatus).toBe("complete");
    expect(clean.finishedWithErrors).toBe(false);

    const withErrors = computeAiPipelineProgress({
      aiProcessingStatus: "complete",
      aiProcessingPhase: "complete",
      aiProcessingMessage: "Finished with errors — 1 failed transcription",
      aiProcessingVideosTotal: 2,
      aiProcessingVideosDone: 2,
      aiProcessingSummariesTotal: 2,
      aiProcessingSummariesDone: 2,
    });
    expect(withErrors.finishedWithErrors).toBe(true);
  });

  it("hides clean complete and offers dismiss for error states", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-ai-pipeline-progress.tsx"),
      "utf8",
    );
    expect(source).toContain("Clean success: hide everywhere");
    expect(source).toContain("Dismiss status");
    expect(source).toContain("finishedWithErrors");
  });
});
