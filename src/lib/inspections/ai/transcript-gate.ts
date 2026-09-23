/**
 * Terminal-transcript gating and premature-empty summary detection.
 */

import type { SiteInspectionMedia, TranscriptSegment, TranscriptStatus } from "../record-types";

export const TERMINAL_TRANSCRIPT_STATUSES: ReadonlyArray<TranscriptStatus> = [
  "complete",
  "no_speech_detected",
  "failed",
];

export function isTerminalTranscriptStatus(
  status: TranscriptStatus | null | undefined,
): status is "complete" | "no_speech_detected" | "failed" {
  return status === "complete" || status === "no_speech_detected" || status === "failed";
}

/** Prefer flat text; fall back to joining timestamped segments. */
export function effectiveTranscriptText(input: {
  transcriptText?: string | null;
  transcriptSegments?: TranscriptSegment[] | null;
}): string {
  const direct = (input.transcriptText ?? "").trim();
  if (direct) return direct;
  return (input.transcriptSegments ?? [])
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function hasUsableSpeechTranscript(
  videos: Array<{
    transcriptStatus?: TranscriptStatus | null;
    transcriptText?: string | null;
    transcriptSegments?: TranscriptSegment[] | null;
  }>,
): boolean {
  return videos.some(
    (v) => v.transcriptStatus === "complete" && effectiveTranscriptText(v).length > 0,
  );
}

export function allItemTranscriptsTerminal(
  videos: Array<{ transcriptStatus?: TranscriptStatus | null }>,
): boolean {
  if (videos.length === 0) return false;
  return videos.every((v) => isTerminalTranscriptStatus(v.transcriptStatus));
}

/** LLM empty-input boilerplate (and close variants). */
export function looksLikeEmptyInputSummary(summaryText: string): boolean {
  const t = summaryText.trim().toLowerCase();
  if (!t) return false;
  return (
    /no spoken content or notes were available/.test(t) ||
    /no spoken content.*(?:and|or).*notes/.test(t) ||
    /no spoken content was available/.test(t)
  );
}

/**
 * Summary claims empty input while at least one video has usable speech.
 * These are stuck: fingerprints may match the *current* empty-text snapshot
 * that was wrong, or match after a race — either way regenerate is required.
 */
export function isPrematureEmptySummary(input: {
  summaryText: string;
  status: string;
  videos: SiteInspectionMedia[];
}): boolean {
  if (input.status !== "complete") return false;
  if (!looksLikeEmptyInputSummary(input.summaryText)) return false;
  return hasUsableSpeechTranscript(input.videos);
}
