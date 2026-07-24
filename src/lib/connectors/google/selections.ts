import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

export type GoogleSourceSelection = {
  id: string;
  root_id: string;
  google_file_id: string;
  selection_type: "file" | "folder";
  recursive: boolean;
  include_future_files: boolean;
  explicitly_excluded: boolean;
  enabled: boolean;
  title_snapshot: string | null;
  mime_type: string | null;
  drive_id: string | null;
  parent_file_id: string | null;
  default_category: string | null;
  default_tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

type MemoryState = {
  selections: Map<string, GoogleSourceSelection>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterGoogleSelections?: MemoryState;
};

function getMemory(): MemoryState {
  if (!globalMemory.__baxterGoogleSelections) {
    globalMemory.__baxterGoogleSelections = { selections: new Map() };
  }
  return globalMemory.__baxterGoogleSelections;
}

export function resetGoogleSelectionsMemoryForTests() {
  globalMemory.__baxterGoogleSelections = { selections: new Map() };
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

export async function listSelectionsForRoot(rootId: string): Promise<GoogleSourceSelection[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().selections.values()).filter((s) => s.root_id === rootId);
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("google_source_selections")
      .select("*")
      .eq("root_id", rootId)
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    return (data ?? []) as GoogleSourceSelection[];
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function listAllEnabledSelections(): Promise<GoogleSourceSelection[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().selections.values()).filter((s) => s.enabled);
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("google_source_selections")
      .select("*")
      .eq("enabled", true);
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    return (data ?? []) as GoogleSourceSelection[];
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function upsertSelection(input: {
  rootId: string;
  googleFileId: string;
  selectionType: "file" | "folder";
  recursive?: boolean;
  includeFutureFiles?: boolean;
  explicitlyExcluded?: boolean;
  enabled?: boolean;
  titleSnapshot?: string | null;
  mimeType?: string | null;
  driveId?: string | null;
  parentFileId?: string | null;
  defaultCategory?: string | null;
  defaultTags?: string[];
  userId?: string | null;
}): Promise<GoogleSourceSelection> {
  const now = new Date().toISOString();
  const row: GoogleSourceSelection = {
    id: randomUUID(),
    root_id: input.rootId,
    google_file_id: input.googleFileId,
    selection_type: input.selectionType,
    recursive: input.recursive ?? true,
    include_future_files: input.includeFutureFiles ?? true,
    explicitly_excluded: input.explicitlyExcluded ?? false,
    enabled: input.enabled ?? true,
    title_snapshot: input.titleSnapshot ?? null,
    mime_type: input.mimeType ?? null,
    drive_id: input.driveId ?? null,
    parent_file_id: input.parentFileId ?? null,
    default_category: input.defaultCategory ?? null,
    default_tags: input.defaultTags ?? [],
    created_by: input.userId ?? null,
    created_at: now,
    updated_at: now,
    metadata: {},
  };

  if (shouldUseMemory()) {
    const existing = Array.from(getMemory().selections.values()).find(
      (s) =>
        s.root_id === input.rootId &&
        s.google_file_id === input.googleFileId &&
        s.explicitly_excluded === row.explicitly_excluded,
    );
    if (existing) {
      const updated = { ...existing, ...row, id: existing.id, created_at: existing.created_at };
      getMemory().selections.set(existing.id, updated);
      return updated;
    }
    getMemory().selections.set(row.id, row);
    return row;
  }

  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from("google_source_selections")
    .select("*")
    .eq("root_id", input.rootId)
    .eq("google_file_id", input.googleFileId)
    .eq("explicitly_excluded", row.explicitly_excluded)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("google_source_selections")
      .update({
        selection_type: row.selection_type,
        recursive: row.recursive,
        include_future_files: row.include_future_files,
        enabled: row.enabled,
        title_snapshot: row.title_snapshot,
        mime_type: row.mime_type,
        drive_id: row.drive_id,
        parent_file_id: row.parent_file_id,
        default_category: row.default_category,
        default_tags: row.default_tags,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as GoogleSourceSelection;
  }

  const { data, error } = await supabase
    .from("google_source_selections")
    .insert({
      id: row.id,
      root_id: row.root_id,
      google_file_id: row.google_file_id,
      selection_type: row.selection_type,
      recursive: row.recursive,
      include_future_files: row.include_future_files,
      explicitly_excluded: row.explicitly_excluded,
      enabled: row.enabled,
      title_snapshot: row.title_snapshot,
      mime_type: row.mime_type,
      drive_id: row.drive_id,
      parent_file_id: row.parent_file_id,
      default_category: row.default_category,
      default_tags: row.default_tags,
      created_by: row.created_by,
      metadata: {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as GoogleSourceSelection;
}

export async function removeSelection(selectionId: string): Promise<void> {
  if (shouldUseMemory()) {
    getMemory().selections.delete(selectionId);
    return;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from("google_source_selections").delete().eq("id", selectionId);
  if (error && !isMissingTable(error)) throw error;
}

export async function setSelectionEnabled(selectionId: string, enabled: boolean): Promise<void> {
  if (shouldUseMemory()) {
    const existing = getMemory().selections.get(selectionId);
    if (existing) {
      getMemory().selections.set(selectionId, {
        ...existing,
        enabled,
        updated_at: new Date().toISOString(),
      });
    }
    return;
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("google_source_selections")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", selectionId);
  if (error && !isMissingTable(error)) throw error;
}
