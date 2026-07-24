import "server-only";

import { googleFetch } from "./auth";
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
  const params = new URLSearchParams({ mimeType });
  return googleFetch<string>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?${params}`,
    { rawText: true },
  );
}

export async function getFolderMetadata(folderId: string): Promise<GoogleDriveFile> {
  const file = await getDriveFile(folderId);
  if (file.mimeType !== GOOGLE_FOLDER_MIME) {
    throw new Error("The provided Google ID is not a folder");
  }
  return file;
}
