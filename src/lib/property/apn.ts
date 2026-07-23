/**
 * Canonical APN normalization for comparison and search.
 * Display formatting is separate and must not affect equality.
 */

export function normalizeApn(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const asString = String(value).trim().toUpperCase();
  if (!asString) return null;
  const canonical = asString.replace(/[^A-Z0-9]/g, "");
  return canonical.length > 0 ? canonical : null;
}

export function apnsEqual(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): boolean {
  const a = normalizeApn(left);
  const b = normalizeApn(right);
  if (!a || !b) return false;
  return a === b;
}

/**
 * Prefer an official display format when provided; otherwise insert hyphens
 * for common Santa Clara County 8-digit APNs (xxx-xx-xxx).
 */
export function formatApnForDisplay(
  value: string | number | null | undefined,
  options?: { preferredDisplay?: string | null; jurisdiction?: string | null },
): string | null {
  if (options?.preferredDisplay?.trim()) {
    return options.preferredDisplay.trim();
  }
  const canonical = normalizeApn(value);
  if (!canonical) return null;
  if (/^\d{8}$/.test(canonical)) {
    return `${canonical.slice(0, 3)}-${canonical.slice(3, 5)}-${canonical.slice(5)}`;
  }
  return canonical;
}
