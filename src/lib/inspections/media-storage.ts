/**
 * Site inspection media storage — private bucket, signed URLs + signed uploads.
 * Bytes for field uploads go direct client → Supabase Storage (never through Next.js).
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import { sniffVisionSafeImageMime } from "@/lib/receipts/storage";
import { SITE_INSPECTION_MEDIA_BUCKET } from "./record-types";

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

type MemoryMedia = {
  storagePath: string;
  bytes: Buffer;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterSiteInspectionMedia?: Map<string, MemoryMedia>;
};

function getMemory() {
  if (!globalMemory.__baxterSiteInspectionMedia) {
    globalMemory.__baxterSiteInspectionMedia = new Map();
  }
  return globalMemory.__baxterSiteInspectionMedia;
}

export function resetSiteInspectionMediaMemoryForTests() {
  globalMemory.__baxterSiteInspectionMedia = new Map();
}

export function putMemoryMediaBytes(input: {
  storagePath: string;
  bytes: Buffer;
  mimeType: string;
  uploadedBy: string;
}) {
  getMemory().set(input.storagePath, {
    storagePath: input.storagePath,
    bytes: input.bytes,
    mimeType: input.mimeType,
    uploadedBy: input.uploadedBy,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Test/memory helper and legacy sync path. Production field uploads use signed/TUS.
 */
export async function uploadSiteInspectionPhoto(input: {
  userId: string;
  inspectionId: string;
  buffer: Buffer;
  filename?: string;
  storagePath?: string;
}): Promise<{ storagePath: string; mimeType: string; sizeBytes: number }> {
  const mimeType = sniffVisionSafeImageMime(input.buffer);
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const storagePath =
    input.storagePath ?? `${input.userId}/${input.inspectionId}/${randomUUID()}.${ext}`;

  if (shouldUseMemory()) {
    putMemoryMediaBytes({
      storagePath,
      bytes: input.buffer,
      mimeType,
      uploadedBy: input.userId,
    });
    return { storagePath, mimeType, sizeBytes: input.buffer.byteLength };
  }

  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from(SITE_INSPECTION_MEDIA_BUCKET)
    .upload(storagePath, input.buffer, {
      contentType: mimeType,
      upsert: true,
    });
  if (error) {
    throw new ValidationError(
      "Could not store the inspection photo. Confirm the site-inspection-media bucket exists.",
    );
  }
  return { storagePath, mimeType, sizeBytes: input.buffer.byteLength };
}

export async function createSignedUploadForPath(
  storagePath: string,
): Promise<{ path: string; token: string; signedUrl: string }> {
  if (shouldUseMemory()) {
    return {
      path: storagePath,
      token: "memory",
      signedUrl: `memory://upload/${encodeURIComponent(storagePath)}`,
    };
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(SITE_INSPECTION_MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: true });
  if (error || !data) {
    throw new ValidationError("Could not create a signed upload URL for inspection media.");
  }
  return {
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
  };
}

export async function downloadSiteInspectionMediaBytes(
  storagePath: string,
): Promise<{ bytes: Buffer; mimeType: string | null } | null> {
  const path = storagePath.trim();
  if (!path) return null;

  if (shouldUseMemory()) {
    const row = getMemory().get(path);
    if (!row) return null;
    return { bytes: row.bytes, mimeType: row.mimeType };
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(SITE_INSPECTION_MEDIA_BUCKET).download(path);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  return { bytes: buffer, mimeType: data.type || null };
}

export async function createSiteInspectionMediaSignedUrl(
  storagePath: string,
  expiresInSeconds = 600,
): Promise<string | null> {
  const path = storagePath.trim();
  if (!path) return null;

  if (shouldUseMemory()) {
    const row = getMemory().get(path);
    if (!row) return null;
    return `data:${row.mimeType};base64,${row.bytes.toString("base64")}`;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(SITE_INSPECTION_MEDIA_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}

export async function createSiteInspectionMediaSignedUrlMap(
  storagePaths: string[],
  expiresInSeconds = 600,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(storagePaths.map((p) => p.trim()).filter(Boolean)));
  const map = new Map<string, string>();
  if (!unique.length) return map;

  if (shouldUseMemory()) {
    for (const path of unique) {
      const url = await createSiteInspectionMediaSignedUrl(path, expiresInSeconds);
      if (url) map.set(path, url);
    }
    return map;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(SITE_INSPECTION_MEDIA_BUCKET)
    .createSignedUrls(unique, expiresInSeconds);
  if (error || !data) {
    // Fallback: parallel singular signed URLs
    const entries = await Promise.all(
      unique.map(async (path) => {
        const url = await createSiteInspectionMediaSignedUrl(path, expiresInSeconds);
        return [path, url] as const;
      }),
    );
    for (const [path, url] of entries) {
      if (url) map.set(path, url);
    }
    return map;
  }

  for (const row of data) {
    if (row.path && row.signedUrl && !row.error) {
      map.set(row.path, row.signedUrl);
    }
  }
  return map;
}

/** Remove a storage object (best-effort). Missing objects are not an error. */
export async function deleteSiteInspectionMediaObject(storagePath: string): Promise<void> {
  const path = storagePath.trim();
  if (!path) return;

  if (shouldUseMemory()) {
    getMemory().delete(path);
    return;
  }

  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(SITE_INSPECTION_MEDIA_BUCKET).remove([path]);
  if (error) {
    console.warn("[site-inspection-media] storage remove failed", { path, message: error.message });
  }
}
