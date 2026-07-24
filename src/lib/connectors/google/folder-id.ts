/**
 * Accept a raw folder ID or a Google Drive folder URL and return the folder ID.
 */
export function normalizeGoogleFolderId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Already looks like a Drive file/folder ID
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed) && !trimmed.includes("/")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const foldersMatch = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (foldersMatch?.[1]) return foldersMatch[1];
    const idParam = url.searchParams.get("id");
    if (idParam) return idParam;
  } catch {
    // not a URL
  }

  const loose = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (loose?.[1]) return loose[1];

  return trimmed;
}
