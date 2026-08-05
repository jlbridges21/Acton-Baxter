import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { GoogleConnectorError } from "./errors";
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
  // Read process.env directly — vi.resetModules() in unit tests can leave
  // getEnv() bound to a stale module instance whose cache was not cleared.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (url.includes("127.0.0.1") || url.includes("example.supabase")) return true;
  if (anon === "anon" || anon.startsWith("test-")) return true;
  if ((process.env.E2E_TEST_AUTH_BYPASS ?? "").toLowerCase() === "true") return true;
  const mock = (process.env.ENABLE_MOCK_RESEARCH ?? "true").toLowerCase();
  if (mock === "true" || mock === "1") {
    return process.env.NODE_ENV !== "production";
  }
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

export async function getPrimaryGoogleSyncFolder(): Promise<GoogleSyncFolder | null> {
  const folders = await listGoogleSyncFolders();
  return (
    folders.find((f) => f.is_primary && f.status === "active") ??
    folders.find((f) => f.status === "active") ??
    folders[0] ??
    null
  );
}

async function clearOtherPrimaries(exceptId: string): Promise<void> {
  const folders = await listGoogleSyncFolders();
  for (const folder of folders) {
    if (folder.id === exceptId || !folder.is_primary) continue;
    await updateGoogleSyncFolder(folder.id, { is_primary: false });
  }
}

export async function addGoogleSyncFolder(input: {
  folderId: string;
  folderName: string;
  driveId?: string | null;
  userId: string;
  makePrimary?: boolean;
}): Promise<GoogleSyncFolder> {
  const existing = (await listGoogleSyncFolders()).find((f) => f.folder_id === input.folderId);
  if (existing) {
    const makePrimary = input.makePrimary !== false;
    if (makePrimary && !existing.is_primary) {
      await clearOtherPrimaries(existing.id);
      return (
        (await updateGoogleSyncFolder(existing.id, {
          is_primary: true,
          status: "active",
          folder_name: input.folderName || existing.folder_name,
        })) ?? existing
      );
    }
    // Friendly reuse — do not throw INTERNAL_ERROR on unique violation
    return existing;
  }

  const makePrimary = input.makePrimary !== false;
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
    is_primary: makePrimary,
    last_browsed_folder_id: null,
    last_browsed_at: null,
  };

  if (shouldUseMemory()) {
    if (makePrimary) {
      for (const [id, row] of getMemory().folders) {
        if (row.is_primary) getMemory().folders.set(id, { ...row, is_primary: false });
      }
    }
    getMemory().folders.set(folder.id, folder);
    return folder;
  }

  const supabase = createServiceClient();
  if (makePrimary) {
    await supabase.from("google_sync_folders").update({ is_primary: false }).eq("is_primary", true);
  }

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
      is_primary: folder.is_primary ?? false,
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingTable(error)) {
      getMemory().folders.set(folder.id, folder);
      return folder;
    }
    // Unique folder_id race
    if (error.code === "23505" || (error.message ?? "").toLowerCase().includes("duplicate")) {
      const again = (await listGoogleSyncFolders()).find((f) => f.folder_id === input.folderId);
      if (again) return again;
      throw new GoogleConnectorError("This Shared Drive is already connected.", {
        code: "GOOGLE_ROOT_ALREADY_CONNECTED",
        statusCode: 409,
        expose: true,
        cause: error,
      });
    }
    throw new GoogleConnectorError("Baxter could not connect this Drive. Try again.", {
      code: "GOOGLE_ROOT_CONNECT_FAILED",
      statusCode: 502,
      expose: true,
      cause: error,
    });
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
      | "is_primary"
      | "last_browsed_folder_id"
      | "last_browsed_at"
    >
  >,
): Promise<GoogleSyncFolder | null> {
  if (shouldUseMemory() || getMemory().folders.has(id)) {
    const existing = getMemory().folders.get(id);
    if (existing) {
      if (patch.is_primary) {
        for (const [otherId, row] of getMemory().folders) {
          if (otherId !== id && row.is_primary) {
            getMemory().folders.set(otherId, { ...row, is_primary: false });
          }
        }
      }
      const updated = { ...existing, ...patch, updated_at: nowIso() };
      getMemory().folders.set(id, updated);
      if (shouldUseMemory()) return updated;
    }
  }

  const supabase = createServiceClient();
  if (patch.is_primary) {
    await supabase
      .from("google_sync_folders")
      .update({ is_primary: false })
      .neq("id", id)
      .eq("is_primary", true);
  }
  const { data, error } = await supabase
    .from("google_sync_folders")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return getMemory().folders.get(id) ?? null;
    // Columns from migration 015 may be missing — retry without extended fields
    if (
      patch.is_primary !== undefined ||
      patch.last_browsed_folder_id !== undefined ||
      patch.last_browsed_at !== undefined
    ) {
      const { is_primary: _p, last_browsed_folder_id: _f, last_browsed_at: _a, ...rest } = patch;
      void _p;
      void _f;
      void _a;
      if (Object.keys(rest).length === 0) {
        return getMemory().folders.get(id) ?? null;
      }
      const retry = await supabase
        .from("google_sync_folders")
        .update({ ...rest, updated_at: nowIso() })
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (!retry.error) return (retry.data as GoogleSyncFolder | null) ?? null;
    }
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
