import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { TOUR_PANORAMA_BUCKET, TOUR_VIEWER_SIGNED_URL_SECONDS } from "@/lib/tours/constants";

export type SignedUpload = { path: string; token: string };

/**
 * The image proxy calls this and redirects. Pages store the proxy path, not this URL.
 */
export async function createTourPanoramaSignedUrl(
  storagePath: string,
  expiresInSeconds = TOUR_VIEWER_SIGNED_URL_SECONDS,
): Promise<string | null> {
  const path = storagePath.trim();
  if (!path) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(TOUR_PANORAMA_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function createTourPanoramaUpload(path: string): Promise<SignedUpload> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(TOUR_PANORAMA_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new Error(
      "Could not prepare the panorama upload. Confirm the tour-panoramas bucket exists.",
    );
  }
  return { path: data.path, token: data.token };
}

/** Remove objects before the database row that remembers their paths is deleted. */
export async function removeTourPanoramaObjects(paths: string[]): Promise<void> {
  const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  if (!unique.length) return;
  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(TOUR_PANORAMA_BUCKET).remove(unique);
  if (error) {
    throw new Error(error.message || "Could not delete panorama files.");
  }
}
