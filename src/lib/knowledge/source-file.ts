import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { getKnowledgeEntry } from "@/lib/knowledge/queries";
import { KnowledgeError, KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/errors";
import {
  createSignedUploadUrl,
  findUploadById,
  listUploadsForEntry,
  type KnowledgeUploadRecord,
} from "@/lib/knowledge-import/storage";
import { KNOWLEDGE_UPLOAD_BUCKET } from "@/lib/knowledge-import/types";

export type KnowledgeSourceFileKind = "upload_pdf" | "google_pdf" | "none";

export type KnowledgeSourceFileInfo = {
  kind: KnowledgeSourceFileKind;
  mimeType: string | null;
  originalFilename: string | null;
  /** Short-lived URL for iframe (upload signed URL or Drive preview). */
  viewUrl: string | null;
  /** External open target (signed download or Google webViewLink). */
  openUrl: string | null;
  googleFileId: string | null;
  uploadId: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  available: boolean;
  unavailableReason: string | null;
};

const SIGNED_URL_TTL_SECONDS = 120;

export function isPdfKnowledgeEntry(input: {
  mimeType?: string | null;
  filename?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  const meta = input.metadata ?? {};
  const googleMime = String((meta.google as { mimeType?: string } | undefined)?.mimeType ?? "");
  const mime = String(input.mimeType ?? meta.mimeType ?? googleMime ?? "").toLowerCase();
  const filename = String(
    input.filename ?? meta.originalFilename ?? meta.source_name ?? "",
  ).toLowerCase();
  if (mime === "application/pdf" || mime.includes("pdf")) return true;
  if (filename.endsWith(".pdf")) return true;
  if (Array.isArray(meta.pdfPages)) return true;
  return false;
}

function googlePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}

/**
 * Resolve how to view the original PDF for a Knowledge entry (admin-only callers).
 * Never embeds binary into knowledge content — only short-lived / external URLs.
 */
export async function resolveKnowledgeSourceFile(
  entryId: string,
): Promise<KnowledgeSourceFileInfo> {
  const entry = await getKnowledgeEntry(entryId);
  if (!entry) {
    throw new KnowledgeError("Knowledge entry not found", KNOWLEDGE_ERROR_CODES.NOT_FOUND, {
      statusCode: 404,
    });
  }

  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const mimeType =
    typeof meta.mimeType === "string"
      ? meta.mimeType
      : typeof (meta.google as { mimeType?: string } | undefined)?.mimeType === "string"
        ? (meta.google as { mimeType: string }).mimeType
        : null;
  const originalFilename =
    typeof meta.originalFilename === "string"
      ? meta.originalFilename
      : entry.source_name || entry.title;

  const pdf = isPdfKnowledgeEntry({
    mimeType,
    filename: originalFilename,
    sourceUrl: entry.source_url,
    metadata: meta,
  });

  if (!pdf) {
    return {
      kind: "none",
      mimeType,
      originalFilename,
      viewUrl: null,
      openUrl: null,
      googleFileId: null,
      uploadId: null,
      storageBucket: null,
      storagePath: null,
      available: false,
      unavailableReason: "This entry is not a PDF source.",
    };
  }

  const isGoogle =
    entry.source_type === "Google Drive" || Boolean(meta.googleManaged) || Boolean(meta.google);

  if (isGoogle) {
    const fileId =
      entry.source_external_id ||
      (typeof (meta.google as { fileId?: string } | undefined)?.fileId === "string"
        ? (meta.google as { fileId: string }).fileId
        : null);
    const openUrl = entry.source_url;
    if (!fileId && !openUrl) {
      return {
        kind: "google_pdf",
        mimeType: mimeType ?? "application/pdf",
        originalFilename,
        viewUrl: null,
        openUrl: null,
        googleFileId: null,
        uploadId: null,
        storageBucket: null,
        storagePath: null,
        available: false,
        unavailableReason:
          "Original PDF unavailable. Baxter still has the previously extracted text for this version.",
      };
    }
    return {
      kind: "google_pdf",
      mimeType: mimeType ?? "application/pdf",
      originalFilename,
      viewUrl: fileId ? googlePreviewUrl(fileId) : openUrl,
      openUrl: openUrl ?? (fileId ? `https://drive.google.com/file/d/${fileId}/view` : null),
      googleFileId: fileId,
      uploadId: null,
      storageBucket: null,
      storagePath: null,
      available: Boolean(fileId || openUrl),
      unavailableReason: null,
    };
  }

  // Manual upload path
  const uploadId = typeof meta.uploadId === "string" ? meta.uploadId : null;
  let upload: KnowledgeUploadRecord | null = null;
  if (uploadId) {
    upload = await findUploadById(uploadId);
  }
  if (!upload) {
    const linked = await listUploadsForEntry(entryId);
    upload = linked.find((row) => row.mime_type === "application/pdf") ?? linked[0] ?? null;
  }

  if (!upload) {
    return {
      kind: "upload_pdf",
      mimeType: mimeType ?? "application/pdf",
      originalFilename,
      viewUrl: null,
      openUrl: null,
      googleFileId: null,
      uploadId,
      storageBucket:
        typeof meta.storageBucket === "string" ? meta.storageBucket : KNOWLEDGE_UPLOAD_BUCKET,
      storagePath: typeof meta.storagePath === "string" ? meta.storagePath : null,
      available: false,
      unavailableReason:
        "Original PDF unavailable. Baxter still has the previously extracted text for this version.",
    };
  }

  // Ensure the upload belongs to this entry (or is unlinked but referenced by metadata).
  if (upload.knowledge_entry_id && upload.knowledge_entry_id !== entryId) {
    throw new KnowledgeError(
      "Upload does not belong to this Knowledge entry.",
      KNOWLEDGE_ERROR_CODES.UPLOAD_PARSE_FAILED,
      { statusCode: 403 },
    );
  }

  const signed = await createSignedUploadUrl(upload.id, SIGNED_URL_TTL_SECONDS);
  // In mock/memory mode signed URLs are null — use authenticated stream endpoint instead.
  const streamPath = `/api/admin/knowledge/${entryId}/source-file?mode=stream`;

  return {
    kind: "upload_pdf",
    mimeType: upload.mime_type || mimeType || "application/pdf",
    originalFilename: upload.original_filename || originalFilename,
    viewUrl: signed ?? streamPath,
    openUrl: signed ?? streamPath,
    googleFileId: null,
    uploadId: upload.id,
    storageBucket: upload.storage_bucket,
    storagePath: upload.storage_path,
    available: true,
    unavailableReason: null,
  };
}

/**
 * Load PDF bytes for an upload linked to this entry (service-role; admin-gated by caller).
 */
export async function loadUploadPdfBytes(entryId: string): Promise<{
  bytes: Buffer;
  mimeType: string;
  filename: string;
} | null> {
  const info = await resolveKnowledgeSourceFile(entryId);
  if (info.kind !== "upload_pdf" || !info.uploadId) return null;

  const upload = await findUploadById(info.uploadId);
  if (!upload) return null;
  if (upload.knowledge_entry_id && upload.knowledge_entry_id !== entryId) return null;

  if (upload.bytes && upload.bytes.byteLength > 0) {
    return {
      bytes: upload.bytes,
      mimeType: upload.mime_type || "application/pdf",
      filename: upload.original_filename,
    };
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(upload.storage_bucket)
    .download(upload.storage_path);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  return {
    bytes: buffer,
    mimeType: upload.mime_type || "application/pdf",
    filename: upload.original_filename,
  };
}
