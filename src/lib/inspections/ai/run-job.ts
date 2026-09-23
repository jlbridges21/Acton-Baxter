/**
 * Site inspection AI job: extract audio → Whisper → per-item summaries.
 * Idempotent: completed transcripts / matching fingerprints are skipped.
 * Summaries are strictly gated on every item video reaching a terminal transcript state.
 */

import "server-only";

import type { ReportJob } from "@/lib/jobs/types";
import { downloadSiteInspectionMediaBytes } from "../media-storage";
import { listSnapshotItems } from "../snapshot";
import { getSiteInspection } from "../records-store";
import { extractAudioFromVideo } from "./audio-extract";
import { transcribeAudioBuffer } from "./transcribe";
import { summarizeInspectionItem } from "./summarize";
import { buildItemSummaryFingerprint } from "./fingerprint";
import {
  patchInspectionAiProgress,
  updateMediaTranscript,
  upsertItemSummary,
  getItemSummary,
  listItemSummariesForInspection,
} from "./store";
import {
  allItemTranscriptsTerminal,
  effectiveTranscriptText,
  hasUsableSpeechTranscript,
  isPrematureEmptySummary,
  isTerminalTranscriptStatus,
} from "./transcript-gate";
import type { SiteInspectionMedia, TranscriptStatus } from "../record-types";

export async function runSiteInspectionAiJob(job: ReportJob): Promise<void> {
  const inspectionId =
    typeof job.metadata.inspectionId === "string" ? job.metadata.inspectionId : null;
  if (!inspectionId) {
    throw new Error("site_inspection_ai job requires metadata.inspectionId");
  }

  const inspection = await getSiteInspection(inspectionId);
  const videos = inspection.media.filter(
    (m) => m.mediaType === "video" && m.uploadStatus === "ready" && m.storagePath,
  );

  if (videos.length === 0) {
    await patchInspectionAiProgress(inspectionId, {
      ai_processing_status: "complete",
      ai_processing_message: "No videos to transcribe",
      ai_processing_videos_total: 0,
      ai_processing_videos_done: 0,
      ai_processing_summaries_total: 0,
      ai_processing_summaries_done: 0,
      ai_processing_phase: "complete",
      ai_processing_finished_at: new Date().toISOString(),
    });
    return;
  }

  // Preview how many checklist items will need summaries (one per item with video).
  const previewItemIds = new Set(videos.map((v) => v.snapshotItemId));

  await patchInspectionAiProgress(inspectionId, {
    ai_processing_status: "processing",
    ai_processing_message: "Transcribing videos",
    ai_processing_phase: "transcribing",
    ai_processing_videos_total: videos.length,
    ai_processing_videos_done: 0,
    ai_processing_summaries_total: previewItemIds.size,
    ai_processing_summaries_done: 0,
    ai_processing_started_at: inspection.aiProcessingStartedAt ?? new Date().toISOString(),
    ai_processing_finished_at: null,
  });

  for (const video of videos) {
    const status = video.transcriptStatus;
    if (isTerminalTranscriptStatus(status)) continue;
    if (status !== "processing" && status !== "pending") {
      await updateMediaTranscript(video.id, { transcript_status: "pending" });
    }
  }

  let done = videos.filter((v) => isTerminalTranscriptStatus(v.transcriptStatus)).length;

  for (const video of videos) {
    const fresh = (await getSiteInspection(inspectionId)).media.find((m) => m.id === video.id);
    const status = fresh?.transcriptStatus ?? video.transcriptStatus;
    if (isTerminalTranscriptStatus(status)) {
      continue;
    }

    await updateMediaTranscript(video.id, { transcript_status: "processing" });
    await patchInspectionAiProgress(inspectionId, {
      ai_processing_message: "Transcribing videos",
      ai_processing_phase: "transcribing",
      ai_processing_videos_done: done,
    });

    try {
      await transcribeOneVideo(fresh ?? video);
    } catch (error) {
      await updateMediaTranscript(video.id, {
        transcript_status: "failed",
        transcript_error: error instanceof Error ? error.message : String(error),
        transcript_text: null,
        transcript_segments: null,
      });
    }

    done += 1;
    await patchInspectionAiProgress(inspectionId, {
      ai_processing_message: "Transcribing videos",
      ai_processing_phase: "transcribing",
      ai_processing_videos_done: done,
    });
  }

  // Fresh read after all transcriptions — never summarize from a stale snapshot.
  const afterTranscripts = await getSiteInspection(inspectionId);
  const items = listSnapshotItems(afterTranscripts.snapshot);
  const videosByItem = new Map<string, SiteInspectionMedia[]>();
  for (const m of afterTranscripts.media) {
    if (m.mediaType !== "video" || m.uploadStatus !== "ready") continue;
    const list = videosByItem.get(m.snapshotItemId) ?? [];
    list.push(m);
    videosByItem.set(m.snapshotItemId, list);
  }

  const itemIds = [...videosByItem.keys()];
  await patchInspectionAiProgress(inspectionId, {
    ai_processing_message: "Generating summaries",
    ai_processing_phase: "summarizing",
    ai_processing_videos_done: videos.length,
    ai_processing_summaries_total: itemIds.length,
    ai_processing_summaries_done: 0,
  });

  let summariesDone = 0;
  let summaryFailures = 0;
  for (const snapshotItemId of itemIds) {
    const itemVideos = videosByItem.get(snapshotItemId) ?? [];
    const summarized = await summarizeOneItem({
      inspectionId,
      snapshotItemId,
      itemTitle: items.find((i) => i.id === snapshotItemId)?.title ?? "Checklist item",
      guideNotes: items.find((i) => i.id === snapshotItemId)?.guideNotes ?? null,
      notes:
        afterTranscripts.responses.find((r) => r.snapshotItemId === snapshotItemId)?.notes ?? "",
      itemVideos,
      force: false,
    });
    if (summarized === "failed") summaryFailures += 1;
    if (summarized !== "skipped_not_ready") summariesDone += 1;
    await patchInspectionAiProgress(inspectionId, {
      ai_processing_message: "Generating summaries",
      ai_processing_phase: "summarizing",
      ai_processing_summaries_done: summariesDone,
    });
  }

  // Repair any premature empty summaries left from earlier races.
  await repairPrematureEmptySummariesForInspection(inspectionId);

  const failedVideos = (await getSiteInspection(inspectionId)).media.filter(
    (m) => m.mediaType === "video" && m.transcriptStatus === "failed",
  ).length;

  const failureParts: string[] = [];
  if (failedVideos > 0) {
    failureParts.push(`${failedVideos} failed transcription${failedVideos === 1 ? "" : "s"}`);
  }
  if (summaryFailures > 0) {
    failureParts.push(`${summaryFailures} failed summar${summaryFailures === 1 ? "y" : "ies"}`);
  }

  const allFailed = failedVideos > 0 && failedVideos === videos.length;
  await patchInspectionAiProgress(inspectionId, {
    ai_processing_status: allFailed ? "failed" : "complete",
    ai_processing_phase: allFailed ? "failed" : "complete",
    ai_processing_message: allFailed
      ? `AI processing failed — ${failureParts.join("; ")}`
      : failureParts.length > 0
        ? `Finished with errors — ${failureParts.join("; ")}`
        : "Transcription and summaries complete",
    ai_processing_videos_done: videos.length,
    ai_processing_summaries_done: itemIds.length,
    ai_processing_finished_at: new Date().toISOString(),
  });
}

