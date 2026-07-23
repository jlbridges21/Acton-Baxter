import "server-only";

import { getEnv } from "@/lib/env";

export type PropertyMapLinks = {
  googleMapsUrl: string | null;
  streetViewUrl: string | null;
  satelliteImageAvailable: boolean;
  streetViewImageAvailable: boolean;
};

function googleKey(): string {
  const env = getEnv();
  return (
    env.GOOGLE_MAPS_SERVER_API_KEY ||
    env.GOOGLE_MAPS_API_KEY ||
    env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ""
  );
}

export function hasGoogleImageryConfigured(): boolean {
  return Boolean(googleKey());
}

export function buildGoogleMapLinks(input: {
  address: string;
  latitude?: number | null;
  longitude?: number | null;
}): PropertyMapLinks {
  const query = encodeURIComponent(input.address);
  const hasCoords =
    typeof input.latitude === "number" &&
    Number.isFinite(input.latitude) &&
    typeof input.longitude === "number" &&
    Number.isFinite(input.longitude);

  return {
    googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${query}`,
    streetViewUrl: hasCoords
      ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${input.latitude},${input.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${query}`,
    satelliteImageAvailable: hasCoords && hasGoogleImageryConfigured(),
    streetViewImageAvailable: hasCoords && hasGoogleImageryConfigured(),
  };
}

/** Build Google Static Maps / Street View Static URLs (server-only; includes API key). */
export function buildGoogleStaticImageUrl(input: {
  view: "satellite" | "street" | "roadmap";
  latitude: number;
  longitude: number;
  width?: number;
  height?: number;
}): string | null {
  const key = googleKey();
  if (!key) return null;

  const width = input.width ?? 640;
  const height = input.height ?? 400;
  const { latitude, longitude } = input;

  if (input.view === "street") {
    const params = new URLSearchParams({
      size: `${width}x${height}`,
      location: `${latitude},${longitude}`,
      fov: "80",
      pitch: "0",
      heading: "0",
      key,
    });
    return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
  }

  const maptype = input.view === "satellite" ? "satellite" : "roadmap";
  const params = new URLSearchParams({
    center: `${latitude},${longitude}`,
    zoom: input.view === "satellite" ? "19" : "18",
    size: `${width}x${height}`,
    maptype,
    scale: "2",
    key,
  });
  // Marker helps orient the parcel on the aerial view.
  params.append("markers", `color:0xC4A35A|${latitude},${longitude}`);
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}
