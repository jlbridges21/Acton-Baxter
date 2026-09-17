/**
 * Shared profile display-name resolution.
 *
 * `profiles` has `full_name` but no `email` column — emails live on auth.users.
 * Prefer full_name → email → truncated id so UIs never show a bare UUID when
 * better data exists. Include email in labels when both are known so same-name
 * accounts stay distinguishable.
 */

export type ProfileDisplayParts = {
  id: string;
  fullName?: string | null;
  email?: string | null;
};

/** Primary display: full_name → email → `User <8-char id>`. */
export function resolveProfileDisplayName(
  parts: ProfileDisplayParts,
  options?: { fallback?: string },
): string {
  const fullName = parts.fullName?.trim();
  if (fullName) return fullName;
  const email = parts.email?.trim();
  if (email) return email;
  return options?.fallback ?? `User ${parts.id.slice(0, 8)}`;
}

/**
 * Filter / CSV / tooltip label. When both name and email exist, append email
 * so two "Jackson Bridges" accounts stay distinguishable.
 */
export function formatProfileDisplayLabel(
  parts: ProfileDisplayParts,
  options?: { fallback?: string },
): string {
  const fullName = parts.fullName?.trim();
  const email = parts.email?.trim();
  if (fullName && email) return `${fullName} (${email})`;
  return resolveProfileDisplayName(parts, options);
}

export type ProfileDisplayInfo = {
  id: string;
  fullName: string | null;
  email: string | null;
  displayName: string;
  label: string;
};

export function buildProfileDisplayInfo(parts: ProfileDisplayParts): ProfileDisplayInfo {
  const fullName = parts.fullName?.trim() || null;
  const email = parts.email?.trim() || null;
  return {
    id: parts.id,
    fullName,
    email,
    displayName: resolveProfileDisplayName({ id: parts.id, fullName, email }),
    label: formatProfileDisplayLabel({ id: parts.id, fullName, email }),
  };
}
