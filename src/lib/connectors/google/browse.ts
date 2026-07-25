import "server-only";

import { getDriveFile, listFilesInFolder } from "./drive";
import { GOOGLE_FOLDER_MIME, type GoogleDriveFile } from "./types";
import { GoogleConnectorError } from "./errors";
import { isSupportedGoogleMime } from "./parser";

export type BrowseItem = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  modifiedTime: string | null;
  webViewLink: string | null;
  owner: string | null;
  driveId: string | null;
  supported: boolean;
  parseModeHint: "full_text" | "metadata_only" | "unsupported" | "folder";
};

export type Breadcrumb = {
  id: string;
  name: string;
};

function toBrowseItem(file: GoogleDriveFile): BrowseItem {
  const isFolder = file.mimeType === GOOGLE_FOLDER_MIME;
  let parseModeHint: BrowseItem["parseModeHint"] = "unsupported";
  if (isFolder) parseModeHint = "folder";
  else if (
    file.mimeType.includes("document") ||
    file.mimeType.includes("spreadsheet") ||
    file.mimeType.startsWith("text/") ||
    file.mimeType === "text/csv" ||
    file.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.mimeType === "application/vnd.ms-excel"
  ) {
    parseModeHint = "full_text";
  } else if (file.mimeType === "application/pdf" || file.mimeType.includes("wordprocessingml")) {
    parseModeHint = "full_text";
  }

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    isFolder,
    modifiedTime: file.modifiedTime ?? null,
    webViewLink: file.webViewLink ?? null,
    owner: file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || null,
    driveId: file.driveId ?? null,
    supported: isFolder ? true : isSupportedGoogleMime(file.mimeType),
    parseModeHint,
  };
}

/**
 * Build breadcrumb from current folder up to (and including) rootFolderId.
 * Stops if parent walk escapes the root.
 */
export async function buildBreadcrumbs(
  currentFolderId: string,
  rootFolderId: string,
): Promise<Breadcrumb[]> {
  const chain: Breadcrumb[] = [];
  let cursor: string | null = currentFolderId;
  const seen = new Set<string>();

  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const meta = await getDriveFile(cursor);
    chain.unshift({ id: meta.id, name: meta.name });
    if (meta.id === rootFolderId) break;
    const parent = meta.parents?.[0] ?? null;
    if (!parent) break;
    cursor = parent;
    if (chain.length > 20) break;
  }

  // Ensure root is first if we found it
  if (!chain.some((c) => c.id === rootFolderId)) {
    try {
      const root = await getDriveFile(rootFolderId);
      chain.unshift({ id: root.id, name: root.name });
    } catch {
      // ignore
    }
  }

  return chain;
}

export async function browseDriveFolder(input: {
  rootFolderId: string;
  folderId?: string | null;
  search?: string | null;
  sort?: "name" | "modified";
  fileType?: "all" | "docs" | "sheets" | "folders" | "supported";
}): Promise<{
  currentFolderId: string;
  currentFolderName: string;
  sharedDrive: boolean;
  driveId: string | null;
  breadcrumbs: Breadcrumb[];
  items: BrowseItem[];
  childCount: number;
  accessWarning: string | null;
}> {
  const folderId = input.folderId?.trim() || input.rootFolderId;
  let meta: GoogleDriveFile;
  try {
    meta = await getDriveFile(folderId);
  } catch (error) {
    throw new GoogleConnectorError(error instanceof Error ? error.message : "Folder not found", {
      code: "BAXTER_GOOGLE_FOLDER_NOT_FOUND",
      statusCode: 404,
    });
  }

  if (meta.mimeType !== GOOGLE_FOLDER_MIME) {
    throw new GoogleConnectorError("The requested ID is not a folder", {
      code: "BAXTER_GOOGLE_ROOT_INVALID",
      statusCode: 400,
    });
  }

  let files: GoogleDriveFile[] = [];
  let accessWarning: string | null = null;
  try {
    files = await listFilesInFolder(folderId);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "BAXTER_GOOGLE_LIST_FAILED";
    if (code.includes("ACCESS") || code.includes("403")) {
      accessWarning =
        "Folder metadata is visible but children could not be listed. Share this folder (or Shared Drive) with GOOGLE_CLIENT_EMAIL.";
      throw new GoogleConnectorError(error instanceof Error ? error.message : "List failed", {
        code: "BAXTER_GOOGLE_FOLDER_ACCESS_DENIED",
        statusCode: 403,
      });
    }
    throw error;
  }

  if (files.length === 0) {
    accessWarning =
      "This folder appears empty. If you expected files, confirm the service account can access Shared Drive members or child shares.";
  }

  let items = files.map(toBrowseItem);

  if (input.search?.trim()) {
    const q = input.search.trim().toLowerCase();
    items = items.filter((item) => item.name.toLowerCase().includes(q));
  }

  if (input.fileType && input.fileType !== "all") {
    items = items.filter((item) => {
      if (input.fileType === "folders") return item.isFolder;
      if (input.fileType === "docs") return item.mimeType.includes("document");
      if (input.fileType === "sheets") return item.mimeType.includes("spreadsheet");
      if (input.fileType === "supported") return item.supported && !item.isFolder;
      return true;
    });
  }

  const sort = input.sort ?? "name";
  items.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    if (sort === "modified") {
      return (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? "");
    }
    return a.name.localeCompare(b.name);
  });

  const breadcrumbs = await buildBreadcrumbs(folderId, input.rootFolderId);

  return {
    currentFolderId: folderId,
    currentFolderName: meta.name,
    sharedDrive: Boolean(meta.driveId),
    driveId: meta.driveId ?? null,
    breadcrumbs,
    items,
    childCount: files.length,
    accessWarning,
  };
}

/**
 * Recursively list supported files under a folder (bounded depth/count).
 */
export async function listDescendantFiles(
  folderId: string,
  options?: { recursive?: boolean; maxFiles?: number; maxDepth?: number },
): Promise<GoogleDriveFile[]> {
  const recursive = options?.recursive ?? true;
  const maxFiles = options?.maxFiles ?? 500;
  const maxDepth = options?.maxDepth ?? 8;
  const out: GoogleDriveFile[] = [];

  async function walk(id: string, depth: number) {
    if (out.length >= maxFiles || depth > maxDepth) return;
    const children = await listFilesInFolder(id);
    for (const child of children) {
      if (out.length >= maxFiles) return;
      if (child.mimeType === GOOGLE_FOLDER_MIME) {
        if (recursive) await walk(child.id, depth + 1);
        continue;
      }
      out.push(child);
    }
  }

  await walk(folderId, 0);
  return out;
}