async function summarizeOneItem(input: {
  inspectionId: string;
  snapshotItemId: string;
  itemTitle: string;
  guideNotes: string | null;
  notes: string;
  itemVideos: SiteInspectionMedia[];
  force: boolean;
}): Promise<"complete" | "failed" | "skipped" | "skipped_not_ready"> {
  const { inspectionId, snapshotItemId, itemVideos, notes } = input;

  if (!allItemTranscriptsTerminal(itemVideos)) {
    // Strict gate — never invent an empty summary while transcripts are in flight.
    const existing = await getItemSummary(inspectionId, snapshotItemId);
    await upsertItemSummary({
      inspectionId,
      snapshotItemId,
      summaryText: existing?.summaryText ?? "",
      contentFingerprint: existing?.contentFingerprint ?? "",
      sourceNotes: notes,
      sourceVideoIds: itemVideos.map((v) => v.id),
      status: "pending",
      error: "Waiting for all video transcripts to finish",
    });
    return "skipped_not_ready";
  }

  const fingerprint = buildItemSummaryFingerprint({
    notes,
    videos: itemVideos.map((v) => ({
      mediaId: v.id,
      transcriptStatus: v.transcriptStatus,
      transcriptText: v.transcriptText,
      transcriptSegments: v.transcriptSegments,
    })),
  });

  const existing = await getItemSummary(inspectionId, snapshotItemId);
  const premature =
    existing &&
    isPrematureEmptySummary({
      summaryText: existing.summaryText,
      status: existing.status,
      videos: itemVideos,
    });

  if (
    !input.force &&
    !premature &&
    existing?.status === "complete" &&
    existing.contentFingerprint === fingerprint &&
    existing.summaryText.trim()
  ) {
    return "skipped";
  }

  await upsertItemSummary({
    inspectionId,
    snapshotItemId,
    summaryText: existing?.summaryText ?? "",
    contentFingerprint: fingerprint,
    sourceNotes: notes,
    sourceVideoIds: itemVideos.map((v) => v.id),
    status: "processing",
  });

  const result = await summarizeInspectionItem({
    itemTitle: input.itemTitle,
    guideNotes: input.guideNotes,
    inspectorNotes: notes,
    transcripts: itemVideos.map((v) => ({
      mediaId: v.id,
      text: effectiveTranscriptText(v),
      status: v.transcriptStatus ?? "pending",
    })),
  });

  let finalResult = result;
  if (
    result.kind === "complete" &&
    hasUsableSpeechTranscript(itemVideos) &&
    /no spoken content or notes were available/i.test(result.summary)
  ) {
    // One retry with explicit instruction — this was a common false empty summary.
    finalResult = await summarizeInspectionItem({
      itemTitle: input.itemTitle,
      guideNotes: input.guideNotes,
      inspectorNotes: notes,
      transcripts: itemVideos.map((v) => ({
        mediaId: v.id,
        text: effectiveTranscriptText(v),
        status: v.transcriptStatus ?? "pending",
      })),
      forceUseTranscripts: true,
    });
  }

  if (finalResult.kind === "complete") {
    if (
      hasUsableSpeechTranscript(itemVideos) &&
      /no spoken content or notes were available/i.test(finalResult.summary)
    ) {
      await upsertItemSummary({
        inspectionId,
        snapshotItemId,
        summaryText: existing?.summaryText ?? "",
        contentFingerprint: fingerprint,
        sourceNotes: notes,
        sourceVideoIds: itemVideos.map((v) => v.id),
        status: "failed",
        error:
          "AI returned an empty summary even though a transcript exists. Tap Regenerate to try again.",
      });
      return "failed";
    }
    await upsertItemSummary({
      inspectionId,
      snapshotItemId,
      summaryText: finalResult.summary,
      contentFingerprint: fingerprint,
      sourceNotes: notes,
      sourceVideoIds: itemVideos.map((v) => v.id),
      status: "complete",
    });
    return "complete";
  }

  await upsertItemSummary({
    inspectionId,
    snapshotItemId,
    summaryText: existing?.summaryText ?? "",
    contentFingerprint: fingerprint,
    sourceNotes: notes,
    sourceVideoIds: itemVideos.map((v) => v.id),
    status: "failed",
    error: finalResult.message,
  });
  return "failed";
}

