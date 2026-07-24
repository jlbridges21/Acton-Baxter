import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

export type GoogleSyncedFileStatus =
  | "not_synced"
  | "queued"
  | "syncing"
  | "synced"
  | "unchanged"
  | "stale"
  | "failed"
  | "unsupported"
  | "excluded"
  | "access_lost"
  | "source_deleted";

export type GoogleSyncedFile = {
  id: string;
  root_id: string;
  selection_id: string | null;
  google_file_id: string;
  knowledge_entry_id: string | null;
  title: string;
  mime_type: string | null;
  web_view_link: string | null;
  drive_id: string | null;
  parent_file_ids: string[];
  modified_time: string | null;
  revision_id: string | null;
  content_hash: string | null;
  sync_status: GoogleSyncedFileStatus;
  selected_reason: string | null;
  last_discovered_at: string | null;
  last_sync_attempt_at: string | null;
  last_synced_at: string | null;
  last_error_code: string | null;
  last_error_message_safe: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

export type GoogleSyncRun = {
  id: string;
  root_id: string | null;
  trigger_source: "manual" | "cron" | "retry" | "admin";
  status: "running" | "complete" | "failed" | "partial";
  job_id: string | null;
  started_at: string;
  finished_at: string | null;
  files_discovered: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  archived_count: number;
  failed_count: number;
  skipped_count: number;
  duration_ms: number | null;
  error_summary: string | null;
  metadata: Record<string, unknown>;
};

type MemoryState = {
  files: Map<string, GoogleSyncedFile>;
  runs: Map<string, GoogleSyncRun>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterGoogleSynced?: MemoryState;
};

function getMemory(): MemoryState {
  if (!globalMemory.__baxterGoogleSynced) {
    globalMemory.__baxterGoogleSynced = { files: new Map(), runs: new Map() };
  }
  return globalMemory.__baxterGoogleSynced;
}

export function resetGoogleSyncedMemoryForTests() {
  globalMemory.__baxterGoogleSynced = { files: new Map(), runs: new Map() };
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

function fileKey(rootId: string, googleFileId: string) {
  return `${rootId}:${googleFileId}`;
}

export async function upsertSyncedFile(
  input: Partial<GoogleSyncedFile> & {
    root_id: string;
    google_file_id: string;
    title: string;
  },
): Promise<GoogleSyncedFile> {
  const now = new Date().toISOString();
  if (shouldUseMemory()) {
    const key = fileKey(input.root_id, input.google_file_id);
    const existing = Array.from(getMemory().files.values()).find(
      (f) => f.root_id === input.root_id && f.google_file_id === input.google_file_id,
    );
    const row: GoogleSyncedFile = {
      id: existing?.id ?? randomUUID(),
      root_id: input.root_id,
      selection_id: input.selection_id ?? existing?.selection_id ?? null,
      google_file_id: input.google_file_id,
      knowledge_entry_id: input.knowledge_entry_id ?? existing?.knowledge_entry_id ?? null,
      title: input.title,
      mime_type: input.mime_type ?? existing?.mime_type ?? null,
      web_view_link: input.web_view_link ?? existing?.web_view_link ?? null,
      drive_id: input.drive_id ?? existing?.drive_id ?? null,
      parent_file_ids: input.parent_file_ids ?? existing?.parent_file_ids ?? [],
      modified_time: input.modified_time ?? existing?.modified_time ?? null,
      revision_id: input.revision_id ?? existing?.revision_id ?? null,
      content_hash: input.content_hash ?? existing?.content_hash ?? null,
      sync_status: input.sync_status ?? existing?.sync_status ?? "not_synced",
      selected_reason: input.selected_reason ?? existing?.selected_reason ?? null,
      last_discovered_at: input.last_discovered_at ?? existing?.last_discovered_at ?? now,
      last_sync_attempt_at: input.last_sync_attempt_at ?? existing?.last_sync_attempt_at ?? null,
      last_synced_at: input.last_synced_at ?? existing?.last_synced_at ?? null,
      last_error_code: input.last_error_code ?? existing?.last_error_code ?? null,
      last_error_message_safe:
        input.last_error_message_safe ?? existing?.last_error_message_safe ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      metadata: input.metadata ?? existing?.metadata ?? {},
    };
    getMemory().files.set(row.id, row);
    void key;
    return row;
  }

  const supabase = createServiceClient();
  const payload = {
    root_id: input.root_id,
    selection_id: input.selection_id ?? null,
    google_file_id: input.google_file_id,
    knowledge_entry_id: input.knowledge_entry_id ?? null,
    title: input.title,
    mime_type: input.mime_type ?? null,
    web_view_link: input.web_view_link ?? null,
    drive_id: input.drive_id ?? null,
    parent_file_ids: input.parent_file_ids ?? [],
    modified_time: input.modified_time ?? null,
    revision_id: input.revision_id ?? null,
    content_hash: input.content_hash ?? null,
    sync_status: input.sync_status ?? "not_synced",
    selected_reason: input.selected_reason ?? null,
    last_discovered_at: input.last_discovered_at ?? now,
    last_sync_attempt_at: input.last_sync_attempt_at ?? null,
    last_synced_at: input.last_synced_at ?? null,
    last_error_code: input.last_error_code ?? null,
    last_error_message_safe: input.last_error_message_safe ?? null,
    metadata: input.metadata ?? {},
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("google_synced_files")
    .upsert(payload, { onConflict: "root_id,google_file_id" })
    .select("*")
    .single();
  if (error) {
    if (isMissingTable(error)) {
      return upsertSyncedFile({ ...input }); // memory fallback via shouldUseMemory next? skip
    }
    throw error;
  }
  return data as GoogleSyncedFile;
}

export async function listSyncedFilesForRoot(rootId: string): Promise<GoogleSyncedFile[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().files.values()).filter((f) => f.root_id === rootId);
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("google_synced_files")
      .select("*")
      .eq("root_id", rootId)
      .order("title", { ascending: true });
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    return (data ?? []) as GoogleSyncedFile[];
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function getSyncedFileStats() {
  const empty = {
    synced: 0,
    failed: 0,
    excluded: 0,
    unsupported: 0,
    accessLost: 0,
    pending: 0,
  };
  if (shouldUseMemory()) {
    const files = Array.from(getMemory().files.values());
    return {
      synced: files.filter((f) => f.sync_status === "synced" || f.sync_status === "unchanged")
        .length,
      failed: files.filter((f) => f.sync_status === "failed").length,
      excluded: files.filter((f) => f.sync_status === "excluded").length,
      unsupported: files.filter((f) => f.sync_status === "unsupported").length,
      accessLost: files.filter((f) => f.sync_status === "access_lost").length,
      pending: files.filter((f) =>
        ["not_synced", "queued", "syncing", "stale"].includes(f.sync_status),
      ).length,
    };
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.from("google_synced_files").select("sync_status");
    if (error) {
      if (isMissingTable(error)) return empty;
      throw error;
    }
    const files = data ?? [];
    return {
      synced: files.filter((f) => f.sync_status === "synced" || f.sync_status === "unchanged")
        .length,
      failed: files.filter((f) => f.sync_status === "failed").length,
      excluded: files.filter((f) => f.sync_status === "excluded").length,
      unsupported: files.filter((f) => f.sync_status === "unsupported").length,
      accessLost: files.filter((f) => f.sync_status === "access_lost").length,
      pending: files.filter((f) =>
        ["not_synced", "queued", "syncing", "stale"].includes(String(f.sync_status)),
      ).length,
    };
  } catch {
    return empty;
  }
}

export async function createSyncRun(input: {
  rootId?: string | null;
  triggerSource: GoogleSyncRun["trigger_source"];
  jobId?: string | null;
}): Promise<GoogleSyncRun> {
  const now = new Date().toISOString();
  const row: GoogleSyncRun = {
    id: randomUUID(),
    root_id: input.rootId ?? null,
    trigger_source: input.triggerSource,
    status: "running",
    job_id: input.jobId ?? null,
    started_at: now,
    finished_at: null,
    files_discovered: 0,
    created_count: 0,
    updated_count: 0,
    unchanged_count: 0,
    archived_count: 0,
    failed_count: 0,
    skipped_count: 0,
    duration_ms: null,
    error_summary: null,
    metadata: {},
  };

  if (shouldUseMemory()) {
    getMemory().runs.set(row.id, row);
    return row;
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("google_sync_runs")
      .insert({
        id: row.id,
        root_id: row.root_id,
        trigger_source: row.trigger_source,
        status: row.status,
        job_id: row.job_id,
        started_at: row.started_at,
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingTable(error)) {
        getMemory().runs.set(row.id, row);
        return row;
      }
      throw error;
    }
    return data as GoogleSyncRun;
  } catch (error) {
    if (isMissingTable(error)) {
      getMemory().runs.set(row.id, row);
      return row;
    }
    throw error;
  }
}

export async function completeSyncRun(runId: string, patch: Partial<GoogleSyncRun>): Promise<void> {
  const finished = new Date().toISOString();
  if (shouldUseMemory() || getMemory().runs.has(runId)) {
    const existing = getMemory().runs.get(runId);
    if (existing) {
      getMemory().runs.set(runId, {
        ...existing,
        ...patch,
        finished_at: finished,
        duration_ms:
          patch.duration_ms ??
          Math.max(0, new Date(finished).getTime() - new Date(existing.started_at).getTime()),
      });
    }
  }
  if (shouldUseMemory()) return;

  try {
    const supabase = createServiceClient();
    await supabase
      .from("google_sync_runs")
      .update({
        ...patch,
        finished_at: finished,
      })
      .eq("id", runId);
  } catch {
    // best-effort
  }
}

export async function listRecentSyncRuns(limit = 10): Promise<GoogleSyncRun[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().runs.values())
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, limit);
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("google_sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    return (data ?? []) as GoogleSyncRun[];
  } catch {
    return [];
  }
}
