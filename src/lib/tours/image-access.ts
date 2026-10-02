import {
  TOUR_IMAGE_PROXY_MAX_AGE_SECONDS,
  TOUR_VIEWER_SIGNED_URL_SECONDS,
} from "@/lib/tours/constants";
import type { TourImageVariant } from "@/lib/tours/image-url";

export function parseTourImageVariant(value: string | null): TourImageVariant | null {
  if (value === "full" || value === "compat" || value === "thumb") return value;
  return null;
}

/**
 * Anonymous callers of a private tour get the same answer as a missing scene.
 * A public tour never requires a session.
 */
export function tourImageDecision(input: {
  found: boolean;
  slugMatches: boolean;
  isPublic: boolean;
  isAppUser: boolean;
}): "allow" | "not-found" {
  if (!input.found || !input.slugMatches) return "not-found";
  if (input.isPublic || input.isAppUser) return "allow";
  return "not-found";
}

export function tourImageCacheControl(isPublic: boolean): string {
  const maxAge = TOUR_IMAGE_PROXY_MAX_AGE_SECONDS;
  if (maxAge >= TOUR_VIEWER_SIGNED_URL_SECONDS) {
    throw new Error("Tour image cache must expire before the signed URL.");
  }
  if (isPublic) return `public, max-age=${maxAge}, s-maxage=${maxAge}`;
  return `private, max-age=${maxAge}`;
}

export function sceneFileForVariant(
  variant: TourImageVariant,
  scene: { storagePath: string; compatPath: string | null; thumbnailPath: string | null },
): string | null {
  if (variant === "full") return scene.storagePath || null;
  if (variant === "thumb") return scene.thumbnailPath;
  return scene.compatPath;
}
