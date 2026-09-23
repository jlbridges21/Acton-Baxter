import { describe, expect, it } from "vitest";
import { computeAiPipelineProgress } from "@/lib/inspections/ai/pipeline-progress";
import { aiProgressDismissStorageKey } from "@/components/inspections/inspection-ai-pipeline-progress";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("AI progress panel dismiss", () => {
  it("scopes dismiss keys per inspection and processing run", () => {
    const a = aiProgressDismissStorageKey("insp-a", "2026-01-01T00:00:00.000Z");
    const b = aiProgressDismissStorageKey("insp-b", "2026-01-01T00:00:00.000Z");
    const aRerun = aiProgressDismissStorageKey("insp-a", "2026-01-02T00:00:00.000Z");
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(aRerun);
    expect(a).toContain("insp-a");
  });

  it("keeps finished-with-errors distinct from clean complete (no auto-hide of errors)", () => {
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

  it("always exposes a tappable dismiss control; never auto-hides clean complete", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-ai-pipeline-progress.tsx"),
      "utf8",
    );
    expect(source).toContain('aria-label="Dismiss status"');
    expect(source).toContain("h-11 w-11");
    expect(source).toContain("localStorage.setItem");
    expect(source).toContain("aiProgressDismissStorageKey");
    expect(source).not.toContain("Clean success: hide everywhere");
    // × is not gated to error-only states
    expect(source).not.toContain("dismissible ? (");
  });
});
