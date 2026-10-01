"use client";

import { assertPanoramaFile, derivePanoramaImages } from "@/lib/tours/client-panorama";
import { panoramaExtension } from "@/lib/tours/paths";
import { discardSceneUpload, prepareSceneUpload, saveScene } from "@/lib/tours/actions";
import type { TourUploadStage } from "@/lib/tours/types";
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
}): Promise<{ error: string | null; warning: string | null }> {
  input.onStage("processing");
  let warning: string | null = null;
  let prepared = false;
  let extension: "jpg" | "png" = "jpg";
  try {
    const contentType = await assertPanoramaFile(input.file);
    extension = panoramaExtension(contentType);
    const derived = await derivePanoramaImages(input.file);
    warning = derived.warning;
    input.onStage("uploading");
    const upload = await prepareSceneUpload({
      tourId: input.tourId,
      sceneId: input.sceneId,
      includeCompat: derived.compat !== null,
      extension,
    });
    if (upload.error || !upload.storage || !upload.thumbnail) {
      return { error: upload.error || "Could not prepare the panorama upload.", warning };
    }
    prepared = true;
    await uploadOriginalPanorama({
      file: input.file,
      path: upload.storage.path,
      token: upload.storage.token,
      contentType,
    });
    await uploadTourObject({
      path: upload.thumbnail.path,
      token: upload.thumbnail.token,
      body: derived.thumbnail,
      contentType: "image/jpeg",
    });
    if (derived.compat) {
      if (!upload.compat) {
        throw new Error("Could not prepare the compatibility image.");
      }
      await uploadTourObject({
        path: upload.compat.path,
        token: upload.compat.token,
        body: derived.compat,
        contentType: "image/jpeg",
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
    if (prepared) await discardSceneUpload(input.tourId, input.sceneId, extension);
    input.onStage("error");
    return {
      error: error instanceof Error ? error.message : "Upload failed.",
      warning,
    };
  }
}
