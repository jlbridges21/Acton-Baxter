/**
 * Ensure a server-generated poster JPEG exists for a ready video.
 * Never throws to callers that want best-effort — returns ok:false instead.
 */

import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { downloadSiteInspectionMediaBytes, uploadSiteInspectionMediaBytes } from "./media-storage";
import { posterStoragePathForVideo } from "./video-remux";
import { extractPosterFromVideo } from "./video-poster-server";

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

export async function ensureServerVideoPoster(input: {
  mediaId: string;
  storagePath: string;
  posterStoragePath?: string | null;
}): Promise<{ ok: true; posterPath: string } | { ok: false; message: string }> {
  const posterPath =
    input.posterStoragePath?.trim() || posterStoragePathForVideo(input.storagePath);

  try {
    const downloaded = await downloadSiteInspectionMediaBytes(input.storagePath);
    if (!downloaded) {
      return { ok: false, message: "Could not download video for poster" };
    }
    const poster = await extractPosterFromVideo(downloaded.bytes);
    if (!poster.ok) {
      return { ok: false, message: poster.message };
    }
    await uploadSiteInspectionMediaBytes({
      storagePath: posterPath,
      bytes: poster.bytes,
      mimeType: poster.mimeType,
    });

    if (shouldUseMemory()) {
      // Media row poster path is updated by the caller / records-store.
    } else {
      const supabase = createServiceClient();
      await supabase
        .from("site_inspection_media")
        .update({ poster_storage_path: posterPath })
        .eq("id", input.mediaId);
    }

    return { ok: true, posterPath };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
