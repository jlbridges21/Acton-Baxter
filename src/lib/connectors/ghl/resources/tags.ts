import "server-only";

import { ghlGet } from "../client";
import { ghlTagsResponseSchema, type GhlTag } from "../types";
import { normalizeTag } from "../normalize";
import { requireGhlLocationId } from "../config";
import { getCachedReference, setCachedReference } from "../cache";

export async function listTags(options: { useCache?: boolean } = {}): Promise<GhlTag[]> {
  const locationId = requireGhlLocationId();

  if (options.useCache !== false) {
    const cached = await getCachedReference<GhlTag[]>(locationId, "tags");
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await ghlGet(`/locations/${locationId}/tags`, undefined, {
      injectLocationId: false,
    });
    const parsed = ghlTagsResponseSchema.safeParse(response);

    let tags: GhlTag[];

    if (!parsed.success) {
      console.warn("[GHL Tags] Response validation warning:", parsed.error.message);
      const raw = response as { tags?: unknown[] };
      tags = Array.isArray(raw.tags)
        ? (raw.tags as Record<string, unknown>[]).map((t) => normalizeTag(t, locationId))
        : [];
    } else {
      tags = parsed.data.tags.map((t) => normalizeTag(t as Record<string, unknown>, locationId));
    }

    await setCachedReference(locationId, "tags", tags);
    return tags;
  } catch (error) {
    console.warn(
      "[GHL Tags] API may not be available:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return [];
  }
}

export async function getTagById(
  tagId: string,
  options: { useCache?: boolean } = {},
): Promise<GhlTag | null> {
  const tags = await listTags(options);
  return tags.find((t) => t.id === tagId) ?? null;
}

export async function findTagByName(
  name: string,
  options: { useCache?: boolean } = {},
): Promise<GhlTag | null> {
  const tags = await listTags(options);
  const lower = name.toLowerCase();
  return tags.find((t) => t.name.toLowerCase() === lower) ?? null;
}

export async function findTagsByNames(
  names: string[],
  options: { useCache?: boolean } = {},
): Promise<GhlTag[]> {
  const tags = await listTags(options);
  const lowerNames = names.map((n) => n.toLowerCase());
  return tags.filter((t) => lowerNames.includes(t.name.toLowerCase()));
}

export function buildTagMapping(tags: GhlTag[]): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const tag of tags) {
    mapping.set(tag.id, tag.name);
  }
  return mapping;
}

export async function resolveTagIds(
  tagIds: string[],
  options: { useCache?: boolean } = {},
): Promise<string[]> {
  const tags = await listTags(options);
  const mapping = buildTagMapping(tags);
  return tagIds.map((id) => mapping.get(id) ?? id);
}

export async function getTagSummary(options: { useCache?: boolean } = {}): Promise<{
  totalTags: number;
  tags: Array<{ id: string; name: string }>;
}> {
  const tags = await listTags(options);
  return {
    totalTags: tags.length,
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
  };
}
