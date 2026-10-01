"use client";

import { assertPanoramaFile, derivePanoramaImages } from "@/lib/tours/client-panorama";
import { panoramaExtension } from "@/lib/tours/paths";
import { discardSceneUpload, prepareSceneUpload, saveScene } from "@/lib/tours/actions";
import type { TourUploadStage } from "@/lib/tours/types";
import { isUploadAbort } from "@/lib/tours/signed-put";
import { uploadOriginalPanorama, uploadTourObject } from "@/lib/tours/upload-original";

export function sceneNameFromFile(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  return base || "Scene";
}

/**
 * One panorama. A thrown error here is caught by the caller so the rest of
 * the batch keeps going. The original File is what lands at storage_path.
 */
export async function uploadOnePanorama(input: {
  file: File;
  tourId: string;
  sceneId: string;
  onStage: (stage: TourUploadStage) => void;
  onProgress?: (loaded: number, total: number) => void;
  onPreview?: (thumbnail: Blob) => void;
  signal?: AbortSignal;
}): Promise<{ error: string | null; warning: string | null; cancelled?: boolean }> {
  const cancelled = () => {
    if (!input.signal?.aborted) return false;
    throw new DOMException("Upload cancelled.", "AbortError");
  };
  input.onStage("processing");
  let warning: string | null = null;
  let prepared = false;
  let extension: "jpg" | "png" = "jpg";
  try {
    cancelled();
    const contentType = await assertPanoramaFile(input.file);
    extension = panoramaExtension(contentType);
    const derived = await derivePanoramaImages(input.file);
    warning = derived.warning;
    input.onPreview?.(derived.thumbnail);
    cancelled();
    input.onStage("uploading");
    const upload = await prepareSceneUpload({
      tourId: input.tourId,
      sceneId: input.sceneId,
      includeCompat: derived.compat !== null,
      extension,
    });
    if (upload.error || !upload.storage || !upload.thumbnail) {
      input.onStage("error");
      return {
        error: `${input.file.name}: ${upload.error || "Could not prepare the panorama upload."}`,
        warning,
      };
    }
    cancelled();
    prepared = true;
    await uploadOriginalPanorama({
      file: input.file,
      signedUrl: upload.storage.signedUrl,
      contentType,
      onProgress: input.onProgress,
      signal: input.signal,
    });
    await uploadTourObject({
      signedUrl: upload.thumbnail.signedUrl,
      body: derived.thumbnail,
      contentType: "image/jpeg",
      signal: input.signal,
    });
    if (derived.compat) {
      if (!upload.compat) {
        throw new Error("Could not prepare the compatibility image.");
      }
      await uploadTourObject({
        signedUrl: upload.compat.signedUrl,
        body: derived.compat,
        contentType: "image/jpeg",
        signal: input.signal,
      });
    }
    input.onStage("saving");
    const saved = await saveScene({
      tourId: input.tourId,
      sceneId: input.sceneId,
      name: sceneNameFromFile(input.file),
      width: derived.width,
      height: derived.height,
      includeCompat: derived.compat !== null,
      extension,
    });
    if (saved.error) throw new Error(saved.error);
    input.onStage("done");
    return { error: null, warning };
  } catch (error) {
    if (prepared) {
      try {
        await discardSceneUpload(input.tourId, input.sceneId, extension);
      } catch {
        // The visible failure is the upload error. Cleanup is best-effort.
      }
    }
    if (isUploadAbort(error)) return { error: null, warning, cancelled: true };
    input.onStage("error");
    const reason = error instanceof Error ? error.message : "Upload failed.";
    const named = reason.startsWith(`${input.file.name}:`)
      ? reason
      : `${input.file.name}: ${reason}`;
    return { error: named, warning };
  }
}
