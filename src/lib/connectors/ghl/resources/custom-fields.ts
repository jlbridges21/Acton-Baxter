import "server-only";

import { ghlGet } from "../client";
import { ghlCustomFieldsResponseSchema, type GhlCustomFieldDef } from "../types";
import { normalizeCustomFieldDef } from "../normalize";
import { requireGhlLocationId } from "../config";
import { getCachedReference, setCachedReference } from "../cache";

export async function listCustomFields(
  options: { useCache?: boolean } = {},
): Promise<GhlCustomFieldDef[]> {
  const locationId = requireGhlLocationId();

  if (options.useCache !== false) {
    const cached = await getCachedReference<GhlCustomFieldDef[]>(locationId, "custom_fields");
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await ghlGet(`/locations/${locationId}/customFields`, undefined, {
      injectLocationId: false,
    });
    const parsed = ghlCustomFieldsResponseSchema.safeParse(response);

    let fields: GhlCustomFieldDef[];

    if (!parsed.success) {
      console.warn("[GHL Custom Fields] Response validation warning:", parsed.error.message);
      const raw = response as { customFields?: unknown[] };
      fields = Array.isArray(raw.customFields)
        ? (raw.customFields as Record<string, unknown>[]).map(normalizeCustomFieldDef)
        : [];
    } else {
      fields = parsed.data.customFields.map((f) =>
        normalizeCustomFieldDef(f as Record<string, unknown>),
      );
    }

    await setCachedReference(locationId, "custom_fields", fields);
    return fields;
  } catch (error) {
    console.warn(
      "[GHL Custom Fields] API may not be available:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return [];
  }
}

export async function getCustomFieldById(
  fieldId: string,
  options: { useCache?: boolean } = {},
): Promise<GhlCustomFieldDef | null> {
  const fields = await listCustomFields(options);
  return fields.find((f) => f.id === fieldId || f.fieldKey === fieldId) ?? null;
}

export async function getCustomFieldByKey(
  fieldKey: string,
  options: { useCache?: boolean } = {},
): Promise<GhlCustomFieldDef | null> {
  const fields = await listCustomFields(options);
  return fields.find((f) => f.fieldKey === fieldKey) ?? null;
}

export async function findCustomFieldByName(
  name: string,
  options: { useCache?: boolean } = {},
): Promise<GhlCustomFieldDef | null> {
  const fields = await listCustomFields(options);
  const lower = name.toLowerCase();
  return fields.find((f) => f.name.toLowerCase().includes(lower)) ?? null;
}

export async function listCustomFieldsByModel(
  model: string,
  options: { useCache?: boolean } = {},
): Promise<GhlCustomFieldDef[]> {
  const fields = await listCustomFields(options);
  return fields.filter((f) => f.model === model);
}

export function buildCustomFieldMapping(fields: GhlCustomFieldDef[]): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const field of fields) {
    mapping.set(field.id, field.name);
    if (field.fieldKey) {
      mapping.set(field.fieldKey, field.name);
    }
  }
  return mapping;
}

export async function resolveCustomFieldValues(
  customFields: Record<string, unknown>,
  options: { useCache?: boolean } = {},
): Promise<Record<string, { name: string; value: unknown }>> {
  const fieldDefs = await listCustomFields(options);
  const mapping = buildCustomFieldMapping(fieldDefs);
  const result: Record<string, { name: string; value: unknown }> = {};

  for (const [key, value] of Object.entries(customFields)) {
    const name = mapping.get(key) ?? key;
    result[key] = { name, value };
  }

  return result;
}
