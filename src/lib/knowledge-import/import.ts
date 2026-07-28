import "server-only";

import { createKnowledgeEntry, listAllKnowledgeEntriesForRetrieval } from "@/lib/knowledge/store";
import { KnowledgeError, KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/errors";
import { parseKnowledgeUpload } from "./parser";
import { findUploadByContentHash, linkUploadToEntry, storeKnowledgeUploadFile } from "./storage";
import { countWords } from "./utils";
import type { ParsedKnowledgeDocument } from "./types";

export type KnowledgeImportPreview = ParsedKnowledgeDocument & {
  contentHash: string;
  sizeBytes: number;
  wordCount: number;
  characterCount: number;
  duplicateEntryId: string | null;
  duplicateUploadId: string | null;
};

export async function previewKnowledgeUpload(input: {
  filename: string;
  buffer: Buffer;
  mimeType?: string | null;
}): Promise<KnowledgeImportPreview> {
  const parsed = await parseKnowledgeUpload(input);
  const duplicateUpload = await findUploadByContentHash(parsed.contentHash);
  let duplicateEntryId: string | null = duplicateUpload?.knowledge_entry_id ?? null;
  if (!duplicateEntryId) {
    const entries = await listAllKnowledgeEntriesForRetrieval().catch(() => []);
    const match = entries.find((entry) => {
      const meta = entry.metadata as { contentHash?: string } | null;
      return meta?.contentHash === parsed.contentHash;
    });
    duplicateEntryId = match?.id ?? null;
  }
  return {
    ...parsed,
    wordCount: countWords(parsed.content),
    characterCount: parsed.content.length,
    duplicateEntryId,
    duplicateUploadId: duplicateUpload?.id ?? null,
  };
}

export async function importKnowledgeUpload(input: {
  filename: string;
  buffer: Buffer;
  mimeType?: string | null;
  userId: string;
  title?: string | null;
  status: "draft" | "approved";
  category?: string | null;
  tags?: string[];
  allowEmpty?: boolean;
  allowDuplicate?: boolean;
}): Promise<{ entryId: string; uploadId: string; warnings: string[] }> {
  const preview = await previewKnowledgeUpload({
    filename: input.filename,
    buffer: input.buffer,
    mimeType: input.mimeType,
  });

  if (preview.duplicateEntryId && !input.allowDuplicate) {
    throw new KnowledgeError(
      "This file already exists in Baxter. Open the existing entry or skip this upload.",
      KNOWLEDGE_ERROR_CODES.UPLOAD_DUPLICATE,
      { statusCode: 409 },
    );
  }

  if (preview.extractionStatus === "failed" || preview.extractionStatus === "unsupported") {
    throw new KnowledgeError(
      preview.warnings[0] ??
        "Baxter couldn't read this file. Please try again or upload another copy.",
      KNOWLEDGE_ERROR_CODES.UPLOAD_PARSE_FAILED,
      { statusCode: 422 },
    );
  }

  if ((!preview.content.trim() || preview.extractionStatus === "empty") && !input.allowEmpty) {
    throw new KnowledgeError(
      preview.warnings[0] ??
        "This appears to be a scanned or image-only PDF. Baxter couldn't find a readable text layer.",
      KNOWLEDGE_ERROR_CODES.UPLOAD_EMPTY,
      { statusCode: 422 },
    );
  }

  const upload = await storeKnowledgeUploadFile({
    filename: input.filename,
    buffer: input.buffer,
    mimeType: preview.mimeType,
    extension: preview.extension,
    contentHash: preview.contentHash,
    extractionStatus: preview.extractionStatus,
    warnings: preview.warnings,
    extractedCharacterCount: preview.characterCount,
    userId: input.userId,
    metadata: preview.metadata,
  });

  const emptyPlaceholder =
    preview.extension === "pdf"
      ? "[No selectable text was found in this PDF. OCR for scanned PDFs is not enabled yet.]"
      : "[No extractable text was found in this file.]";

  const entry = await createKnowledgeEntry(
    {
      title: (input.title?.trim() || preview.title).slice(0, 300),
      content: preview.content.trim() ? preview.content : emptyPlaceholder,
      summary: preview.summary ?? null,
      category: input.category?.trim() || "General",
      tags: input.tags ?? ["uploaded"],
      source_name: input.filename,
      source_type: "uploaded_document",
      source_url: null,
      visibility: "internal",
      status: input.status,
    },
    input.userId,
  );

  // Attach upload metadata onto the entry without requiring a separate update API for hash.
  try {
    const { patchKnowledgeEntrySyncFields } = await import("@/lib/knowledge/store");
    await patchKnowledgeEntrySyncFields(entry.id, {
      metadata: {
        ...(entry.metadata ?? {}),
        uploaded: true,
        contentHash: preview.contentHash,
        uploadId: upload.id,
        originalFilename: input.filename,
        mimeType: preview.mimeType,
        storageBucket: upload.storage_bucket,
        storagePath: upload.storage_path,
        extractionStatus: preview.extractionStatus,
        extractionWarnings: preview.warnings,
        ...(preview.metadata ?? {}),
      },
    });
  } catch {
    // patch helper may be unavailable in older stores; entry still created
  }

  await linkUploadToEntry(upload.id, entry.id);
  return { entryId: entry.id, uploadId: upload.id, warnings: preview.warnings };
}
