/**
 * Web-ready versions of rendering images. Originals are 3–6 MB; customers get a display
 * version (≤2560 px wide) and admins browse thumbnails. Used by the upload route and the
 * import script, so it imports nothing from the app.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";

export const DISPLAY_MAX_WIDTH = 2560;
export const THUMB_WIDTH = 480;
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ProcessedImage = {
  sha256: string;
  width: number | null;
  height: number | null;
  display: Buffer;
  thumb: Buffer;
};

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function processImage(original: Buffer): Promise<ProcessedImage> {
  const image = sharp(original, { failOn: "error" }).rotate();
  const meta = await image.metadata();
  const display = await image
    .clone()
    .resize({ width: DISPLAY_MAX_WIDTH, withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toBuffer();
  const thumb = await image
    .clone()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 72, progressive: true, mozjpeg: true })
    .toBuffer();
  return {
    sha256: sha256(original),
    width: meta.width ?? null,
    height: meta.height ?? null,
    display,
    thumb,
  };
}

/** Storage keys for an asset: content-addressed so re-imports never duplicate files. */
export function assetStoragePaths(hash: string): { displayPath: string; thumbPath: string } {
  return {
    displayPath: `renders/${hash.slice(0, 2)}/${hash}.jpg`,
    thumbPath: `thumbs/${hash.slice(0, 2)}/${hash}.jpg`,
  };
}
