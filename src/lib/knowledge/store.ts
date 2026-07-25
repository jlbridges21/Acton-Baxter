import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { ValidationError } from "@/lib/errors";
import {
  normalizeTags,
  type KnowledgeEntryWriteInput,
  type KnowledgeSourceWriteInput,
} from "./schemas";
import { isMeaningfulKnowledgeChange } from "./retrieval";
import type {
  KnowledgeEntry,
  KnowledgeEntryRevision,
  KnowledgeSource,
  KnowledgeStatus,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type MemoryState = {
  entries: Map<string, KnowledgeEntry>;
  revisions: Map<string, KnowledgeEntryRevision[]>;
  sources: Map<string, KnowledgeSource>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterKnowledgeMemory?: MemoryState;
};

function getMemory(): MemoryState {
  if (!globalMemory.__baxterKnowledgeMemory) {
    globalMemory.__baxterKnowledgeMemory = {
      entries: new Map(),
      revisions: new Map(),
      sources: new Map(),
    };
  }
  return globalMemory.__baxterKnowledgeMemory;
}

export function resetKnowledgeMemoryForTests() {
  globalMemory.__baxterKnowledgeMemory = {
    entries: new Map(),
    revisions: new Map(),
    sources: new Map(),
  };
}

function shouldUseMemoryStore(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

/** True when knowledge tables have not been migrated yet (or schema cache is stale). */
function isMissingKnowledgeTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string; details?: string };
  const code = record.code ?? "";
  const message = `${record.message ?? ""} ${record.details ?? ""}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  );
}

function snapshotRevision(
  entry: KnowledgeEntry,
  changedBy: string,
  changeNote: string | null,
): KnowledgeEntryRevision {
  return {
    id: randomUUID(),
    knowledge_entry_id: entry.id,
    version: entry.version,
    title: entry.title,
    content: entry.content,
    summary: entry.summary,
    category: entry.category,
    tags: [...entry.tags],
    source_name: entry.source_name,
    source_type: entry.source_type,
    source_url: entry.source_url,
    status: entry.status,
    visibility: entry.visibility,
    changed_by: changedBy,
    change_note: changeNote,
    created_at: nowIso(),
  };
}

export type ListKnowledgeOptions = {
  q?: string;
  status?: KnowledgeStatus | "all";
  category?: string;
  source_type?: string;
  tag?: string;
  sort?: "updated" | "created" | "title" | "category";
};

export async function listKnowledgeEntries(
  options: ListKnowledgeOptions = {},
): Promise<KnowledgeEntry[]> {
  if (shouldUseMemoryStore()) {
    let rows = Array.from(getMemory().entries.values());
    if (options.status && options.status !== "all") {
      rows = rows.filter((row) => row.status === options.status);
    }
    if (options.category) {
      rows = rows.filter((row) => row.category === options.category);
    }
    if (options.source_type && options.source_type !== "all") {
      rows = rows.filter((row) => row.source_type === options.source_type);
    }
    if (options.tag) {
      const tag = options.tag.toLowerCase();
      rows = rows.filter((row) => row.tags.some((value) => value.toLowerCase() === tag));
    }
    if (options.q?.trim()) {
      const q = options.q.trim().toLowerCase();
      rows = rows.filter((row) =>
        [
          row.title,
          row.summary ?? "",
          row.content,
          row.category,
          row.source_name ?? "",
          row.tags.join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    const sort = options.sort ?? "updated";
    rows.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "category") return a.category.localeCompare(b.category);
      if (sort === "created") return b.created_at.localeCompare(a.created_at);
      return b.updated_at.localeCompare(a.updated_at);
    });
    return rows;
  }

  const supabase = createServiceClient();
  let query = supabase.from("knowledge_entries").select("*");
  if (options.status && options.status !== "all") query = query.eq("status", options.status);
  if (options.category) query = query.eq("category", options.category);
  if (options.source_type && options.source_type !== "all") {
    query = query.eq("source_type", options.source_type);
  }
  if (options.tag) query = query.contains("tags", [options.tag]);
  if (options.sort === "title") query = query.order("title", { ascending: true });
  else if (options.sort === "category") query = query.order("category", { ascending: true });
  else if (options.sort === "created") query = query.order("created_at", { ascending: false });
  else query = query.order("updated_at", { ascending: false });

  const { data, error } = await query;
  if (error) {
    if (isMissingKnowledgeTableError(error)) {
      console.warn(
        "[knowledge] knowledge_entries table missing — run migration 006_knowledge_base.sql",
      );
      return [];
    }
    throw error;
  }
  let rows = (data ?? []) as KnowledgeEntry[];
  if (options.q?.trim()) {
    const q = options.q.trim().toLowerCase();
    rows = rows.filter((row) =>
      [
        row.title,
        row.summary ?? "",
        row.content,
        row.category,
        row.source_name ?? "",
        row.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }
  return rows;
}

export async function getKnowledgeEntry(id: string): Promise<KnowledgeEntry | null> {
  if (shouldUseMemoryStore()) {
    return getMemory().entries.get(id) ?? null;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("knowledge_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as KnowledgeEntry | null) ?? null;
}

export async function listKnowledgeEntryRevisions(
  entryId: string,
): Promise<KnowledgeEntryRevision[]> {
  if (shouldUseMemoryStore()) {
    return [...(getMemory().revisions.get(entryId) ?? [])].sort((a, b) => b.version - a.version);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("knowledge_entry_revisions")
    .select("*")
    .eq("knowledge_entry_id", entryId)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data as KnowledgeEntryRevision[]) ?? [];
}

export async function createKnowledgeEntry(
  input: KnowledgeEntryWriteInput,
  userId: string,
): Promise<KnowledgeEntry> {
  const tags = normalizeTags(input.tags);
  const timestamp = nowIso();
  const status = input.status ?? "draft";
  const entry: KnowledgeEntry = {
    id: randomUUID(),
    title: input.title.trim(),
    content: input.content.trim(),
    summary: emptyToNull(input.summary ?? null),
    category: input.category?.trim() || "General",
    tags,
    source_name:
      emptyToNull(input.source_name ?? null) ??
      (input.source_type === "manual" || !input.source_type ? "Manual entry" : null),
    source_type: input.source_type ?? "manual",
    source_url: emptyToNull(input.source_url ?? null),
    source_external_id: null,
    status,
    visibility: input.visibility ?? "internal",
    version: 1,
    created_by: userId,
    updated_by: userId,
    approved_by: status === "approved" ? userId : null,
    approved_at: status === "approved" ? timestamp : null,
    archived_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    metadata: {},
  };

  if (shouldUseMemoryStore()) {
    getMemory().entries.set(entry.id, entry);
    return entry;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("knowledge_entries")
    .insert(entry)
    .select("*")
    .single();
  if (error) throw error;
  return data as KnowledgeEntry;
}

export async function updateKnowledgeEntry(
  id: string,
  input: KnowledgeEntryWriteInput,
  userId: string,
): Promise<KnowledgeEntry> {
  const existing = await getKnowledgeEntry(id);
  if (!existing) throw new ValidationError("Knowledge entry not found");

  const tags = normalizeTags(input.tags);
  const nextFields = {
    title: input.title.trim(),
    content: input.content.trim(),
    summary: emptyToNull(input.summary ?? null),
    category: input.category?.trim() || existing.category || "General",
    tags,
  };
  const meaningful = isMeaningfulKnowledgeChange(existing, nextFields);
  const revision = snapshotRevision(existing, userId, emptyToNull(input.change_note ?? null));

  let nextStatus = input.status ?? existing.status;
  if (existing.status === "approved" && meaningful) {
    nextStatus = "draft";
  }

  const updated: KnowledgeEntry = {
    ...existing,
    ...nextFields,
    source_name: emptyToNull(input.source_name ?? null),
    source_type: input.source_type ?? existing.source_type,
    source_url: emptyToNull(input.source_url ?? null),
    visibility: input.visibility ?? existing.visibility,
    status: nextStatus,
    version: existing.version + 1,
    updated_by: userId,
    updated_at: nowIso(),
    approved_by:
      nextStatus === "approved" ? (existing.approved_by ?? userId) : existing.approved_by,
    approved_at:
      nextStatus === "approved"
        ? (existing.approved_at ?? nowIso())
        : nextStatus === "draft"
          ? null
          : existing.approved_at,
    archived_at: nextStatus === "archived" ? (existing.archived_at ?? nowIso()) : null,
  };

  if (shouldUseMemoryStore()) {
    const revisions = getMemory().revisions.get(id) ?? [];
    revisions.push(revision);
    getMemory().revisions.set(id, revisions);
    getMemory().entries.set(id, updated);
    return updated;
  }

  const supabase = createServiceClient();
  const { error: revError } = await supabase.from("knowledge_entry_revisions").insert(revision);
  if (revError) throw revError;
  const { data, error } = await supabase
    .from("knowledge_entries")
    .update({
      title: updated.title,
      content: updated.content,
      summary: updated.summary,
      category: updated.category,
      tags: updated.tags,
      source_name: updated.source_name,
      source_type: updated.source_type,
      source_url: updated.source_url,
      visibility: updated.visibility,
      status: updated.status,
      version: updated.version,
      updated_by: updated.updated_by,
      approved_by: updated.approved_by,
      approved_at: updated.approved_at,
      archived_at: updated.archived_at,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as KnowledgeEntry;
}

export async function setKnowledgeEntryStatus(
  id: string,
  status: KnowledgeStatus,
  userId: string,
): Promise<KnowledgeEntry> {
  const existing = await getKnowledgeEntry(id);
  if (!existing) throw new ValidationError("Knowledge entry not found");

  const timestamp = nowIso();
  const updated: KnowledgeEntry = {
    ...existing,
    status,
    updated_by: userId,
    updated_at: timestamp,
    approved_by: status === "approved" ? userId : existing.approved_by,
    approved_at:
      status === "approved" ? timestamp : status === "draft" ? null : existing.approved_at,
    archived_at: status === "archived" ? timestamp : null,
  };

  if (shouldUseMemoryStore()) {
    getMemory().entries.set(id, updated);
    return updated;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("knowledge_entries")
    .update({
      status: updated.status,
      updated_by: updated.updated_by,
      approved_by: updated.approved_by,
      approved_at: updated.approved_at,
      archived_at: updated.archived_at,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as KnowledgeEntry;
}

export async function countBaxterCitationsForEntry(entryId: string): Promise<number> {
  if (shouldUseMemoryStore()) {
    return 0;
  }
  try {
    const supabase = createServiceClient();
    const { count, error } = await supabase
      .from("baxter_message_sources")
      .select("id", { count: "exact", head: true })
      .eq("knowledge_entry_id", entryId);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export function isGoogleManagedEntry(entry: KnowledgeEntry): boolean {
  if (entry.source_type === "Google Drive") return true;
  const meta = entry.metadata as { googleManaged?: boolean; google?: unknown } | null;
  return Boolean(meta?.googleManaged || meta?.google);
}

export async function deleteKnowledgeEntry(
  id: string,
  options?: { forceArchiveInstead?: boolean },
): Promise<{ deleted: true } | { archived: true; entry: KnowledgeEntry }> {
  const existing = await getKnowledgeEntry(id);
  if (!existing) {
    const { KnowledgeError, KNOWLEDGE_ERROR_CODES } = await import("./errors");
    throw new KnowledgeError("Knowledge entry not found.", KNOWLEDGE_ERROR_CODES.NOT_FOUND, {
      statusCode: 404,
    });
  }

  if (isGoogleManagedEntry(existing)) {
    const { KnowledgeError, KNOWLEDGE_ERROR_CODES } = await import("./errors");
    throw new KnowledgeError(
      "This entry is managed by Google Workspace. Remove it from Baxter through Google Drive Sources.",
      KNOWLEDGE_ERROR_CODES.GOOGLE_MANAGED,
      { statusCode: 409 },
    );
  }

  const citations = await countBaxterCitationsForEntry(id);
  if (citations > 0) {
    const { KnowledgeError, KNOWLEDGE_ERROR_CODES } = await import("./errors");
    throw new KnowledgeError(
      "This entry has been used as a source in previous Baxter answers. Archive it instead to preserve conversation history.",
      KNOWLEDGE_ERROR_CODES.HAS_REFERENCES,
      { statusCode: 409 },
    );
  }

  void options;
  try {
    const { deleteUploadsForEntry } = await import("@/lib/knowledge-import/storage");
    await deleteUploadsForEntry(id);
  } catch (error) {
    const { KnowledgeError, KNOWLEDGE_ERROR_CODES } = await import("./errors");
    if (error instanceof KnowledgeError) throw error;
    throw new KnowledgeError(
      "The entry could not be fully deleted because stored file cleanup failed.",
      KNOWLEDGE_ERROR_CODES.STORAGE_DELETE_FAILED,
      { statusCode: 502, cause: error },
    );
  }

  if (shouldUseMemoryStore()) {
    getMemory().entries.delete(id);
    getMemory().revisions.delete(id);
    return { deleted: true };
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("knowledge_entries").delete().eq("id", id);
  if (error) {
    const { KnowledgeError, KNOWLEDGE_ERROR_CODES } = await import("./errors");
    const message = (error.message ?? "").toLowerCase();
    if (message.includes("foreign key") || error.code === "23503") {
      throw new KnowledgeError(
        "This entry cannot be deleted because related records still reference it. Archive it instead.",
        KNOWLEDGE_ERROR_CODES.HAS_REFERENCES,
        { statusCode: 409, cause: error },
      );
    }
    throw new KnowledgeError(
      "Knowledge entry could not be deleted.",
      KNOWLEDGE_ERROR_CODES.DELETE_FAILED,
      { statusCode: 500, cause: error },
    );
  }
  return { deleted: true };
}

export async function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  if (shouldUseMemoryStore()) {
    return Array.from(getMemory().sources.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("knowledge_sources").select("*").order("name");
  if (error) {
    if (isMissingKnowledgeTableError(error)) {
      console.warn(
        "[knowledge] knowledge_sources table missing — run migration 006_knowledge_base.sql",
      );
      return [];
    }
    throw error;
  }
  return (data as KnowledgeSource[]) ?? [];
}

export async function createKnowledgeSource(
  input: KnowledgeSourceWriteInput,
  userId: string,
): Promise<KnowledgeSource> {
  const timestamp = nowIso();
  const source: KnowledgeSource = {
    id: randomUUID(),
    name: input.name.trim(),
    source_type: input.source_type,
    description: emptyToNull(input.description ?? null),
    status: input.status ?? "manual",
    external_identifier: emptyToNull(input.external_identifier ?? null),
    configuration_metadata: {},
    last_sync_at: null,
    last_success_at: null,
    last_error: null,
    created_by: userId,
    created_at: timestamp,
    updated_at: timestamp,
  };

  if (shouldUseMemoryStore()) {
    getMemory().sources.set(source.id, source);
    return source;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("knowledge_sources")
    .insert(source)
    .select("*")
    .single();
  if (error) throw error;
  return data as KnowledgeSource;
}

export async function updateKnowledgeSource(
  id: string,
  input: KnowledgeSourceWriteInput,
): Promise<KnowledgeSource> {
  if (shouldUseMemoryStore()) {
    const existing = getMemory().sources.get(id);
    if (!existing) throw new ValidationError("Knowledge source not found");
    const updated: KnowledgeSource = {
      ...existing,
      name: input.name.trim(),
      source_type: input.source_type,
      description: emptyToNull(input.description ?? null),
      status: input.status ?? existing.status,
      external_identifier: emptyToNull(input.external_identifier ?? null),
      updated_at: nowIso(),
    };
    getMemory().sources.set(id, updated);
    return updated;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("knowledge_sources")
    .update({
      name: input.name.trim(),
      source_type: input.source_type,
      description: emptyToNull(input.description ?? null),
      status: input.status,
      external_identifier: emptyToNull(input.external_identifier ?? null),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as KnowledgeSource;
}

export async function deleteKnowledgeSource(id: string): Promise<void> {
  if (shouldUseMemoryStore()) {
    getMemory().sources.delete(id);
    return;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from("knowledge_sources").delete().eq("id", id);
  if (error) throw error;
}

/** All entries for retrieval scoring (service role / memory). */
export async function listAllKnowledgeEntriesForRetrieval(): Promise<KnowledgeEntry[]> {
  if (shouldUseMemoryStore()) {
    return Array.from(getMemory().entries.values());
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("knowledge_entries").select("*");
  if (error) {
    if (isMissingKnowledgeTableError(error)) {
      console.warn(
        "[knowledge] knowledge_entries table missing — run migration 006_knowledge_base.sql",
      );
      return [];
    }
    throw error;
  }
  return (data as KnowledgeEntry[]) ?? [];
}

export async function patchKnowledgeEntrySyncFields(
  id: string,
  patch: {
    source_external_id?: string | null;
    metadata?: Record<string, unknown>;
    source_url?: string | null;
  },
): Promise<KnowledgeEntry | null> {
  const existing = await getKnowledgeEntry(id);
  if (!existing) return null;

  const updated: KnowledgeEntry = {
    ...existing,
    source_external_id:
      patch.source_external_id !== undefined
        ? patch.source_external_id
        : existing.source_external_id,
    source_url: patch.source_url !== undefined ? patch.source_url : existing.source_url,
    metadata: patch.metadata ? { ...existing.metadata, ...patch.metadata } : existing.metadata,
    updated_at: nowIso(),
  };

  if (shouldUseMemoryStore()) {
    getMemory().entries.set(id, updated);
    return updated;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("knowledge_entries")
    .update({
      source_external_id: updated.source_external_id,
      source_url: updated.source_url,
      metadata: updated.metadata,
      updated_at: updated.updated_at,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    if (isMissingKnowledgeTableError(error)) {
      getMemory().entries.set(id, updated);
      return updated;
    }
    throw error;
  }
  return (data as KnowledgeEntry | null) ?? updated;
}
