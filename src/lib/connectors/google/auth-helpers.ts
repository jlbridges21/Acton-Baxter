/**
 * Helpers extracted so credential providers do not import the full auth module
 * (avoids circular dependencies with mintAccessToken).
 */
export function normalizePrivateKey(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  value = value.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
  return value;
}

export function isPrivateKeyFormatValid(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const normalized = normalizePrivateKey(raw);
  return (
    normalized.includes("-----BEGIN PRIVATE KEY-----") &&
    normalized.includes("-----END PRIVATE KEY-----")
  );
}
