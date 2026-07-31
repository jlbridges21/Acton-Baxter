import "server-only";

import { googleFetch } from "./auth";
import { GoogleConnectorError } from "./errors";
import { getActiveGoogleConnectionPublic } from "./connections";
import { GOOGLE_FOLDER_MIME, type GoogleDriveFile } from "./types";
import { classifyGoogleApiError } from "./credentials/resolve";

export const GOOGLE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

const DRIVE_FILE_FIELDS =
  "id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress),parents,md5Checksum,size,driveId";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Bounded retry with exponential backoff for Drive/Sheets write traffic.
 */
export async function withGoogleRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; label?: string },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status =
        error instanceof GoogleConnectorError
          ? error.statusCode
          : error && typeof error === "object" && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0;
      if (!isRetryableStatus(status) || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = Math.min(8_000, 400 * 2 ** (attempt - 1));
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function resolveConnectedGoogleEmail(): Promise<string> {
  const connection = await getActiveGoogleConnectionPublic().catch(() => null);
  return connection?.google_account_email?.trim() || "baxter@actonadu.com";
}

/**
 * Map Google API failures to employee-readable step errors.
 */
export async function toEmployeeGoogleError(
  error: unknown,
  context: { resourceLabel: string },
): Promise<Error> {
  const email = await resolveConnectedGoogleEmail();
  if (error instanceof GoogleConnectorError) {
    const code = error.code;
    if (
      code === "BAXTER_GOOGLE_PERMISSION_DENIED" ||
      code === "BAXTER_GOOGLE_SHARED_DRIVE_ACCESS_DENIED" ||
      error.statusCode === 403
    ) {
      return new Error(
        `${email} lacks edit access to ${context.resourceLabel}. Grant Editor access in Google Drive, then retry.`,
      );
    }
    if (error.statusCode === 404 || code === "BAXTER_GOOGLE_FOLDER_NOT_FOUND") {
      return new Error(
        `Could not find ${context.resourceLabel}. Check the Google IDs in Project Setup settings.`,
      );
    }
    return new Error(`${context.resourceLabel}: ${error.message.slice(0, 240)}`);
  }
  if (error instanceof Error) {
    return new Error(`${context.resourceLabel}: ${error.message.slice(0, 240)}`);
  }
  return new Error(`Could not update ${context.resourceLabel}.`);
}

async function driveFetch<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    return await withGoogleRetry(() => googleFetch<T>(url, init));
  } catch (error) {
    if (error instanceof GoogleConnectorError) throw error;
    throw error;
  }
}

export async function readSheetColumn(input: {
  spreadsheetId: string;
  tabName: string;
  column: string;
}): Promise<string[][]> {
  const tab = input.tabName.replace(/'/g, "''");
  const col = input.column.trim().toUpperCase();
  const range = encodeURIComponent(`'${tab}'!${col}:${col}`);
  try {
    const valuesData = await withGoogleRetry(() =>
      googleFetch<{ values?: string[][] }>(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`,
      ),
    );
    return (valuesData.values ?? []).map((row) => row.map((cell) => String(cell ?? "").trim()));
  } catch (error) {
    throw await toEmployeeGoogleError(error, {
      resourceLabel: `the "${input.tabName}" tab`,
    });
  }
}

/** Read a sheet range with optional FORMULA render (for hyperlink idempotency checks). */
export async function readSheetValues(input: {
  spreadsheetId: string;
  tabName: string;
  /** e.g. A:Z — defaults to the whole tab used columns. */
  rangeA1?: string;
  valueRenderOption?: "FORMATTED_VALUE" | "FORMULA" | "UNFORMATTED_VALUE";
}): Promise<string[][]> {
  const tab = input.tabName.replace(/'/g, "''");
  const a1 = input.rangeA1 ?? "A:Z";
  const range = encodeURIComponent(`'${tab}'!${a1}`);
  const render = input.valueRenderOption ?? "FORMULA";
  try {
    const valuesData = await withGoogleRetry(() =>
      googleFetch<{ values?: string[][] }>(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${range}?valueRenderOption=${encodeURIComponent(render)}&majorDimension=ROWS`,
      ),
    );
    return (valuesData.values ?? []).map((row) => row.map((cell) => String(cell ?? "")));
  } catch (error) {
    throw await toEmployeeGoogleError(error, {
      resourceLabel: `the "${input.tabName}" tab`,
    });
  }
}

export async function appendSheetRow(input: {
  spreadsheetId: string;
  tabName: string;
  /** Cells for one row (A, B, C, …). */
  values: string[];
  rangeHint?: string;
}): Promise<{ updatedRange: string | null; updatedRows: number }> {
  const tab = input.tabName.replace(/'/g, "''");
  const range = encodeURIComponent(input.rangeHint ?? `'${tab}'!A:I`);
  try {
    const result = await withGoogleRetry(() =>
      googleFetch<{
        updates?: { updatedRange?: string; updatedRows?: number };
      }>(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: [input.values] }),
        },
      ),
    );
    return {
      updatedRange: result.updates?.updatedRange ?? null,
      updatedRows: result.updates?.updatedRows ?? 1,
    };
  } catch (error) {
    throw await toEmployeeGoogleError(error, {
      resourceLabel: `the Master Project Log ("${input.tabName}")`,
    });
  }
}

