/**
 * Parse Google Workspace / Drive URLs into file or folder IDs.
 * Does not require network access.
 */

export type ParsedGoogleUrl = {
  kind: "file" | "folder" | "unknown";
  fileId: string | null;
  folderId: string | null;
  sheetGid: string | null;
  resourceType: "document" | "spreadsheet" | "presentation" | "file" | "folder" | null;
  raw: string;
};

/**
 * Extract Google file/folder ID and optional sheet gid from a pasted URL or raw ID.
 */
export function parseGoogleWorkspaceUrl(raw: string): ParsedGoogleUrl {
  const trimmed = raw.trim();
  const empty: ParsedGoogleUrl = {
    kind: "unknown",
    fileId: null,
    folderId: null,
    sheetGid: null,
    resourceType: null,
    raw: trimmed,
  };
  if (!trimmed) return empty;

  // Raw Drive ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed) && !trimmed.includes("/") && !trimmed.includes(".")) {
    return {
      kind: "file",
      fileId: trimmed,
      folderId: null,
      sheetGid: null,
      resourceType: "file",
      raw: trimmed,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Loose patterns without protocol
    const looseDoc = trimmed.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (looseDoc?.[1]) {
      return {
        kind: "file",
        fileId: looseDoc[1],
        folderId: null,
        sheetGid: null,
        resourceType: "document",
        raw: trimmed,
      };
    }
    const looseSheet = trimmed.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (looseSheet?.[1]) {
      const gidMatch = trimmed.match(/[?#&]gid=(\d+)/);
      return {
        kind: "file",
        fileId: looseSheet[1],
        folderId: null,
        sheetGid: gidMatch?.[1] ?? null,
        resourceType: "spreadsheet",
        raw: trimmed,
      };
    }
    return empty;
  }

  const host = url.hostname.toLowerCase();
  if (!host.includes("google.com") && !host.includes("googleusercontent.com")) {
    return empty;
  }

  const path = url.pathname;
  const gid = url.searchParams.get("gid") || (url.hash.match(/gid=(\d+)/)?.[1] ?? null);

  const folderMatch = path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) {
    return {
      kind: "folder",
      fileId: null,
      folderId: folderMatch[1],
      sheetGid: null,
      resourceType: "folder",
      raw: trimmed,
    };
  }

  const docMatch = path.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch?.[1]) {
    return {
      kind: "file",
      fileId: docMatch[1],
      folderId: null,
      sheetGid: null,
      resourceType: "document",
      raw: trimmed,
    };
  }

  const sheetMatch = path.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetMatch?.[1]) {
    return {
      kind: "file",
      fileId: sheetMatch[1],
      folderId: null,
      sheetGid: gid,
      resourceType: "spreadsheet",
      raw: trimmed,
    };
  }

  const slidesMatch = path.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (slidesMatch?.[1]) {
    return {
      kind: "file",
      fileId: slidesMatch[1],
      folderId: null,
      sheetGid: null,
      resourceType: "presentation",
      raw: trimmed,
    };
  }

  const fileMatch = path.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch?.[1]) {
    return {
      kind: "file",
      fileId: fileMatch[1],
      folderId: null,
      sheetGid: null,
      resourceType: "file",
      raw: trimmed,
    };
  }

  const idParam = url.searchParams.get("id");
  if (idParam) {
    return {
      kind: "file",
      fileId: idParam,
      folderId: null,
      sheetGid: gid,
      resourceType: "file",
      raw: trimmed,
    };
  }

  return empty;
}

export function looksLikeGoogleUrl(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return (
    t.includes("docs.google.com/") ||
    t.includes("drive.google.com/") ||
    t.includes("sheets.google.com/")
  );
}
