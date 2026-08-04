/**
 * Resolve a GHL custom-field value by display name/label.
 *
 * Reuses the same name-based approach as `findCustomFieldByName` in
 * `src/lib/connectors/ghl/resources/custom-fields.ts`, but operates on the
 * id→label map already loaded by `resolveGhlEntityGraph` (no extra API call,
 * no hardcoded field ids — IDs differ across GHL sub-accounts).
 */

export const GHL_PROJECT_TYPE_CONSIDERING_LABEL = "What type of project are you considering?";

function asDisplayValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v)))
      .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

/**
 * Find a custom field value by label. Prefers exact case-insensitive match,
 * then falls back to substring includes (same spirit as findCustomFieldByName).
 */
export function resolveCustomFieldValueByLabel(
  customFields: Record<string, unknown> | null | undefined,
  labels: Record<string, string>,
  targetLabel: string,
): string | null {
  const target = targetLabel.trim().toLowerCase();
  if (!target || !customFields) return null;

  const entries = Object.entries(labels);
  const exact = entries.find(([, label]) => label.trim().toLowerCase() === target);
  if (exact) {
    return asDisplayValue(customFields[exact[0]]);
  }

  const partial = entries.find(([, label]) => label.trim().toLowerCase().includes(target));
  if (partial) {
    return asDisplayValue(customFields[partial[0]]);
  }

  return null;
}
