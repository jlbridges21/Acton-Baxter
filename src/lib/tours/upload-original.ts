"use client";

import { putSignedObject } from "@/lib/tours/signed-put";

/**
 * Upload the original file object. Do not pass a canvas blob or a re-encoded
 * JPEG — that is a different byte string, and it is the quality loss this
 * path exists to avoid.
 */
export function originalPanoramaBody(file: File): File {
  return file;
}

export async function uploadTourObject(input: {
  signedUrl: string;
  body: Blob;
  contentType: string;
  signal?: AbortSignal;
}): Promise<void> {
  await putSignedObject({
    signedUrl: input.signedUrl,
    body: input.body,
    contentType: input.contentType,
    signal: input.signal,
  });
}

export async function uploadOriginalPanorama(input: {
  file: File;
  signedUrl: string;
  contentType: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const body = originalPanoramaBody(input.file);
  await putSignedObject({
    signedUrl: input.signedUrl,
    body,
    contentType: input.contentType,
    onProgress: input.onProgress,
    signal: input.signal,
  });
}