async function transcribeOneVideo(video: SiteInspectionMedia): Promise<void> {
  if (!video.storagePath) {
    await updateMediaTranscript(video.id, {
      transcript_status: "failed",
      transcript_error: "Missing storage path",
    });
    return;
  }

  const downloaded = await downloadSiteInspectionMediaBytes(video.storagePath);
  if (!downloaded) {
    await updateMediaTranscript(video.id, {
      transcript_status: "failed",
      transcript_error: "Could not download video from storage",
    });
    return;
  }

  const audio = await extractAudioFromVideo(downloaded.bytes);
  if (!audio.ok) {
    const status: TranscriptStatus =
      audio.reason === "no_audio_track" ? "no_speech_detected" : "failed";
    await updateMediaTranscript(video.id, {
      transcript_status: status,
      transcript_error: audio.message,
      transcript_text: null,
      transcript_segments: null,
    });
    return;
  }

  const result = await transcribeAudioBuffer({
    bytes: audio.bytes,
    mimeType: audio.mimeType,
    filename: "audio.mp3",
  });

  if (result.kind === "complete") {
    await updateMediaTranscript(video.id, {
      transcript_status: "complete",
      transcript_text: result.text,
      transcript_segments: result.segments,
      transcript_error: null,
    });
    return;
  }
  if (result.kind === "no_speech_detected") {
    await updateMediaTranscript(video.id, {
      transcript_status: "no_speech_detected",
      transcript_text: null,
      transcript_segments: [],
      transcript_error: result.message,
    });
    return;
  }
  await updateMediaTranscript(video.id, {
    transcript_status: "failed",
    transcript_error: result.message,
    transcript_text: null,
    transcript_segments: null,
  });
}

