import "server-only";

import { ghlGet } from "../client";
import { ghlBusinessesResponseSchema } from "../types";
import { requireGhlLocationId } from "../config";

export type GhlBusiness = {
  id: string;
  name: string | null;
  locationId: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

function normalizeBusiness(raw: Record<string, unknown>): GhlBusiness {
  return {
    id: String(raw.id ?? ""),
    name: raw.name ? String(raw.name) : null,
    locationId: raw.locationId ? String(raw.locationId) : null,
    phone: raw.phone ? String(raw.phone) : null,
    email: raw.email ? String(raw.email) : null,
    website: raw.website ? String(raw.website) : null,
    address: raw.address ? String(raw.address) : null,
    city: raw.city ? String(raw.city) : null,
    state: raw.state ? String(raw.state) : null,
    postalCode: raw.postalCode ? String(raw.postalCode) : null,
    country: raw.country ? String(raw.country) : null,
  };
}

export async function listBusinesses(): Promise<GhlBusiness[]> {
  const locationId = requireGhlLocationId();

  try {
    const response = await ghlGet("/businesses/", { locationId });
    const parsed = ghlBusinessesResponseSchema.safeParse(response);

    if (!parsed.success) {
      console.warn("[GHL Businesses] Response validation warning:", parsed.error.message);
      const raw = response as { businesses?: unknown[] };
      return Array.isArray(raw.businesses)
        ? (raw.businesses as Record<string, unknown>[]).map(normalizeBusiness)
        : [];
    }

    return parsed.data.businesses.map((b) => normalizeBusiness(b as Record<string, unknown>));
  } catch (error) {
    console.warn(
      "[GHL Businesses] API may not be available:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return [];
  }
}

export async function getBusinessById(businessId: string): Promise<GhlBusiness | null> {
  try {
    const response = await ghlGet(`/businesses/${businessId}`, undefined, {
      injectLocationId: false,
    });
    const data = response as { business?: unknown };
    const business = data.business ?? response;
    return normalizeBusiness(business as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function getBusinessSummary(): Promise<{
  total: number;
  businesses: Array<{ id: string; name: string | null }>;
}> {
  const businesses = await listBusinesses();
  return {
    total: businesses.length,
    businesses: businesses.map((b) => ({ id: b.id, name: b.name })),
  };
}
