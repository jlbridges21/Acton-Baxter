import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";

export type GhlCacheResourceType =
  "pipelines" | "custom_fields" | "tags" | "users" | "calendars" | "phone_numbers";

const DEFAULT_TTL_MS: Record<GhlCacheResourceType, number> = {
  pipelines: 6 * 60 * 60 * 1000,
  custom_fields: 6 * 60 * 60 * 1000,
  tags: 3 * 60 * 60 * 1000,
  users: 1 * 60 * 60 * 1000,
  calendars: 3 * 60 * 60 * 1000,
  phone_numbers: 6 * 60 * 60 * 1000,
};

type GhlReferenceCacheRow = {
  id: string;
  location_id: string;
  resource_type: GhlCacheResourceType;
  payload: unknown;
  fetched_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export async function getCachedReference<T>(
  locationId: string,
  resourceType: GhlCacheResourceType,
): Promise<T | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ghl_reference_cache")
    .select("*")
    .eq("location_id", locationId)
    .eq("resource_type", resourceType)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as GhlReferenceCacheRow;
  if (new Date(row.expires_at) < new Date()) {
    return null;
  }

  return row.payload as T;
}

export async function setCachedReference<T>(
  locationId: string,
  resourceType: GhlCacheResourceType,
  payload: T,
  ttlMs?: number,
): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date();
  const ttl = ttlMs ?? DEFAULT_TTL_MS[resourceType];
  const expiresAt = new Date(now.getTime() + ttl);

  const { error } = await supabase.from("ghl_reference_cache").upsert(
    {
      location_id: locationId,
      resource_type: resourceType,
      payload: payload as unknown,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
    },
    {
      onConflict: "location_id,resource_type",
    },
  );

  if (error) {
    console.error(`[GHL Cache] Failed to cache ${resourceType} for ${locationId}:`, error.message);
  }
}

export async function invalidateCachedReference(
  locationId: string,
  resourceType?: GhlCacheResourceType,
): Promise<void> {
  const supabase = createServiceClient();

  if (resourceType) {
    await supabase
      .from("ghl_reference_cache")
      .delete()
      .eq("location_id", locationId)
      .eq("resource_type", resourceType);
  } else {
    await supabase.from("ghl_reference_cache").delete().eq("location_id", locationId);
  }
}

export async function invalidateAllGhlCache(): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("ghl_reference_cache")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
}

export async function getCacheStatus(locationId: string): Promise<
  {
    resourceType: GhlCacheResourceType;
    exists: boolean;
    expired: boolean;
    fetchedAt: string | null;
    expiresAt: string | null;
  }[]
> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ghl_reference_cache")
    .select("resource_type, fetched_at, expires_at")
    .eq("location_id", locationId);

  if (error || !data) return [];

  const now = new Date();
  const resourceTypes: GhlCacheResourceType[] = [
    "pipelines",
    "custom_fields",
    "tags",
    "users",
    "calendars",
    "phone_numbers",
  ];

  return resourceTypes.map((resourceType) => {
    const row = (
      data as Array<{ resource_type: string; fetched_at: string; expires_at: string }>
    ).find((r) => r.resource_type === resourceType);

    if (!row) {
      return {
        resourceType,
        exists: false,
        expired: true,
        fetchedAt: null,
        expiresAt: null,
      };
    }

    return {
      resourceType,
      exists: true,
      expired: new Date(row.expires_at) < now,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
    };
  });
}

export async function cleanupExpiredCache(): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ghl_reference_cache")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) return 0;
  return data?.length ?? 0;
}
