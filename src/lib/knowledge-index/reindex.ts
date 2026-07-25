import "server-only";

import { createHash } from "node:crypto";
import { chunkDocumentContent, unitsFromWorkbook } from "./chunking";
import { parseWorkbookFromSheets } from "./spreadsheet-parser";
import { replaceUnitsForEntry } from "./units-store";
import { KNOWLEDGE_INDEX_VERSION } from "./types";
import type { KnowledgeEntry } from "@/lib/knowledge/types";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";

export type IndexEntryResult = {
  entryId: string;
  title: string;
  unitCount: number;
  tableCount: number;
  rowCount: number;
  warnings: string[];
  status: "ready" | "failed" | "skipped";
  error?: string;
};

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

async function patchEntryIndexMeta(
  entryId: string,
  patch: {
    index_version: number;
    indexed_at: string;
    index_status: string;
    index_warnings: string[];
    metadata?: Record<string, unknown>;
    content?: string;
  },
) {
  if (shouldUseMemory()) return;
  try {
    const supabase = createServiceClient();
    const update: Record<string, unknown> = {
      index_version: patch.index_version,
      indexed_at: patch.indexed_at,
      index_status: patch.index_status,
      index_warnings: patch.index_warnings,
      updated_at: patch.indexed_at,
    };
    if (patch.content != null) update.content = patch.content;
    if (patch.metadata) update.metadata = patch.metadata;
    await supabase.from("knowledge_entries").update(update).eq("id", entryId);
  } catch {
    // Columns may be missing until migration 016
  }
}

function isSpreadsheetEntry(entry: KnowledgeEntry): boolean {
  const meta = entry.metadata as Record<string, unknown>;
  if (meta.workbook || meta.structuredWorkbook) return true;
  if (entry.source_type === "Google Drive") {
    const mime = String((meta.google as { mimeType?: string } | undefined)?.mimeType ?? "");
    if (mime.includes("spreadsheet")) return true;
  }
  if (entry.source_type === "uploaded_document") {
    const ext = String(meta.extension ?? meta.originalFilename ?? "");
    if (/\.(xlsx|csv)$/i.test(ext) || meta.sheetNames) return true;
  }
  // Heuristic: content starts with Spreadsheet:
  if (/^Spreadsheet:/m.test(entry.content) || /## Sheet:/m.test(entry.content)) return true;
  return false;
}

/**
 * Index a knowledge entry into retrieval units.
 * For spreadsheets, prefers metadata.workbook grids when present.
 */
export async function indexKnowledgeEntry(entry: KnowledgeEntry): Promise<IndexEntryResult> {
  const warnings: string[] = [];
  try {
    let unitCount = 0;
    let tableCount = 0;
    let rowCount = 0;
    let contentOverride: string | undefined;
    let metadataPatch: Record<string, unknown> | undefined;

    if (isSpreadsheetEntry(entry)) {
      const meta = { ...(entry.metadata ?? {}) } as Record<string, unknown>;
      const workbook = meta.workbook as
        | {
            title?: string;
            sheets?: Array<{ name: string; gid?: number | null; grid: string[][] }>;
          }
        | undefined;

      // Rebuild from stored grids if available
      if (workbook?.sheets?.length) {
        const parsed = parseWorkbookFromSheets(
          workbook.title || entry.title,
          workbook.sheets.map((s) => ({
            name: s.name,
            gid: s.gid ?? null,
            grid: s.grid,
          })),
        );
        warnings.push(...parsed.warnings);
        const drafts = unitsFromWorkbook(parsed, {
          sourceUrl: entry.source_url,
          googleFileId: entry.source_external_id,
        });
        await replaceUnitsForEntry(entry.id, drafts);
        unitCount = drafts.length;
        tableCount = parsed.sheets.reduce((n, s) => n + s.tables.length, 0);
        rowCount = parsed.sheets.reduce(
          (n, s) => n + s.tables.reduce((m, t) => m + t.rows.length, 0),
          0,
        );
        contentOverride = parsed.contentText;
        metadataPatch = {
          ...meta,
          workbook: {
            title: parsed.title,
            sheets: workbook.sheets,
            warnings: parsed.warnings,
            truncated: parsed.truncated,
          },
          structuredIndexed: true,
          indexVersion: KNOWLEDGE_INDEX_VERSION,
        };
      } else {
        // Fall back to document chunking of existing content + try to parse Row lines
        const drafts = chunkDocumentContent({ title: entry.title, content: entry.content });
        await replaceUnitsForEntry(entry.id, drafts);
        unitCount = drafts.length;
        warnings.push(
          "Spreadsheet grids not stored; indexed as document chunks. Re-sync to rebuild structured tables.",
        );
      }
    } else {
      const drafts = chunkDocumentContent({ title: entry.title, content: entry.content });
      await replaceUnitsForEntry(entry.id, drafts);
      unitCount = drafts.length;
    }

    await patchEntryIndexMeta(entry.id, {
      index_version: KNOWLEDGE_INDEX_VERSION,
      indexed_at: new Date().toISOString(),
      index_status: "ready",
      index_warnings: warnings,
      content: contentOverride,
      metadata: metadataPatch,
    });

    return {
      entryId: entry.id,
      title: entry.title,
      unitCount,
      tableCount,
      rowCount,
      warnings,
      status: "ready",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Index failed";
    await patchEntryIndexMeta(entry.id, {
      index_version: KNOWLEDGE_INDEX_VERSION,
      indexed_at: new Date().toISOString(),
      index_status: "failed",
      index_warnings: [message],
    });
    return {
      entryId: entry.id,
      title: entry.title,
      unitCount: 0,
      tableCount: 0,
      rowCount: 0,
      warnings,
      status: "failed",
      error: message,
    };
  }
}

export async function reindexAllKnowledgeEntries(entries: KnowledgeEntry[]): Promise<{
  processed: number;
  unitsCreated: number;
  tablesDetected: number;
  rowsIndexed: number;
  failures: IndexEntryResult[];
  results: IndexEntryResult[];
}> {
  const results: IndexEntryResult[] = [];
  let unitsCreated = 0;
  let tablesDetected = 0;
  let rowsIndexed = 0;
  for (const entry of entries) {
    if (entry.status === "archived") continue;
    const result = await indexKnowledgeEntry(entry);
    results.push(result);
    unitsCreated += result.unitCount;
    tablesDetected += result.tableCount;
    rowsIndexed += result.rowCount;
  }
  return {
    processed: results.length,
    unitsCreated,
    tablesDetected,
    rowsIndexed,
    failures: results.filter((r) => r.status === "failed"),
    results,
  };
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
