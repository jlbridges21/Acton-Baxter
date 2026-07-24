import "server-only";

import { createHash } from "node:crypto";
import { exportDriveFile } from "./drive";
import {
  GOOGLE_DOC_MIME,
  GOOGLE_SHEET_MIME,
  type GoogleDriveFile,
  type ParsedGoogleDocument,
} from "./types";

const PDF_MIME = "application/pdf";
const TEXT_MIME = "text/plain";
const MARKDOWN_MIME = "text/markdown";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function isSupportedGoogleMime(mimeType: string): boolean {
  return (
    mimeType === GOOGLE_DOC_MIME ||
    mimeType === GOOGLE_SHEET_MIME ||
    mimeType === TEXT_MIME ||
    mimeType === MARKDOWN_MIME ||
    mimeType === PDF_MIME ||
    mimeType === DOCX_MIME ||
    mimeType.startsWith("text/")
  );
}

/**
 * Parse a Drive file into searchable text when possible.
 * PDF: metadata only. DOCX: prepared/metadata only (no binary parse yet).
 */
export async function parseGoogleDriveFile(
  file: GoogleDriveFile,
  folderId: string | null,
): Promise<ParsedGoogleDocument> {
  const owner = file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || null;
  const base = {
    fileId: file.id,
    title: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink ?? null,
    modifiedTime: file.modifiedTime ?? null,
    owner,
    folderId,
  };

  if (file.mimeType === GOOGLE_DOC_MIME) {
    const contentText = await exportDriveFile(file.id, "text/plain");
    return {
      ...base,
      contentText,
      contentHash: hashContent(contentText),
      parseMode: "full_text",
    };
  }

  if (file.mimeType === GOOGLE_SHEET_MIME) {
    const contentText = await exportDriveFile(file.id, "text/csv");
    return {
      ...base,
      contentText,
      contentHash: hashContent(contentText),
      parseMode: "full_text",
    };
  }

  if (
    file.mimeType === TEXT_MIME ||
    file.mimeType === MARKDOWN_MIME ||
    file.mimeType.startsWith("text/")
  ) {
    // Plain text downloads use alt=media
    const { googleFetch } = await import("./auth");
    const contentText = await googleFetch<string>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
      { rawText: true },
    );
    return {
      ...base,
      contentText,
      contentHash: hashContent(contentText),
      parseMode: "full_text",
    };
  }

  if (file.mimeType === PDF_MIME || file.mimeType === DOCX_MIME) {
    const stub = [
      `Title: ${file.name}`,
      `Type: ${file.mimeType === PDF_MIME ? "PDF" : "Word document"}`,
      "Content extraction is not enabled yet. Open the original file for full content.",
      file.webViewLink ? `URL: ${file.webViewLink}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      ...base,
      contentText: stub,
      contentHash: hashContent(`${file.id}:${file.modifiedTime ?? ""}:${file.md5Checksum ?? ""}`),
      parseMode: "metadata_only",
    };
  }

  return {
    ...base,
    contentText: null,
    contentHash: hashContent(`${file.id}:${file.mimeType}:${file.modifiedTime ?? ""}`),
    parseMode: "unsupported",
  };
}

export function googleSourceKind(mimeType: string): "google_doc" | "google_sheet" | "google_file" {
  if (mimeType === GOOGLE_DOC_MIME) return "google_doc";
  if (mimeType === GOOGLE_SHEET_MIME) return "google_sheet";
  return "google_file";
}

export function googleOpenLabel(mimeType: string): string {
  if (mimeType === GOOGLE_DOC_MIME) return "Open Document";
  if (mimeType === GOOGLE_SHEET_MIME) return "Open Spreadsheet";
  if (mimeType === PDF_MIME) return "Open PDF";
  return "Open File";
}
