import "server-only";

import { requireGhlLocationId, isGhlConfigured } from "./config";
import { listPipelines } from "./resources/pipelines";
import { listUsers } from "./resources/users";
import { listCustomFields } from "./resources/custom-fields";
import { listTags } from "./resources/tags";
import { listCalendars } from "./resources/calendars";
import type { GhlPipeline, GhlUser, GhlCustomFieldDef, GhlTag, GhlCalendar } from "./types";
import { getCacheStatus } from "./cache";

export type GhlReferenceData = {
  locationId: string;
  pipelines: GhlPipeline[];
  users: GhlUser[];
  customFields: GhlCustomFieldDef[];
  tags: GhlTag[];
  calendars: GhlCalendar[];
  refreshedAt: string;
  userNameById: Map<string, string>;
  pipelineNameById: Map<string, string>;
  stageNameByKey: Map<string, string>; // `${pipelineId}:${stageId}`
  customFieldNameById: Map<string, string>;
  tagNameById: Map<string, string>;
};

let memoryCache: { data: GhlReferenceData; expiresAt: number } | null = null;
const MEMORY_TTL_MS = 5 * 60 * 1000;

function buildMaps(
  locationId: string,
  pipelines: GhlPipeline[],
  users: GhlUser[],
  customFields: GhlCustomFieldDef[],
  tags: GhlTag[],
  calendars: GhlCalendar[],
): GhlReferenceData {
  const userNameById = new Map<string, string>();
  for (const u of users) {
    userNameById.set(
      u.id,
      u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
    );
  }
  const pipelineNameById = new Map<string, string>();
  const stageNameByKey = new Map<string, string>();
  for (const p of pipelines) {
    pipelineNameById.set(p.id, p.name);
    for (const s of p.stages) {
      stageNameByKey.set(`${p.id}:${s.id}`, s.name);
    }
  }
  const customFieldNameById = new Map<string, string>();
  for (const f of customFields) {
    customFieldNameById.set(f.id, f.name);
    if (f.fieldKey) customFieldNameById.set(f.fieldKey, f.name);
  }
  const tagNameById = new Map<string, string>();
  for (const t of tags) {
    tagNameById.set(t.id, t.name);
    tagNameById.set(t.name, t.name);
  }

  return {
    locationId,
    pipelines,
    users,
    customFields,
    tags,
    calendars,
    refreshedAt: new Date().toISOString(),
    userNameById,
    pipelineNameById,
    stageNameByKey,
    customFieldNameById,
    tagNameById,
  };
}

/**
 * Shared reference data for admin UI, Baxter runtime, filters, and write previews.
 * Uses resource-layer caches (pipelines/users/fields/tags) and a short in-memory layer.
 */
export async function getGhlReferenceData(options?: {
  forceRefresh?: boolean;
}): Promise<GhlReferenceData | null> {
  if (!isGhlConfigured()) return null;
  const locationId = requireGhlLocationId();

  if (!options?.forceRefresh && memoryCache && memoryCache.expiresAt > Date.now()) {
    if (memoryCache.data.locationId === locationId) {
      return memoryCache.data;
    }
  }

  const useCache = options?.forceRefresh ? false : true;
  const [pipelines, users, customFields, tags, calendars] = await Promise.all([
    listPipelines({ useCache }).catch(() => [] as GhlPipeline[]),
    listUsers({ useCache }).catch(() => [] as GhlUser[]),
    listCustomFields({ useCache }).catch(() => [] as GhlCustomFieldDef[]),
    listTags({ useCache }).catch(() => [] as GhlTag[]),
    listCalendars({ useCache }).catch(() => [] as GhlCalendar[]),
  ]);

  const data = buildMaps(locationId, pipelines, users, customFields, tags, calendars);
  memoryCache = { data, expiresAt: Date.now() + MEMORY_TTL_MS };
  return data;
}

/** Warm reference caches after connect / refresh / successful health. */
export async function warmGhlReferenceCache(): Promise<{
  ok: boolean;
  warmed: string[];
  message: string;
}> {
  if (!isGhlConfigured()) {
    return { ok: false, warmed: [], message: "GoHighLevel is not configured." };
  }
  memoryCache = null;
  const data = await getGhlReferenceData({ forceRefresh: true });
  if (!data) {
    return { ok: false, warmed: [], message: "Could not load reference data." };
  }
  const warmed = [
    data.pipelines.length ? "pipelines" : null,
    data.users.length ? "users" : null,
    data.customFields.length ? "custom_fields" : null,
    data.tags.length ? "tags" : null,
    data.calendars.length ? "calendars" : null,
  ].filter(Boolean) as string[];

  return {
    ok: warmed.length > 0,
    warmed,
    message: warmed.length
      ? `CRM data refreshed (${warmed.join(", ")}).`
      : "Reference refresh completed but no reference resources returned.",
  };
}

export async function getGhlReferenceCacheStatus() {
  if (!isGhlConfigured()) return [];
  const locationId = requireGhlLocationId();
  return getCacheStatus(locationId);
}

export function resolveUserDisplayName(
  refs: GhlReferenceData | null,
  userId: string | null | undefined,
): string | null {
  if (!userId || !refs) return null;
  return refs.userNameById.get(userId) ?? null;
}

export function resolvePipelineDisplayName(
  refs: GhlReferenceData | null,
  pipelineId: string | null | undefined,
): string | null {
  if (!pipelineId || !refs) return null;
  return refs.pipelineNameById.get(pipelineId) ?? null;
}

export function resolveStageDisplayName(
  refs: GhlReferenceData | null,
  pipelineId: string | null | undefined,
  stageId: string | null | undefined,
): string | null {
  if (!pipelineId || !stageId || !refs) return null;
  return refs.stageNameByKey.get(`${pipelineId}:${stageId}`) ?? null;
}

export function resolveCustomFieldDisplayName(
  refs: GhlReferenceData | null,
  fieldId: string,
): string | null {
  if (!refs) return null;
  return refs.customFieldNameById.get(fieldId) ?? null;
}

export function resolveTagDisplayName(refs: GhlReferenceData | null, tag: string): string {
  if (!refs) return tag;
  return refs.tagNameById.get(tag) ?? tag;
}
