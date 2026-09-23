/**
 * Build a plain-text export of transcripts + AI summaries for the media zip.
 */

import { sanitizeFilenamePart } from "../media-limits";
import { listSnapshotItems } from "../snapshot";
import type { SiteInspectionDetail } from "../record-types";

function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

/**
 * Filename matching established export convention:
 * `{section}__{item}__ai_notes.txt` or a single inspection-level file.
 */
export function buildAiNotesExportFilename(input: {
  sectionTitle: string | null;
  itemTitle: string;
}): string {
  const section = sanitizeFilenamePart(input.sectionTitle ?? "standalone");
  const item = sanitizeFilenamePart(input.itemTitle);
  return `${section}__${item}__ai_notes.txt`;
}

export function buildInspectionAiNotesText(inspection: SiteInspectionDetail): string {
  const lines: string[] = [
    `Site inspection AI notes — ${inspection.projectName}`,
    `Address: ${inspection.address}`,
    `Generated for BuilderTrend handoff`,
    "",
  ];

  let lastSectionHeader: string | null = null;
  const writeItem = (item: { id: string; title: string }, sectionTitle: string | null) => {
    const hasVideo = inspection.media.some(
      (m) => m.snapshotItemId === item.id && m.mediaType === "video" && m.uploadStatus === "ready",
    );
    if (!hasVideo) return;

    if (sectionTitle && sectionTitle !== lastSectionHeader) {
      lines.push(`## Section: ${sectionTitle}`);
      lines.push("");
      lastSectionHeader = sectionTitle;
    }
    lines.push(`### ${item.title}`);
    const summary = inspection.itemSummaries.find((s) => s.snapshotItemId === item.id);
    if (summary?.summaryText.trim()) {
      lines.push(`AI summary (${summary.status}):`);
      lines.push(summary.summaryText.trim());
    } else if (summary?.status === "failed") {
      lines.push(`AI summary failed: ${summary.error ?? "unknown error"}`);
    } else if (summary) {
      lines.push(`AI summary status: ${summary.status}`);
    } else {
      lines.push("AI summary: (none yet)");
    }
    lines.push("");

    const videos = inspection.media.filter(
      (m) => m.snapshotItemId === item.id && m.mediaType === "video" && m.uploadStatus === "ready",
    );
    videos.forEach((video, idx) => {
      lines.push(`Video ${idx + 1} transcript (${video.transcriptStatus ?? "unknown"}):`);
      if (video.transcriptStatus === "no_speech_detected") {
        lines.push("[No speech detected]");
      } else if (video.transcriptStatus === "failed") {
        lines.push(`[Transcription failed: ${video.transcriptError ?? "unknown"}]`);
      } else if (video.transcriptSegments?.length) {
        for (const seg of video.transcriptSegments) {
          lines.push(`[${formatSeconds(seg.start)}] ${seg.text}`);
        }
      } else if (video.transcriptText?.trim()) {
        lines.push(video.transcriptText.trim());
      } else {
        lines.push("(no transcript)");
      }
      lines.push("");
    });
  };

  for (const item of inspection.snapshot.standaloneItems) {
    writeItem(item, null);
  }

  for (const section of inspection.snapshot.sections) {
    for (const item of section.items) {
      writeItem(item, section.title);
    }
  }

  return lines.join("\n").trim() + "\n";
}

/** Per-item AI notes file for item/section-scoped exports. */
export function buildItemAiNotesText(
  inspection: SiteInspectionDetail,
  snapshotItemId: string,
): string | null {
  const item = listSnapshotItems(inspection.snapshot).find((i) => i.id === snapshotItemId);
  if (!item) return null;
  const videos = inspection.media.filter(
    (m) =>
      m.snapshotItemId === snapshotItemId && m.mediaType === "video" && m.uploadStatus === "ready",
  );
  if (!videos.length) return null;

  const section =
    inspection.snapshot.sections.find((s) => s.items.some((i) => i.id === snapshotItemId)) ?? null;
  const isStandalone = inspection.snapshot.standaloneItems.some((i) => i.id === snapshotItemId);
  const slim: SiteInspectionDetail = {
    ...inspection,
    snapshot: {
      ...inspection.snapshot,
      standaloneItems: isStandalone
        ? inspection.snapshot.standaloneItems.filter((i) => i.id === snapshotItemId)
        : [],
      sections: section
        ? [{ ...section, items: section.items.filter((i) => i.id === snapshotItemId) }]
        : [],
    },
    media: videos,
    itemSummaries: inspection.itemSummaries.filter((s) => s.snapshotItemId === snapshotItemId),
  };
  return buildInspectionAiNotesText(slim);
}
