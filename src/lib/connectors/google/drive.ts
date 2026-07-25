import "server-only";

import { googleFetch, mintAccessToken } from "./auth";
import { GOOGLE_FOLDER_MIME, type GoogleDriveFile } from "./types";

const FILE_FIELDS =
  "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress),parents,md5Checksum,size,driveId),nextPageToken";

export async function listFilesInFolder(folderId: string): Promise<GoogleDriveFile[]> {
  const files: GoogleDriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: FILE_FIELDS,
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await googleFetch<{
      files?: GoogleDriveFile[];
      nextPageToken?: string;
    }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);

    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

export async function getDriveFile(fileId: string): Promise<GoogleDriveFile> {
  const params = new URLSearchParams({
    fields:
      "id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress),parents,md5Checksum,size,driveId",
    supportsAllDrives: "true",
  });
  return googleFetch<GoogleDriveFile>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`,
  );
}

export async function exportDriveFile(fileId: string, mimeType: string): Promise<string> {
  const params = new URLSearchParams({
    mimeType,
    supportsAllDrives: "true",
  });
  try {
    return await googleFetch<string>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?${params}`,
      { rawText: true },
    );
  } catch (error) {
    if (error instanceof Error) {
      const wrapped = error as { code?: string };
      throw Object.assign(new Error(error.message), {
        code: wrapped.code ?? "BAXTER_GOOGLE_EXPORT_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

/** Download a binary Drive file (XLSX, DOCX, PDF, etc.) as a Buffer. */
export async function downloadDriveFileBytes(fileId: string): Promise<Buffer> {
  const token = await mintAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw Object.assign(
      new Error(`Google file download failed (${response.status}): ${text.slice(0, 200)}`),
      { code: "BAXTER_GOOGLE_DOWNLOAD_FAILED", statusCode: response.status },
    );
  }
  const ab = await response.arrayBuffer();
  return Buffer.from(ab);
}

export async function getFolderMetadata(folderId: string): Promise<GoogleDriveFile> {
  const file = await getDriveFile(folderId);
  if (file.mimeType !== GOOGLE_FOLDER_MIME) {
    throw new Error("The provided Google ID is not a folder");
  }
  return file;
}

export type GoogleSharedDrive = {
  id: string;
  name: string;
};

export async function listSharedDrives(): Promise<GoogleSharedDrive[]> {
  const drives: GoogleSharedDrive[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      pageSize: "50",
      fields: "nextPageToken,drives(id,name)",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await googleFetch<{
      drives?: GoogleSharedDrive[];
      nextPageToken?: string;
    }>(`https://www.googleapis.com/drive/v3/drives?${params.toString()}`);
    drives.push(...(data.drives ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return drives;
}

/** List top-level items in My Drive (root). */
export async function listMyDriveRoot(): Promise<GoogleDriveFile[]> {
  return listFilesInFolder("root");
}

/** List children of a Shared Drive root (driveId as corpus). */
export async function listSharedDriveRoot(driveId: string): Promise<GoogleDriveFile[]> {
  const files: GoogleDriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${driveId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: FILE_FIELDS,
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "drive",
      driveId,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await googleFetch<{
      files?: GoogleDriveFile[];
      nextPageToken?: string;
    }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}
