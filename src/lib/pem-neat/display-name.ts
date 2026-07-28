/**
 * Human-readable display names for PEM salesperson fields.
 */
export function formatHumanDisplayName(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "Unnamed user";

  // Email local-part or dotted username → Title Case words
  const local = value.includes("@") ? value.split("@")[0]! : value;
  if (
    /^[a-z0-9._-]+$/i.test(local) &&
    (local.includes(".") || local.includes("_") || local.includes("-"))
  ) {
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  return value;
}
