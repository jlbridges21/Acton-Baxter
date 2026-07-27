import "server-only";

import { ghlGet } from "../client";
import { ghlLocationResponseSchema } from "../types";
import { requireGhlLocationId, getGhlRuntimeConfig } from "../config";

export type GhlLocation = {
  id: string;
  name: string | null;
  companyId: string | null;
  timezone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

function normalizeLocation(raw: Record<string, unknown>): GhlLocation {
  return {
    id: String(raw.id ?? ""),
    name: raw.name ? String(raw.name) : null,
    companyId: raw.companyId ? String(raw.companyId) : null,
    timezone: raw.timezone ? String(raw.timezone) : null,
    address: raw.address ? String(raw.address) : null,
    city: raw.city ? String(raw.city) : null,
    state: raw.state ? String(raw.state) : null,
    postalCode: raw.postalCode ? String(raw.postalCode) : null,
    country: raw.country ? String(raw.country) : null,
    phone: raw.phone ? String(raw.phone) : null,
    email: raw.email ? String(raw.email) : null,
    website: raw.website ? String(raw.website) : null,
  };
}

export async function getCurrentLocation(): Promise<GhlLocation> {
  const locationId = requireGhlLocationId();

  const response = await ghlGet(`/locations/${locationId}`, undefined, {
    injectLocationId: false,
  });
  const parsed = ghlLocationResponseSchema.safeParse(response);

  if (!parsed.success) {
    console.warn("[GHL Locations] Response validation warning:", parsed.error.message);
    const raw = response as { location?: unknown };
    const location = raw.location ?? response;
    return normalizeLocation(location as Record<string, unknown>);
  }

  return normalizeLocation(parsed.data.location as Record<string, unknown>);
}

export async function getLocationById(locationId: string): Promise<GhlLocation | null> {
  const config = getGhlRuntimeConfig();

  if (locationId !== config.locationId) {
    console.warn(
      "[GHL Locations] Attempted to access non-authorized location. Using config locationId.",
    );
  }

  try {
    const response = await ghlGet(`/locations/${config.locationId}`, undefined, {
      injectLocationId: false,
    });
    const parsed = ghlLocationResponseSchema.safeParse(response);

    if (!parsed.success) {
      const raw = response as { location?: unknown };
      const location = raw.location ?? response;
      return normalizeLocation(location as Record<string, unknown>);
    }

    return normalizeLocation(parsed.data.location as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function getLocationSummary(): Promise<{
  locationId: string;
  name: string | null;
  companyId: string | null;
  timezone: string | null;
}> {
  const location = await getCurrentLocation();
  return {
    locationId: location.id,
    name: location.name,
    companyId: location.companyId,
    timezone: location.timezone,
  };
}
