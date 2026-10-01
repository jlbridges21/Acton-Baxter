"use client";

import { createClient } from "@/lib/supabase/client";
import { TOUR_PANORAMA_BUCKET } from "@/lib/tours/constants";

/**
 * Upload the original file object. Do not pass a canvas blob or a re-encoded
 * JPEG — that is a different byte string, and it is the quality loss this
 * path exists to avoid.
 */
export function originalPanoramaBody(file: File): File {
  return file;
}

export async function uploadTourObject(input: {
  path: string;
  token: string;
  body: Blob;
  contentType: string;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(TOUR_PANORAMA_BUCKET)
    .uploadToSignedUrl(input.path, input.token, input.body, {
      contentType: input.contentType,
    });
  if (error) {
    throw new Error(error.message || "Upload failed.");
  }
}

export async function uploadOriginalPanorama(input: {
  file: File;
  path: string;
  token: string;
  contentType: string;
}): Promise<void> {
  const body = originalPanoramaBody(input.file);
  await uploadTourObject({
    path: input.path,
    token: input.token,
    body,
    contentType: input.contentType,
  });
}
