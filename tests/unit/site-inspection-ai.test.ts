/**
 * Site inspection AI: fingerprint, no-speech, idempotency, export text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  buildItemSummaryFingerprint,
  describeSummaryStaleReason,
} from "@/lib/inspections/ai/fingerprint";
import { buildInspectionAiNotesText } from "@/lib/inspections/ai/export-text";
import { WHISPER_UPLOAD_MAX_BYTES } from "@/lib/inspections/ai/audio-extract";
import {
  resetSiteInspectionAiMemoryForTests,
  upsertItemSummary,
  updateMediaTranscript,
  listItemSummariesForInspection,
} from "@/lib/inspections/ai/store";
import { runSiteInspectionAiJob, regenerateItemSummary } from "@/lib/inspections/ai/run-job";
import {
  createSiteInspection,
  createTemplateFromSeed,
  DETACHED_ADU_SEED,
  completeSiteInspectionMedia,
  prepareSiteInspectionMedia,
  putMemoryMediaBytes,
  resetInspectionTemplateMemoryForTests,
  resetSiteInspectionMediaMemoryForTests,
  resetSiteInspectionMemoryForTests,
  setSiteInspectionProfileNameForTests,
  getSiteInspection,
  setSiteInspectionStatus,
  upsertSiteInspectionResponse,
} from "@/lib/inspections";
import type { ReportJob } from "@/lib/jobs/types";

vi.mock("@/lib/inspections/ai/audio-extract", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inspections/ai/audio-extract")>(
    "@/lib/inspections/ai/audio-extract",
  );
  return {
    ...actual,
    extractAudioFromVideo: vi.fn(async () => ({
      ok: true as const,
      bytes: Buffer.from("fake-audio"),
      mimeType: "audio/mpeg" as const,
      byteSize: 10,
    })),
  };
});

vi.mock("@/lib/inspections/ai/transcribe", () => ({
  transcribeAudioBuffer: vi.fn(async () => ({
    kind: "complete" as const,
    text: "Sewer lateral looks about eight feet deep.",
    segments: [{ start: 12.5, end: 16, text: "Sewer lateral looks about eight feet deep." }],
  })),
}));

vi.mock("@/lib/inspections/ai/summarize", () => ({
  summarizeInspectionItem: vi.fn(async () => ({
    kind: "complete" as const,
    summary: "Inspector noted the sewer lateral is about eight feet deep.",
  })),
}));

beforeEach(() => {
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  resetEnvCacheForTests();
  resetInspectionTemplateMemoryForTests();
  resetSiteInspectionMemoryForTests();
  resetSiteInspectionMediaMemoryForTests();
  resetSiteInspectionAiMemoryForTests();
  setSiteInspectionProfileNameForTests("user-1", "Field Tech");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeJob(inspectionId: string): ReportJob {
  return {
    id: "job-1",
    reportId: null,
    jobType: "site_inspection_ai",
    status: "running",
    attempts: 1,
    availableAt: new Date().toISOString(),
    lockedAt: new Date().toISOString(),
    completedAt: null,
    lastError: null,
    metadata: { inspectionId },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function inspectionWithReadyVideo() {
  const template = await createTemplateFromSeed(DETACHED_ADU_SEED, "user-1");
  const inspection = await createSiteInspection({
    projectName: "Liniger",
    address: "25 N Avalon",
    templateId: template.id,
    createdBy: "user-1",
  });
  const item = inspection.snapshot.standaloneItems[0]!;
  const clientMediaId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const prepared = await prepareSiteInspectionMedia({
    inspectionId: inspection.id,
    snapshotItemId: item.id,
    clientMediaId,
    mediaType: "video",
    mimeType: "video/mp4",
    byteSize: 1000,
    actorId: "user-1",
  });
  putMemoryMediaBytes({
    storagePath: prepared.upload.path,
    bytes: Buffer.alloc(1000, 1),
    mimeType: "video/mp4",
    uploadedBy: "user-1",
  });
  await completeSiteInspectionMedia({
    inspectionId: inspection.id,
    clientMediaId,
    snapshotItemId: item.id,
    mediaType: "video",
    mimeType: "video/mp4",
    storagePath: prepared.upload.path,
    byteSize: 1000,
    actorId: "user-1",
  });
  return { inspectionId: inspection.id, itemId: item.id };
}

describe("fingerprint + stale reason", () => {
  it("changes when notes or videos change", () => {
    const base = buildItemSummaryFingerprint({
      notes: "ok",
      videos: [{ mediaId: "a", transcriptStatus: "complete", transcriptText: "hello" }],
    });
    const notesChanged = buildItemSummaryFingerprint({
      notes: "changed",
      videos: [{ mediaId: "a", transcriptStatus: "complete", transcriptText: "hello" }],
    });
    const videoAdded = buildItemSummaryFingerprint({
      notes: "ok",
      videos: [
        { mediaId: "a", transcriptStatus: "complete", transcriptText: "hello" },
        { mediaId: "b", transcriptStatus: "complete", transcriptText: "world" },
      ],
    });
    expect(base).not.toEqual(notesChanged);
    expect(base).not.toEqual(videoAdded);
  });

  it("describeSummaryStaleReason names the change", () => {
    expect(
      describeSummaryStaleReason({
        previousNotes: "a",
        currentNotes: "b",
        previousVideoIds: ["1"],
        currentVideoIds: ["1"],
      }),
    ).toBe("notes changed since this summary");
    expect(
      describeSummaryStaleReason({
        previousNotes: "a",
        currentNotes: "a",
        previousVideoIds: ["1"],
        currentVideoIds: ["1", "2"],
      }),
    ).toBe("a video was added since this summary");
    expect(
      describeSummaryStaleReason({
        previousNotes: "a",
        currentNotes: "a",
        previousVideoIds: ["1", "2"],
        currentVideoIds: ["1"],
      }),
    ).toBe("a video was deleted since this summary");
  });
});

describe("site inspection AI job", () => {
  it("transcribes videos and summarizes only items with video; skips photo-only items", async () => {
    const { inspectionId, itemId } = await inspectionWithReadyVideo();
    await runSiteInspectionAiJob(fakeJob(inspectionId));

    const detail = await getSiteInspection(inspectionId);
    const video = detail.media.find((m) => m.mediaType === "video")!;
    expect(video.transcriptStatus).toBe("complete");
    expect(video.transcriptText).toMatch(/sewer/i);
    expect(video.transcriptSegments?.[0]?.start).toBe(12.5);

    const summary = detail.itemSummaries.find((s) => s.snapshotItemId === itemId);
    expect(summary?.status).toBe("complete");
    expect(summary?.summaryText).toMatch(/sewer/i);
    expect(summary?.isStale).toBe(false);

    // Photo-only items never get summaries
    const photoOnly = detail.snapshot.sections[0]?.items.find(
      (i) => i.id !== itemId && !detail.media.some((m) => m.snapshotItemId === i.id),
    );
    if (photoOnly) {
      expect(detail.itemSummaries.find((s) => s.snapshotItemId === photoOnly.id)).toBeUndefined();
    }

    expect(detail.aiProcessingStatus).toBe("complete");
  });

  it("resolves no-speech without treating it as a hard error", async () => {
    const { transcribeAudioBuffer } = await import("@/lib/inspections/ai/transcribe");
    vi.mocked(transcribeAudioBuffer).mockResolvedValueOnce({
      kind: "no_speech_detected",
      message: "No speech detected in the audio",
    });

    const { inspectionId } = await inspectionWithReadyVideo();
    await runSiteInspectionAiJob(fakeJob(inspectionId));
    const detail = await getSiteInspection(inspectionId);
    const video = detail.media.find((m) => m.mediaType === "video")!;
    expect(video.transcriptStatus).toBe("no_speech_detected");
    expect(detail.aiProcessingStatus).toBe("complete");
  });

  it("does not duplicate transcripts/summaries on re-run", async () => {
    const { inspectionId, itemId } = await inspectionWithReadyVideo();
    await runSiteInspectionAiJob(fakeJob(inspectionId));
    await runSiteInspectionAiJob(fakeJob(inspectionId));

    const summaries = await listItemSummariesForInspection(inspectionId);
    expect(summaries.filter((s) => s.snapshotItemId === itemId)).toHaveLength(1);

    const { summarizeInspectionItem } = await import("@/lib/inspections/ai/summarize");
    // First run summarizes; second run should skip (matching fingerprint)
    expect(vi.mocked(summarizeInspectionItem).mock.calls.length).toBe(1);
  });

  it("marks summary stale after notes change and regenerate clears it", async () => {
    const { inspectionId, itemId } = await inspectionWithReadyVideo();
    await runSiteInspectionAiJob(fakeJob(inspectionId));

    await upsertSiteInspectionResponse({
      inspectionId,
      snapshotItemId: itemId,
      notes: "Added a note about panel clearance",
      actorId: "user-1",
    });

    let detail = await getSiteInspection(inspectionId);
    const stale = detail.itemSummaries.find((s) => s.snapshotItemId === itemId);
    expect(stale?.isStale).toBe(true);
    expect(stale?.staleReason).toMatch(/notes changed/i);

    await regenerateItemSummary({ inspectionId, snapshotItemId: itemId });
    detail = await getSiteInspection(inspectionId);
    const fresh = detail.itemSummaries.find((s) => s.snapshotItemId === itemId);
    expect(fresh?.isStale).toBe(false);
    expect(fresh?.sourceNotes).toMatch(/panel clearance/i);
  });

  it("complete with video enqueues AI; complete without video leaves idle", async () => {
    const template = await createTemplateFromSeed(DETACHED_ADU_SEED, "user-1");
    const noVideo = await createSiteInspection({
      projectName: "No Video",
      address: "1 Main",
      templateId: template.id,
      createdBy: "user-1",
    });
    const done = await setSiteInspectionStatus({
      inspectionId: noVideo.id,
      status: "complete",
      actorId: "user-1",
    });
    expect(done.aiProcessingStatus).toBe("idle");

    const { inspectionId } = await inspectionWithReadyVideo();
    // In memory mode enqueue runs the job inline (mocked Whisper).
    const withVideo = await setSiteInspectionStatus({
      inspectionId,
      status: "complete",
      actorId: "user-1",
    });
    expect(["queued", "processing", "complete"]).toContain(withVideo.aiProcessingStatus);
    const after = await getSiteInspection(inspectionId);
    expect(after.media.some((m) => m.transcriptStatus === "complete")).toBe(true);
  });
});

describe("export AI notes text", () => {
  it("includes transcripts and summaries organized by section", async () => {
    const { inspectionId } = await inspectionWithReadyVideo();
    await runSiteInspectionAiJob(fakeJob(inspectionId));
    const detail = await getSiteInspection(inspectionId);
    const text = buildInspectionAiNotesText(detail);
    expect(text).toMatch(/AI summary/i);
    expect(text).toMatch(/sewer/i);
    expect(text).toMatch(/\[0:12\]/i);
  });
});

describe("whisper payload cap", () => {
  it("documents the 25MB upload limit constant", () => {
    expect(WHISPER_UPLOAD_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("store helpers", () => {
  it("upserts summary without duplicating rows", async () => {
    await upsertItemSummary({
      inspectionId: "insp",
      snapshotItemId: "item",
      summaryText: "one",
      contentFingerprint: "fp1",
      sourceNotes: "",
      sourceVideoIds: ["v1"],
      status: "complete",
    });
    await upsertItemSummary({
      inspectionId: "insp",
      snapshotItemId: "item",
      summaryText: "two",
      contentFingerprint: "fp2",
      sourceNotes: "n",
      sourceVideoIds: ["v1"],
      status: "complete",
    });
    const all = await listItemSummariesForInspection("insp");
    expect(all).toHaveLength(1);
    expect(all[0]!.summaryText).toBe("two");
  });

  it("stores transcript status including no_speech_detected", async () => {
    await updateMediaTranscript("media-1", {
      transcript_status: "no_speech_detected",
      transcript_error: "Video has no audio track",
    });
    const { readTranscriptFromMemory } = await import("@/lib/inspections/ai/store");
    expect(readTranscriptFromMemory("media-1")?.transcript_status).toBe("no_speech_detected");
  });
});
