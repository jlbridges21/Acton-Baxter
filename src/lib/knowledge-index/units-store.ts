import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import type { KnowledgeUnitRecord } from "./types";
import type { DraftUnit } from "./chunking";
import { KNOWLEDGE_INDEX_VERSION } from "./types";

type MemoryState = {
  units: Map<string, KnowledgeUnitRecord[]>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterKnowledgeUnits?: MemoryState;
};

function getMemory(): MemoryState {
  if (!globalMemory.__baxterKnowledgeUnits) {
    globalMemory.__baxterKnowledgeUnits = { units: new Map() };
  }
  return globalMemory.__baxterKnowledgeUnits;
}

export function resetKnowledgeUnitsMemoryForTests() {
  globalMemory.__baxterKnowledgeUnits = { units: new Map() };
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

/**
 * Replace all units for an entry atomically (delete + insert).
 */
export async function replaceUnitsForEntry(
  knowledgeEntryId: string,
  drafts: DraftUnit[],
): Promise<{ count: number }> {
  const timestamp = nowIso();
  const rows: KnowledgeUnitRecord[] = drafts.map((draft) => ({
    id: randomUUID(),
    knowledge_entry_id: knowledgeEntryId,
    unit_type: draft.unit_type,
    ordinal: draft.ordinal,
    title: draft.title,
    content: draft.content,
    search_text: draft.search_text,
    structured_data: draft.structured_data,
    metadata: draft.metadata,
    content_hash: draft.content_hash,
    index_version: draft.index_version || KNOWLEDGE_INDEX_VERSION,
    created_at: timestamp,
    updated_at: timestamp,
  }));

  getMemory().units.set(knowledgeEntryId, rows);

  if (shouldUseMemory()) {
    return { count: rows.length };
  }

  const supabase = createServiceClient();
  const { error: delError } = await supabase
    .from("knowledge_units")
    .delete()
    .eq("knowledge_entry_id", knowledgeEntryId);
  if (delError && !isMissingTable(delError)) throw delError;
  if (delError && isMissingTable(delError)) {
    return { count: rows.length };
  }

  if (rows.length === 0) return { count: 0 };

  const { error: insError } = await supabase.from("knowledge_units").insert(rows);
  if (insError) {
    if (isMissingTable(insError)) return { count: rows.length };
    throw insError;
  }
  return { count: rows.length };
}

export async function listUnitsForEntry(knowledgeEntryId: string): Promise<KnowledgeUnitRecord[]> {
  if (shouldUseMemory() || getMemory().units.has(knowledgeEntryId)) {
    return getMemory().units.get(knowledgeEntryId) ?? [];
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("knowledge_units")
    .select("*")
    .eq("knowledge_entry_id", knowledgeEntryId)
    .order("ordinal", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return getMemory().units.get(knowledgeEntryId) ?? [];
    throw error;
  }
  return (data as KnowledgeUnitRecord[]) ?? [];
}

export async function listAllSpreadsheetRowUnits(): Promise<KnowledgeUnitRecord[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().units.values())
      .flat()
      .filter((u) => u.unit_type === "spreadsheet_row" || u.unit_type === "summary_metrics");
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("knowledge_units")
    .select("*")
    .in("unit_type", ["spreadsheet_row", "summary_metrics"]);
  if (error) {
    if (isMissingTable(error)) {
      return Array.from(getMemory().units.values())
        .flat()
        .filter((u) => u.unit_type === "spreadsheet_row" || u.unit_type === "summary_metrics");
    }
    throw error;
  }
  return (data as KnowledgeUnitRecord[]) ?? [];
}

export async function deleteUnitsForEntry(knowledgeEntryId: string): Promise<void> {
  getMemory().units.delete(knowledgeEntryId);
  if (shouldUseMemory()) return;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("knowledge_units")
    .delete()
    .eq("knowledge_entry_id", knowledgeEntryId);
  if (error && !isMissingTable(error)) throw error;
}
