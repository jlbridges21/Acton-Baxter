/**
 * Default Street View cover for a site inspection.
 *
 * `location` prefers stored coordinates when a place was selected. Otherwise
 * the Static API accepts the address string directly, so we don't geocode
 * first. Metadata is checked before the image request — a miss returns a grey
 * tile if you skip that, and we never want that on a card.
 * The Google key stays in this server module; callers persist the JPEG.
 */

import "server-only";

import { getEnv } from "@/lib/env";

export type StreetViewCoverLookup =
  | {
      outcome: "available";
      bytes: Buffer;
      mimeType: string;
      capturedOn: string | null;
    }
  | { outcome: "unavailable" }
  | { outcome: "skipped" };

function googleKey(): string {
  // Same precedence as src/lib/providers/google/imagery.ts. Fall back to
  // process.env when the rest of the app env is incomplete so a missing
  // Supabase var cannot turn a cover lookup into a failed inspection create.
  try {
    const env = getEnv();
    return (
      env.GOOGLE_MAPS_SERVER_API_KEY ||
      env.GOOGLE_MAPS_API_KEY ||
      env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      ""
    );
  } catch {
    return (
      process.env.GOOGLE_MAPS_SERVER_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      ""
    );
  }
}

/** Unit tests opt in; every other Vitest create must not call Google. */
export function streetViewLookupEnabled(): boolean {
  if (process.env.VITEST && process.env.SITE_INSPECTION_STREET_VIEW_FETCH !== "1") {
    return false;
  }
  return true;
}

export function streetViewStoragePath(inspectionId: string): string {
  return `street-view/${inspectionId}.jpg`;
}

/** True when a lookup would call Google. Missing key or test opt-out is false. */
export function streetViewCoverReady(): boolean {
  return streetViewLookupEnabled() && Boolean(googleKey());
}

/**
 * Coordinates win when both are finite. The Static API then looks up that
 * point instead of resolving the address string onto a neighboring property.
 */
export function streetViewLocationKey(input: {
  address: string;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const lat = input.latitude;
  const lng = input.longitude;
  if (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng)
  ) {
    return `${lat},${lng}`;
  }
  return input.address.trim();
}

function metadataUrl(address: string, key: string): string {
  const params = new URLSearchParams({
    location: address,
    source: "outdoor",
    key,
  });
  return `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`;
}

function imageUrl(address: string, key: string): string {
  const params = new URLSearchParams({
    size: "640x400",
    location: address,
    fov: "80",
    pitch: "8",
    source: "outdoor",
    return_error_code: "true",
    key,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

export async function lookupStreetViewCover(address: string): Promise<StreetViewCoverLookup> {
  const trimmed = address.trim();
  if (!trimmed) return { outcome: "skipped" };
  if (!streetViewLookupEnabled()) return { outcome: "skipped" };
  if (!googleKey()) {
    console.warn("[site-inspection] Street View cover skipped — Google Maps API key is not set");
    return { outcome: "skipped" };
  }

  const key = googleKey();
  try {
    const metaRes = await fetch(metadataUrl(trimmed, key), {
      signal: AbortSignal.timeout(8_000),
    });
    if (!metaRes.ok) {
      console.warn("[site-inspection] Street View metadata failed", {
        status: metaRes.status,
      });
      return { outcome: "skipped" };
    }
    const meta = (await metaRes.json()) as { status?: string; date?: string };
    const status = (meta.status ?? "").toUpperCase();
    if (status === "ZERO_RESULTS" || status === "NOT_FOUND") {
      return { outcome: "unavailable" };
    }
    if (status !== "OK") {
      console.warn("[site-inspection] Street View metadata not usable", { status });
      return { outcome: "skipped" };
    }

    const imageRes = await fetch(imageUrl(trimmed, key), {
      signal: AbortSignal.timeout(12_000),
    });
    if (!imageRes.ok) {
      console.warn("[site-inspection] Street View image failed", { status: imageRes.status });
      return { outcome: "skipped" };
    }
    const contentType = imageRes.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      console.warn("[site-inspection] Street View image was not an image", { contentType });
      return { outcome: "skipped" };
    }
    const bytes = Buffer.from(await imageRes.arrayBuffer());
    if (bytes.byteLength < 32) {
      console.warn("[site-inspection] Street View image was empty");
      return { outcome: "skipped" };
    }
    const capturedOn = typeof meta.date === "string" && meta.date.trim() ? meta.date.trim() : null;
    const mimeType = contentType.split(";")[0]?.trim() || "image/jpeg";
    return { outcome: "available", bytes, mimeType, capturedOn };
  } catch (error) {
    console.warn("[site-inspection] Street View lookup failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { outcome: "skipped" };
  }
}