/** Regenerate one item summary (notes/videos may have changed). */
export async function regenerateItemSummary(input: {
  inspectionId: string;
  snapshotItemId: string;
}): Promise<{ summaryText: string; fingerprint: string }> {
  const inspection = await getSiteInspection(input.inspectionId);
  const item = listSnapshotItems(inspection.snapshot).find((i) => i.id === input.snapshotItemId);
  if (!item) throw new Error("Checklist item not found");

  const itemVideos = inspection.media.filter(
    (m) =>
      m.snapshotItemId === input.snapshotItemId &&
      m.mediaType === "video" &&
      m.uploadStatus === "ready",
  );
  if (itemVideos.length === 0) {
    throw new Error("Summaries are only generated for items with video");
  }

  for (const video of itemVideos) {
    if (isTerminalTranscriptStatus(video.transcriptStatus)) continue;
    await updateMediaTranscript(video.id, { transcript_status: "processing" });
    try {
      await transcribeOneVideo(video);
    } catch (error) {
      await updateMediaTranscript(video.id, {
        transcript_status: "failed",
        transcript_error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const refreshed = await getSiteInspection(input.inspectionId);
  const videos = refreshed.media.filter(
    (m) =>
      m.snapshotItemId === input.snapshotItemId &&
      m.mediaType === "video" &&
      m.uploadStatus === "ready",
  );
  const notes =
    refreshed.responses.find((r) => r.snapshotItemId === input.snapshotItemId)?.notes ?? "";

  const outcome = await summarizeOneItem({
    inspectionId: input.inspectionId,
    snapshotItemId: input.snapshotItemId,
    itemTitle: item.title,
    guideNotes: item.guideNotes ?? null,
    notes,
    itemVideos: videos,
    force: true,
  });

  if (outcome === "skipped_not_ready") {
    throw new Error("Transcripts are still processing for this item");
  }
  if (outcome === "failed") {
    const failed = await getItemSummary(input.inspectionId, input.snapshotItemId);
    throw new Error(failed?.error ?? "Summary generation failed");
  }

  const saved = await getItemSummary(input.inspectionId, input.snapshotItemId);
  return {
    summaryText: saved?.summaryText ?? "",
    fingerprint: saved?.contentFingerprint ?? "",
  };
}

/**
 * Find and regenerate summaries that claim empty input while usable transcripts exist.
 * Returns how many were repaired.
 */
export async function repairPrematureEmptySummariesForInspection(
  inspectionId: string,
): Promise<number> {
  const inspection = await getSiteInspection(inspectionId);
  const summaries = await listItemSummariesForInspection(inspectionId);
  let repaired = 0;
  for (const summary of summaries) {
    const itemVideos = inspection.media.filter(
      (m) =>
        m.snapshotItemId === summary.snapshotItemId &&
        m.mediaType === "video" &&
        m.uploadStatus === "ready",
    );
    if (
      !isPrematureEmptySummary({
        summaryText: summary.summaryText,
        status: summary.status,
        videos: itemVideos,
      })
    ) {
      continue;
    }
    const item = listSnapshotItems(inspection.snapshot).find(
      (i) => i.id === summary.snapshotItemId,
    );
    const notes =
      inspection.responses.find((r) => r.snapshotItemId === summary.snapshotItemId)?.notes ?? "";
    const outcome = await summarizeOneItem({
      inspectionId,
      snapshotItemId: summary.snapshotItemId,
      itemTitle: item?.title ?? "Checklist item",
      guideNotes: item?.guideNotes ?? null,
      notes,
      itemVideos,
      force: true,
    });
    if (outcome === "complete") repaired += 1;
  }
  return repaired;
}

/** Scan all inspections in memory/DB for premature empty summaries and repair them. */
export async function repairAllPrematureEmptySummaries(): Promise<{
  inspected: number;
  repaired: number;
}> {
  const { createServiceClient } = await import("@/lib/supabase/admin");
  const { getEnv } = await import("@/lib/env");
  let useMemory = false;
  try {
    const env = getEnv();
    useMemory = Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    useMemory = true;
  }

  if (useMemory) {
    const summaries = await listItemSummariesForInspection(""); // won't work - need all
    void summaries;
    // Memory: walk known inspections via repairing each summary's inspection id.
    const allKeys = Array.from(
      (
        globalThis as typeof globalThis & {
          __baxterSiteInspectionAi?: { summaries: Map<string, { inspection_id: string }> };
        }
      ).__baxterSiteInspectionAi?.summaries.values() ?? [],
    );
    const inspectionIds = [...new Set(allKeys.map((r) => r.inspection_id))];
    let repaired = 0;
    for (const id of inspectionIds) {
      repaired += await repairPrematureEmptySummariesForInspection(id);
    }
    return { inspected: inspectionIds.length, repaired };
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("site_inspection_item_summaries")
    .select("inspection_id, summary_text, status")
    .eq("status", "complete");
  if (error) throw error;

  const candidates = (data ?? []).filter((row) =>
    /no spoken content or notes were available/i.test(String(row.summary_text ?? "")),
  );
  const inspectionIds = [...new Set(candidates.map((r) => r.inspection_id as string))];
  let repaired = 0;
  for (const id of inspectionIds) {
    repaired += await repairPrematureEmptySummariesForInspection(id);
  }
  return { inspected: inspectionIds.length, repaired };
}
