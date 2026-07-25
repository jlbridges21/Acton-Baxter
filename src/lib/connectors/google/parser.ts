import "server-only";

import { createHash } from "node:crypto";
import { downloadDriveFileBytes, exportDriveFile } from "./drive";
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
const CSV_MIME = "text/csv";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

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
    mimeType === CSV_MIME ||
    mimeType === XLSX_MIME ||
    mimeType === XLS_MIME ||
    mimeType.startsWith("text/")
  );
}

/**
 * Parse a Drive file into searchable text when possible.
 * Binary Office/PDF/CSV/XLSX: download bytes and reuse Knowledge Import parsers.
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
    const { exportGoogleSheetStructured } = await import("./sheets");
    const structured = await exportGoogleSheetStructured(file.id);
    return {
      ...base,
      contentText: structured.contentText,
      contentHash: hashContent(structured.contentText),
      parseMode: "full_text",
    };
  }

  if (
    file.mimeType === TEXT_MIME ||
    file.mimeType === MARKDOWN_MIME ||
    file.mimeType.startsWith("text/")
  ) {
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

  if (
    file.mimeType === XLSX_MIME ||
    file.mimeType === XLS_MIME ||
    file.mimeType === CSV_MIME ||
    file.mimeType === PDF_MIME ||
    file.mimeType === DOCX_MIME
  ) {
    try {
      const buffer = await downloadDriveFileBytes(file.id);
      const { parseKnowledgeUpload } = await import("@/lib/knowledge-import/parser");
      const filename = file.name.includes(".")
        ? file.name
        : `${file.name}${
            file.mimeType === XLSX_MIME || file.mimeType === XLS_MIME
              ? ".xlsx"
              : file.mimeType === CSV_MIME
                ? ".csv"
                : file.mimeType === PDF_MIME
                  ? ".pdf"
                  : ".docx"
          }`;
      const parsed = await parseKnowledgeUpload({
        filename,
        buffer,
        mimeType: file.mimeType,
      });
      return {
        ...base,
        contentText: parsed.content,
        contentHash: parsed.contentHash || hashContent(parsed.content),
        parseMode: "full_text",
      };
    } catch (error) {
      const stub = [
        `Title: ${file.name}`,
        `Type: ${file.mimeType}`,
        "Content extraction failed. Open the original file for full content.",
        file.webViewLink ? `URL: ${file.webViewLink}` : "",
        error instanceof Error ? `Error: ${error.message.slice(0, 200)}` : "",
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
  if (mimeType === GOOGLE_DOC_MIME) return "Open Google Doc";
  if (mimeType === GOOGLE_SHEET_MIME) return "Open Google Sheet";
  if (mimeType === XLSX_MIME || mimeType === XLS_MIME) return "Open spreadsheet";
  if (mimeType === PDF_MIME) return "Open PDF";
  return "Open Google File";
}
