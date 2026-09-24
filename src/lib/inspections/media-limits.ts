/**
 * Media upload caps and naming helpers for the background upload pipeline.
 */

/**
 * Soft pre-capture warning only — not a hard reject.
 * Large videos are allowed; they just take longer on job-site cell signal.
 */
export const VIDEO_WARN_MESSAGE =
  "Large videos can take a while to upload on cell signal. Keep the app open until the upload finishes — it will resume if the signal drops.";

/**
 * Route Attach-file / capture results by the file itself (MIME, then extension).
 * Do not infer from which button was pressed — Attach file accepts both.
 */
export function inferInspectionMediaType(file: File): "photo" | "video" | null {
  const mime = (file.type || "").trim().toLowerCase();
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";

  const name = (file.name || "").trim().toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (
    ext &&
    ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff"].includes(ext)
  ) {
    return "photo";
  }
  if (ext && ["mp4", "mov", "m4v", "webm", "avi", "mkv", "3gp", "3gpp"].includes(ext)) {
    return "video";
  }
  return null;
}

/**
 * @deprecated Soft guidance only — no longer enforced as a hard upload cap.
 * Kept so older call sites / tests can read a number if needed.
 */
export const VIDEO_MAX_BYTES = Number.POSITIVE_INFINITY;
/** @deprecated Duration is no longer enforced client-side. */
export const VIDEO_MAX_DURATION_SECONDS = Number.POSITIVE_INFINITY;

/** Concurrent background uploads for photos / small media — more saturates weak LTE. */
export const MEDIA_UPLOAD_CONCURRENCY = 2;

/**
 * Videos at or above this size upload one-at-a-time so two large phone uploads
 * do not contend for bandwidth/memory. Smaller clips still share the photo pool.
 */
export const LARGE_VIDEO_SERIAL_BYTES = 20 * 1024 * 1024; // 20 MiB

/** Supabase TUS requires exactly 6 MiB chunks — any other value fails. */
export const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;

/**
 * Zip export: above this, offer photos-only instead of failing mid-stream.
 * Large videos will hit this often — revisit separately if field exports need full video zips.
 */
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

/**
 * Prefer the direct storage hostname for resumable uploads (Supabase guidance).
 * https://project.supabase.co → https://project.storage.supabase.co
 */
export function supabaseResumableUploadEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith(".supabase.co") && !url.hostname.includes(".storage.")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  return `${url.origin.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

/** Strip accidental Bearer prefix / whitespace; require three JWT segments. */
export function normalizeAccessToken(raw: string): string {
  let token = raw.trim();
  if (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, "").trim();
  }
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((s) => !s)) {
    throw new Error("Sign in again to upload video (session token looks invalid)");
  }
  return token;
}

export function redactAuthorizationForLog(authorizationHeader: string): {
  hasBearerPrefix: boolean;
  bearerPrefixCount: number;
  tokenSegmentCount: number;
  firstSegmentPrefix: string | null;
  tokenLength: number;
} {
  const trimmed = authorizationHeader.trim();
  const bearerPrefixCount = (trimmed.match(/bearer\s+/gi) ?? []).length;
  const hasBearerPrefix = /^bearer\s+/i.test(trimmed);
  const token = hasBearerPrefix ? trimmed.replace(/^bearer\s+/i, "").trim() : trimmed;
  const segments = token ? token.split(".") : [];
  return {
    hasBearerPrefix,
    bearerPrefixCount,
    tokenSegmentCount: segments.length,
    firstSegmentPrefix: segments[0] ? segments[0].slice(0, 20) : null,
    tokenLength: token.length,
  };
}

/** Redact apikey the same way (structure only — never log the secret). */
export function redactApiKeyForLog(apikeyHeader: string): {
  hasBearerPrefix: boolean;
  bearerPrefixCount: number;
  tokenSegmentCount: number;
  firstSegmentPrefix: string | null;
  tokenLength: number;
  format: "legacy_jwt" | "sb_publishable" | "sb_secret" | "other";
} {
  const base = redactAuthorizationForLog(apikeyHeader);
  const raw = apikeyHeader
    .trim()
    .replace(/^bearer\s+/i, "")
    .trim();
  const format = raw.startsWith("sb_publishable_")
    ? "sb_publishable"
    : raw.startsWith("sb_secret_")
      ? "sb_secret"
      : raw.startsWith("eyJ")
        ? "legacy_jwt"
        : "other";
  return { ...base, format };
}
