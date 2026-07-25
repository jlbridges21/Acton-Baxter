export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  parents?: string[];
  md5Checksum?: string;
  size?: string;
  driveId?: string;
};

export type ParsedGoogleDocument = {
  fileId: string;
  title: string;
  mimeType: string;
  webViewLink: string | null;
  modifiedTime: string | null;
  owner: string | null;
  contentText: string | null;
  contentHash: string;
  parseMode: "full_text" | "metadata_only" | "unsupported";
  folderId: string | null;
  workbook?: import("@/lib/knowledge-index/types").ParsedWorkbook;
};

export type GoogleSyncFolder = {
  id: string;
  folder_id: string;
  folder_name: string;
  drive_id: string | null;
  status: "active" | "paused" | "error";
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  indexed_document_count: number;
  last_modified_seen_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  /** Prefer this root when opening Google Workspace. */
  is_primary?: boolean;
  last_browsed_folder_id?: string | null;
  last_browsed_at?: string | null;
};
