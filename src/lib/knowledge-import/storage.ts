import "server-only";

import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { KnowledgeError, KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/errors";
import { KNOWLEDGE_UPLOAD_BUCKET } from "./types";

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

type MemoryUpload = {
  id: string;
  knowledge_entry_id: string | null;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  extension: string | null;
  size_bytes: number;
  content_hash: string;
  extraction_status: string;
  extraction_warnings: string[];
  extracted_character_count: number | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  bytes?: Buffer;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterKnowledgeUploads?: Map<string, MemoryUpload>;
};

function getMemory() {
  if (!globalMemory.__baxterKnowledgeUploads) {
    globalMemory.__baxterKnowledgeUploads = new Map();
  }
  return globalMemory.__baxterKnowledgeUploads;
}

export function resetKnowledgeUploadsMemoryForTests() {
  globalMemory.__baxterKnowledgeUploads = new Map();
}

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  const message = (record.message ?? "").toLowerCase();
  return (
    record.code === "42P01" ||
    record.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

export async function storeKnowledgeUploadFile(input: {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  extension: string;
  contentHash: string;
  extractionStatus: string;
  warnings: string[];
  extractedCharacterCount: number;
  userId: string;
  metadata?: Record<string, unknown>;
}): Promise<MemoryUpload> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  const storagePath = `${input.userId}/${id}-${safeName}`;

  const row: MemoryUpload = {
    id,
    knowledge_entry_id: null,
    storage_bucket: KNOWLEDGE_UPLOAD_BUCKET,
    storage_path: storagePath,
    original_filename: input.filename,
    mime_type: input.mimeType,
    extension: input.extension,
    size_bytes: input.buffer.byteLength,
    content_hash: input.contentHash,
    extraction_status: input.extractionStatus,
    extraction_warnings: input.warnings,
    extracted_character_count: input.extractedCharacterCount,
    uploaded_by: input.userId,
    created_at: now,
    updated_at: now,
    metadata: input.metadata ?? {},
    bytes: input.buffer,
  };

  if (shouldUseMemory()) {
    getMemory().set(id, row);
    return row;
  }

  const supabase = createServiceClient();
  const { error: uploadError } = await supabase.storage
    .from(KNOWLEDGE_UPLOAD_BUCKET)
    .upload(storagePath, input.buffer, {
      contentType: input.mimeType,
      upsert: false,
    });
  if (uploadError) {
    throw new KnowledgeError(
      "The original file could not be stored. Confirm the knowledge-uploads bucket exists.",
      KNOWLEDGE_ERROR_CODES.UPLOAD_STORAGE_FAILED,
      { statusCode: 502, cause: uploadError },
    );
  }

  const { data, error } = await supabase
    .from("knowledge_uploads")
    .insert({
      id: row.id,
      knowledge_entry_id: null,
      storage_bucket: row.storage_bucket,
      storage_path: row.storage_path,
      original_filename: row.original_filename,
      mime_type: row.mime_type,
      extension: row.extension,
      size_bytes: row.size_bytes,
      content_hash: row.content_hash,
      extraction_status: row.extraction_status,
      extraction_warnings: row.extraction_warnings,
      extracted_character_count: row.extracted_character_count,
      uploaded_by: row.uploaded_by,
      metadata: row.metadata,
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingTable(error)) {
      getMemory().set(id, row);
      return row;
    }
    throw new KnowledgeError(
      "Upload metadata could not be saved.",
      KNOWLEDGE_ERROR_CODES.UPLOAD_STORAGE_FAILED,
      { statusCode: 502, cause: error },
    );
  }
  return data as MemoryUpload;
}

export async function findUploadByContentHash(contentHash: string): Promise<MemoryUpload | null> {
  if (shouldUseMemory()) {
    return (
      Array.from(getMemory().values()).find(
        (row) => row.content_hash === contentHash && row.extraction_status !== "deleted",
      ) ?? null
    );
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("knowledge_uploads")
      .select("*")
      .eq("content_hash", contentHash)
      .neq("extraction_status", "deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return null;
      throw error;
    }
    return (data as MemoryUpload | null) ?? null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

export async function linkUploadToEntry(uploadId: string, entryId: string): Promise<void> {
  if (shouldUseMemory()) {
    const existing = getMemory().get(uploadId);
    if (existing) {
      getMemory().set(uploadId, {
        ...existing,
        knowledge_entry_id: entryId,
        extraction_status: "imported",
        updated_at: new Date().toISOString(),
      });
    }
    return;
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("knowledge_uploads")
    .update({
      knowledge_entry_id: entryId,
      extraction_status: "imported",
      updated_at: new Date().toISOString(),
    })
    .eq("id", uploadId);
  if (error && !isMissingTable(error)) throw error;
}

export async function listUploadsForEntry(entryId: string): Promise<MemoryUpload[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().values()).filter((row) => row.knowledge_entry_id === entryId);
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("knowledge_uploads")
      .select("*")
      .eq("knowledge_entry_id", entryId);
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    return (data as MemoryUpload[]) ?? [];
  } catch {
    return [];
  }
}

export async function deleteUploadsForEntry(entryId: string): Promise<void> {
  const uploads = await listUploadsForEntry(entryId);
  if (shouldUseMemory()) {
    for (const upload of uploads) getMemory().delete(upload.id);
    return;
  }
  const supabase = createServiceClient();
  for (const upload of uploads) {
    const { error: storageError } = await supabase.storage
      .from(upload.storage_bucket)
      .remove([upload.storage_path]);
    if (storageError) {
      throw new KnowledgeError(
        "The entry metadata could be removed, but deleting the stored file failed.",
        KNOWLEDGE_ERROR_CODES.STORAGE_DELETE_FAILED,
        { statusCode: 502, cause: storageError },
      );
    }
    const { error } = await supabase.from("knowledge_uploads").delete().eq("id", upload.id);
    if (error && !isMissingTable(error)) {
      throw new KnowledgeError(
        "Stored file cleanup failed.",
        KNOWLEDGE_ERROR_CODES.STORAGE_DELETE_FAILED,
        { statusCode: 502, cause: error },
      );
    }
  }
}

export async function createSignedUploadUrl(
  uploadId: string,
  expiresInSeconds = 120,
): Promise<string | null> {
  if (shouldUseMemory()) return null;
  const supabase = createServiceClient();
  const { data: row, error } = await supabase
    .from("knowledge_uploads")
    .select("storage_bucket, storage_path")
    .eq("id", uploadId)
    .maybeSingle();
  if (error || !row) return null;
  const { data, error: signedError } = await supabase.storage
    .from(row.storage_bucket)
    .createSignedUrl(row.storage_path, expiresInSeconds);
  if (signedError) return null;
  return data.signedUrl;
}
