import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import type { GoogleSyncFolder } from "./types";

type MemoryState = {
  folders: Map<string, GoogleSyncFolder>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterGoogleFoldersMemory?: MemoryState;
};

function getMemory(): MemoryState {
  if (!globalMemory.__baxterGoogleFoldersMemory) {
    globalMemory.__baxterGoogleFoldersMemory = { folders: new Map() };
  }
  return globalMemory.__baxterGoogleFoldersMemory;
}

export function resetGoogleFoldersMemoryForTests() {
  globalMemory.__baxterGoogleFoldersMemory = { folders: new Map() };
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
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

function nowIso() {
  return new Date().toISOString();
}

export async function listGoogleSyncFolders(): Promise<GoogleSyncFolder[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().folders.values()).sort((a, b) =>
      a.folder_name.localeCompare(b.folder_name),
    );
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("google_sync_folders")
    .select("*")
    .order("folder_name");
  if (error) {
    if (isMissingTable(error)) return Array.from(getMemory().folders.values());
    throw error;
  }
  return (data as GoogleSyncFolder[]) ?? [];
}

export async function addGoogleSyncFolder(input: {
  folderId: string;
  folderName: string;
  driveId?: string | null;
  userId: string;
}): Promise<GoogleSyncFolder> {
  const folder: GoogleSyncFolder = {
    id: randomUUID(),
    folder_id: input.folderId,
    folder_name: input.folderName,
    drive_id: input.driveId ?? null,
    status: "active",
    last_sync_at: null,
    last_success_at: null,
    last_error: null,
    indexed_document_count: 0,
    last_modified_seen_at: null,
    created_by: input.userId,
    created_at: nowIso(),
    updated_at: nowIso(),
    metadata: {},
  };

  if (shouldUseMemory()) {
    getMemory().folders.set(folder.id, folder);
    return folder;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("google_sync_folders")
    .insert({
      id: folder.id,
      folder_id: folder.folder_id,
      folder_name: folder.folder_name,
      drive_id: folder.drive_id,
      status: folder.status,
      created_by: folder.created_by,
      metadata: {},
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingTable(error)) {
      getMemory().folders.set(folder.id, folder);
      return folder;
    }
    throw error;
  }
  return data as GoogleSyncFolder;
}

export async function updateGoogleSyncFolder(
  id: string,
  patch: Partial<
    Pick<
      GoogleSyncFolder,
      | "status"
      | "last_sync_at"
      | "last_success_at"
      | "last_error"
      | "indexed_document_count"
      | "last_modified_seen_at"
      | "folder_name"
    >
  >,
): Promise<GoogleSyncFolder | null> {
  if (shouldUseMemory() || getMemory().folders.has(id)) {
    const existing = getMemory().folders.get(id);
    if (existing) {
      const updated = { ...existing, ...patch, updated_at: nowIso() };
      getMemory().folders.set(id, updated);
      if (shouldUseMemory()) return updated;
    }
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("google_sync_folders")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return getMemory().folders.get(id) ?? null;
    throw error;
  }
  return (data as GoogleSyncFolder | null) ?? null;
}

export async function removeGoogleSyncFolder(id: string): Promise<void> {
  getMemory().folders.delete(id);
  if (shouldUseMemory()) return;
  const supabase = createServiceClient();
  const { error } = await supabase.from("google_sync_folders").delete().eq("id", id);
  if (error && !isMissingTable(error)) throw error;
}

export async function getGoogleSyncFolder(id: string): Promise<GoogleSyncFolder | null> {
  if (shouldUseMemory()) return getMemory().folders.get(id) ?? null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("google_sync_folders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return getMemory().folders.get(id) ?? null;
    throw error;
  }
  return (data as GoogleSyncFolder | null) ?? null;
}
