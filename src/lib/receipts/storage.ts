/**
 * Server-side receipt photo storage — private bucket, signed URLs only.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import { RECEIPT_PHOTOS_BUCKET } from "./types";

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

type MemoryPhoto = {
  storagePath: string;
  bytes: Buffer;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterReceiptPhotos?: Map<string, MemoryPhoto>;
};

function getMemory() {
  if (!globalMemory.__baxterReceiptPhotos) {
    globalMemory.__baxterReceiptPhotos = new Map();
  }
  return globalMemory.__baxterReceiptPhotos;
}

export function resetReceiptPhotosMemoryForTests() {
  globalMemory.__baxterReceiptPhotos = new Map();
}

/** Sniff vision-safe image types. Reject HEIC/unknown with a clear error. */
export function sniffVisionSafeImageMime(
  buffer: Buffer,
): "image/jpeg" | "image/png" | "image/webp" {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  // HEIC/HEIF often starts with ftyp....heic
  const head = buffer.toString("ascii", 0, Math.min(buffer.length, 32)).toLowerCase();
  if (
    head.includes("ftyp") &&
    (head.includes("heic") || head.includes("heif") || head.includes("mif1"))
  ) {
    throw new ValidationError(
      "This photo is still HEIC/HEIF. Re-take with the in-app camera or convert to JPEG before uploading — the extractor cannot read HEIC.",
    );
  }
  throw new ValidationError(
    "Unsupported photo format. Upload a JPEG (preferred), PNG, or WebP — or use Take photo so the app converts it first.",
  );
}

export async function uploadReceiptPhoto(input: {
  userId: string;
  buffer: Buffer;
  mimeType?: string;
  filename?: string;
}): Promise<{ storagePath: string; mimeType: string; sizeBytes: number }> {
  const mimeType = sniffVisionSafeImageMime(input.buffer);
  const id = randomUUID();
  const safeName = (input.filename ?? "receipt.jpg").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const storagePath = `${input.userId}/${id}-${safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`}`;

  if (shouldUseMemory()) {
    getMemory().set(storagePath, {
      storagePath,
      bytes: input.buffer,
      mimeType,
      uploadedBy: input.userId,
      createdAt: new Date().toISOString(),
    });
    return { storagePath, mimeType, sizeBytes: input.buffer.byteLength };
  }

  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from(RECEIPT_PHOTOS_BUCKET)
    .upload(storagePath, input.buffer, {
      contentType: mimeType,
      upsert: false,
    });
  if (error) {
    throw new ValidationError(
      "Could not store the receipt photo. Confirm the receipt-photos bucket exists.",
    );
  }
  return { storagePath, mimeType, sizeBytes: input.buffer.byteLength };
}

export async function downloadReceiptPhoto(
  storagePath: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const path = storagePath.trim();
  if (!path) return null;

  if (shouldUseMemory()) {
    const row = getMemory().get(path);
    if (!row) return null;
    return { buffer: row.bytes, mimeType: row.mimeType };
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(RECEIPT_PHOTOS_BUCKET).download(path);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  const mimeType = sniffVisionSafeImageMime(buffer);
  return { buffer, mimeType };
}

export async function createReceiptPhotoSignedUrl(
  storagePath: string,
  expiresInSeconds = 120,
): Promise<string | null> {
  const path = storagePath.trim();
  if (!path) return null;

  if (shouldUseMemory()) {
    const row = getMemory().get(path);
    if (!row) return null;
    // Data URL for tests / mock — never used in production.
    return `data:${row.mimeType};base64,${row.bytes.toString("base64")}`;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(RECEIPT_PHOTOS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}

/** Batch signed URLs for the visible page — one round-trip pattern, not N client requests. */
export async function createReceiptPhotoSignedUrlMap(
  storagePaths: string[],
  expiresInSeconds = 600,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(storagePaths.map((p) => p.trim()).filter(Boolean)));
  const entries = await Promise.all(
    unique.map(async (path) => {
      const url = await createReceiptPhotoSignedUrl(path, expiresInSeconds);
      return [path, url] as const;
    }),
  );
  const map = new Map<string, string>();
  for (const [path, url] of entries) {
    if (url) map.set(path, url);
  }
  return map;
}
