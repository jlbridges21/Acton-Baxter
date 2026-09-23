/**
 * Content fingerprint for item AI summaries.
 * Drives regenerate-button visibility: button is absent when fingerprints match.
 */

import { createHash } from "node:crypto";
import type { TranscriptStatus } from "../record-types";

export type FingerprintVideoInput = {
  mediaId: string;
  transcriptStatus: TranscriptStatus | null | undefined;
  transcriptText: string | null | undefined;
};

/**
 * Stable SHA-256 of the inputs a summary was (or will be) generated from:
 * inspector notes + ordered video ids + their transcript outcomes/text.
 * Adding/removing a video or editing notes changes the hash.
 */
export function buildItemSummaryFingerprint(input: {
  notes: string;
  videos: FingerprintVideoInput[];
}): string {
  const videos = input.videos
    .slice()
    .sort((a, b) => a.mediaId.localeCompare(b.mediaId))
    .map((v) => ({
      id: v.mediaId,
      status: v.transcriptStatus ?? null,
      text: (v.transcriptText ?? "").trim(),
    }));
  const payload = JSON.stringify({
    notes: input.notes.trim(),
    videos,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function describeSummaryStaleReason(input: {
  previousNotes: string;
  currentNotes: string;
  previousVideoIds: string[];
  currentVideoIds: string[];
}): string {
  const notesChanged = input.previousNotes.trim() !== input.currentNotes.trim();
  const prev = new Set(input.previousVideoIds);
  const curr = new Set(input.currentVideoIds);
  const added = [...curr].some((id) => !prev.has(id));
  const removed = [...prev].some((id) => !curr.has(id));

  if (notesChanged && (added || removed)) return "notes and videos changed since this summary";
  if (notesChanged) return "notes changed since this summary";
  if (added && removed) return "videos changed since this summary";
  if (added) return "a video was added since this summary";
  if (removed) return "a video was deleted since this summary";
  return "content changed since this summary";
}
