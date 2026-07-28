/**
 * Initials for avatar placeholders (no external image requests).
 */

export function getInitials(displayName: string | null | undefined): string {
  if (!displayName) return "?";
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const first = parts[0]![0];
    return first ? first.toUpperCase() : "?";
  }

  const a = parts[0]![0];
  const b = parts[parts.length - 1]![0];
  if (!a && !b) return "?";
  return `${(a ?? "").toUpperCase()}${(b ?? "").toUpperCase()}`.slice(0, 2) || "?";
}
