/**
 * Site inspection AI job: extract audio → Whisper → per-item summaries.
 * Idempotent: completed transcripts / matching fingerprints are skipped.
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
} from "./store";
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
      ai_processing_finished_at: new Date().toISOString(),
    });
    return;
  }

  await patchInspectionAiProgress(inspectionId, {
    ai_processing_status: "processing",
    ai_processing_message: `Transcribing 0 of ${videos.length} videos`,
    ai_processing_videos_total: videos.length,
    ai_processing_videos_done: 0,
    ai_processing_started_at: inspection.aiProcessingStartedAt ?? new Date().toISOString(),
    ai_processing_finished_at: null,
  });

  // Mark pending for videos not yet done (idempotent re-run skips complete/no_speech).
  for (const video of videos) {
    const status = video.transcriptStatus;
    if (status === "complete" || status === "no_speech_detected") continue;
    if (status !== "processing" && status !== "pending") {
      await updateMediaTranscript(video.id, { transcript_status: "pending" });
    }
  }

  let done = videos.filter(
    (v) => v.transcriptStatus === "complete" || v.transcriptStatus === "no_speech_detected",
  ).length;

  for (const video of videos) {
    const fresh = (await getSiteInspection(inspectionId)).media.find((m) => m.id === video.id);
    const status = fresh?.transcriptStatus ?? video.transcriptStatus;
    if (status === "complete" || status === "no_speech_detected") {
      continue;
    }

    await updateMediaTranscript(video.id, { transcript_status: "processing" });
    await patchInspectionAiProgress(inspectionId, {
      ai_processing_message: `Transcribing ${done + 1} of ${videos.length} videos`,
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
      ai_processing_message: `Transcribed ${done} of ${videos.length} videos`,
      ai_processing_videos_done: done,
    });
  }

  // Summaries for items that have at least one video.
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
  let summariesDone = 0;
  for (const snapshotItemId of itemIds) {
    const itemVideos = videosByItem.get(snapshotItemId) ?? [];
    const item = items.find((i) => i.id === snapshotItemId);
    const response = afterTranscripts.responses.find((r) => r.snapshotItemId === snapshotItemId);
    const notes = response?.notes ?? "";
    const fingerprint = buildItemSummaryFingerprint({
      notes,
      videos: itemVideos.map((v) => ({
        mediaId: v.id,
        transcriptStatus: v.transcriptStatus,
        transcriptText: v.transcriptText,
      })),
    });

    const existing = await getItemSummary(inspectionId, snapshotItemId);
    if (
      existing?.status === "complete" &&
      existing.contentFingerprint === fingerprint &&
      existing.summaryText.trim()
    ) {
      summariesDone += 1;
      continue;
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

    await patchInspectionAiProgress(inspectionId, {
      ai_processing_message: `Summarizing item ${summariesDone + 1} of ${itemIds.length}`,
    });

    const result = await summarizeInspectionItem({
      itemTitle: item?.title ?? "Checklist item",
      guideNotes: item?.guideNotes ?? null,
      inspectorNotes: notes,
      transcripts: itemVideos.map((v) => ({
        mediaId: v.id,
        text: v.transcriptText ?? "",
        status: v.transcriptStatus ?? "pending",
      })),
    });

    if (result.kind === "complete") {
      await upsertItemSummary({
        inspectionId,
        snapshotItemId,
        summaryText: result.summary,
        contentFingerprint: fingerprint,
        sourceNotes: notes,
        sourceVideoIds: itemVideos.map((v) => v.id),
        status: "complete",
      });
    } else {
      await upsertItemSummary({
        inspectionId,
        snapshotItemId,
        summaryText: existing?.summaryText ?? "",
        contentFingerprint: fingerprint,
        sourceNotes: notes,
        sourceVideoIds: itemVideos.map((v) => v.id),
        status: "failed",
        error: result.message,
      });
    }
    summariesDone += 1;
  }

  const failedVideos = (await getSiteInspection(inspectionId)).media.filter(
    (m) => m.mediaType === "video" && m.transcriptStatus === "failed",
  ).length;

  await patchInspectionAiProgress(inspectionId, {
    ai_processing_status:
      failedVideos > 0 && failedVideos === videos.length ? "failed" : "complete",
    ai_processing_message:
      failedVideos > 0
        ? `Finished with ${failedVideos} failed transcription${failedVideos === 1 ? "" : "s"}`
        : "Transcription and summaries complete",
    ai_processing_videos_done: videos.length,
    ai_processing_finished_at: new Date().toISOString(),
  });
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

  // Ensure transcripts exist for any new videos.
  for (const video of itemVideos) {
    if (
      video.transcriptStatus === "complete" ||
      video.transcriptStatus === "no_speech_detected" ||
      video.transcriptStatus === "failed"
    ) {
      continue;
    }
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
  const fingerprint = buildItemSummaryFingerprint({
    notes,
    videos: videos.map((v) => ({
      mediaId: v.id,
      transcriptStatus: v.transcriptStatus,
      transcriptText: v.transcriptText,
    })),
  });

  await upsertItemSummary({
    inspectionId: input.inspectionId,
    snapshotItemId: input.snapshotItemId,
    summaryText: "",
    contentFingerprint: fingerprint,
    sourceNotes: notes,
    sourceVideoIds: videos.map((v) => v.id),
    status: "processing",
  });

  const result = await summarizeInspectionItem({
    itemTitle: item.title,
    guideNotes: item.guideNotes ?? null,
    inspectorNotes: notes,
    transcripts: videos.map((v) => ({
      mediaId: v.id,
      text: v.transcriptText ?? "",
      status: v.transcriptStatus ?? "pending",
    })),
  });

  if (result.kind !== "complete") {
    await upsertItemSummary({
      inspectionId: input.inspectionId,
      snapshotItemId: input.snapshotItemId,
      summaryText: "",
      contentFingerprint: fingerprint,
      sourceNotes: notes,
      sourceVideoIds: videos.map((v) => v.id),
      status: "failed",
      error: result.message,
    });
    throw new Error(result.message);
  }

  await upsertItemSummary({
    inspectionId: input.inspectionId,
    snapshotItemId: input.snapshotItemId,
    summaryText: result.summary,
    contentFingerprint: fingerprint,
    sourceNotes: notes,
    sourceVideoIds: videos.map((v) => v.id),
    status: "complete",
  });

  return { summaryText: result.summary, fingerprint };
}