export async function listChildren(folderId: string): Promise<GoogleDriveFile[]> {
  const files: GoogleDriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: `files(${DRIVE_FILE_FIELDS}),nextPageToken`,
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await driveFetch<{
      files?: GoogleDriveFile[];
      nextPageToken?: string;
    }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

export async function findChildByName(
  parentId: string,
  name: string,
): Promise<GoogleDriveFile | null> {
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `'${parentId.replace(/'/g, "\\'")}' in parents and name = '${escaped}' and trashed = false`,
    fields: `files(${DRIVE_FILE_FIELDS})`,
    pageSize: "10",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const data = await driveFetch<{ files?: GoogleDriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
  );
  return data.files?.[0] ?? null;
}

export async function createFolder(input: {
  name: string;
  parentId: string;
}): Promise<GoogleDriveFile> {
  try {
    return await driveFetch<GoogleDriveFile>(
      "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=" +
        encodeURIComponent(DRIVE_FILE_FIELDS),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          mimeType: GOOGLE_FOLDER_MIME,
          parents: [input.parentId],
        }),
      },
    );
  } catch (error) {
    throw await toEmployeeGoogleError(error, {
      resourceLabel: `the destination folder parent`,
    });
  }
}

export async function copyFile(input: {
  fileId: string;
  name: string;
  parentId: string;
}): Promise<GoogleDriveFile> {
  try {
    return await driveFetch<GoogleDriveFile>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/copy?supportsAllDrives=true&fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          parents: [input.parentId],
        }),
      },
    );
  } catch (error) {
    // Annotate with classify for non-GoogleConnectorError paths
    if (!(error instanceof GoogleConnectorError) && error instanceof Error) {
      const statusMatch = error.message.match(/\((\d{3})\)/);
      const status = statusMatch ? Number(statusMatch[1]) : 502;
      const code = classifyGoogleApiError(status, error.message);
      throw await toEmployeeGoogleError(
        new GoogleConnectorError(error.message, { code, statusCode: status }),
        { resourceLabel: `file "${input.name}"` },
      );
    }
    throw await toEmployeeGoogleError(error, {
      resourceLabel: `file "${input.name}"`,
    });
  }
}

export async function getDriveFileMeta(fileId: string): Promise<GoogleDriveFile> {
  const params = new URLSearchParams({
    fields: DRIVE_FILE_FIELDS,
    supportsAllDrives: "true",
  });
  return driveFetch<GoogleDriveFile>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`,
  );
}

export type TreeCounts = { folders: number; files: number; shortcuts: number };

/** Recursively count folders / files / shortcuts under a folder. */
export async function countDriveTree(folderId: string): Promise<TreeCounts> {
  const counts: TreeCounts = { folders: 0, files: 0, shortcuts: 0 };
  const children = await listChildren(folderId);
  for (const child of children) {
    if (child.mimeType === GOOGLE_SHORTCUT_MIME) {
      counts.shortcuts += 1;
      continue;
    }
    if (child.mimeType === GOOGLE_FOLDER_MIME) {
      counts.folders += 1;
      const nested = await countDriveTree(child.id);
      counts.folders += nested.folders;
      counts.files += nested.files;
      counts.shortcuts += nested.shortcuts;
    } else {
      counts.files += 1;
    }
  }
  return counts;
}
