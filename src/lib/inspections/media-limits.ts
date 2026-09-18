/**
 * Media upload caps and naming helpers for the background upload pipeline.
 */

/** Soft warn before video capture — not a hard reject after. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
export const VIDEO_MAX_DURATION_SECONDS = 120; // 2 minutes
export const VIDEO_WARN_MESSAGE =
  "Keep videos under 2 minutes and about 100 MB. Longer clips often fail on job-site cell signal.";

/** Concurrent background uploads — more saturates weak LTE. */
export const MEDIA_UPLOAD_CONCURRENCY = 2;

/** Zip export: above this, offer photos-only instead of failing mid-stream. */
export const ZIP_FULL_EXPORT_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

export function sanitizeFilenamePart(value: string): string {
  return (
    value
      .trim()
      .replace(/[^\w\s.-]+/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 60) || "item"
  );
}

export function buildMediaExportFilename(input: {
  sectionTitle: string | null;
  itemTitle: string;
  index: number;
  mediaType: "photo" | "video";
  ext: string;
}): string {
  const section = sanitizeFilenamePart(input.sectionTitle ?? "standalone");
  const item = sanitizeFilenamePart(input.itemTitle);
  const n = String(input.index + 1).padStart(2, "0");
  const kind = input.mediaType === "video" ? "video" : "photo";
  return `${section}__${item}__${kind}_${n}.${input.ext}`;
}
