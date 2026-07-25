import "server-only";

import { createHash } from "node:crypto";
import { chunkDocumentContent, unitsFromWorkbook, type DraftUnit } from "./chunking";
import { parseWorkbookFromSheets } from "./spreadsheet-parser";
import { listUnitsForEntry, replaceUnitsForEntry, updateUnitEmbedding } from "./units-store";
import { KNOWLEDGE_INDEX_VERSION } from "./types";
import type { KnowledgeEntry } from "@/lib/knowledge/types";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import {
  embedTexts,
  embeddingTextForUnit,
  EMBEDDABLE_UNIT_TYPES,
  unitNeedsEmbedding,
} from "./embeddings";
import { unitsFromPdfPages } from "./multimodal";

export type IndexEntryResult = {
  entryId: string;
  title: string;
  unitCount: number;
  tableCount: number;
  rowCount: number;
  imageCount: number;
  pdfPageCount: number;
  slideCount: number;
  embeddingsGenerated: number;
  warnings: string[];
  status: "ready" | "failed" | "skipped" | "needs_attention";
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
    // Columns may be missing until migration 016/017
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
  if (/^Spreadsheet:/m.test(entry.content) || /## Sheet:/m.test(entry.content)) return true;
  return false;
}

function emptyResult(
  entry: KnowledgeEntry,
  warnings: string[],
  status: IndexEntryResult["status"],
  error?: string,
): IndexEntryResult {
  return {
    entryId: entry.id,
    title: entry.title,
    unitCount: 0,
    tableCount: 0,
    rowCount: 0,
    imageCount: 0,
    pdfPageCount: 0,
    slideCount: 0,
    embeddingsGenerated: 0,
    warnings,
    status,
    error,
  };
}

async function generateEmbeddingsForEntry(entryId: string): Promise<number> {
  const units = await listUnitsForEntry(entryId);
  const needing = units.filter(
    (u) => EMBEDDABLE_UNIT_TYPES.has(u.unit_type) && unitNeedsEmbedding(u),
  );
  if (needing.length === 0) return 0;

  const batchSize = 16;
  let generated = 0;
  for (let i = 0; i < needing.length; i += batchSize) {
    const batch = needing.slice(i, i + batchSize);
    const texts = batch.map((u) => embeddingTextForUnit(u));
    try {
      const embeddings = await embedTexts(texts);
      for (let j = 0; j < batch.length; j++) {
        const unit = batch[j]!;
        const emb = embeddings[j]!;
        await updateUnitEmbedding(unit.id, {
          vector: emb.vector,
          provider: emb.provider,
          model: emb.model,
          contentHash: emb.contentHash,
        });
        generated += 1;
      }
    } catch (error) {
      // Failed embedding must not corrupt existing valid index
      console.warn(
        "[baxter-index] embedding batch failed",
        error instanceof Error ? error.message : error,
      );
      break;
    }
  }
  return generated;
}

/**
 * Index a knowledge entry into retrieval units.
 * For spreadsheets, prefers metadata.workbook grids when present.
 * Multimodal units (image/slide/pdf page) reuse metadata produced at sync/upload time.
 */
export async function indexKnowledgeEntry(entry: KnowledgeEntry): Promise<IndexEntryResult> {
  const warnings: string[] = [];
  try {
    let unitCount = 0;
    let tableCount = 0;
    let rowCount = 0;
    let imageCount = 0;
    let pdfPageCount = 0;
    let slideCount = 0;
    let contentOverride: string | undefined;
    let metadataPatch: Record<string, unknown> | undefined;
    let status: IndexEntryResult["status"] = "ready";

    const meta = { ...(entry.metadata ?? {}) } as Record<string, unknown>;

    if (
      typeof entry.content === "string" &&
      /exceeds automatic processing limit/i.test(entry.content)
    ) {
      warnings.push("Needs attention — file exceeds automatic processing limit.");
      status = "needs_attention";
      await patchEntryIndexMeta(entry.id, {
        index_version: KNOWLEDGE_INDEX_VERSION,
        indexed_at: new Date().toISOString(),
        index_status: "needs_attention",
        index_warnings: warnings,
      });
      return { ...emptyResult(entry, warnings, status), unitCount: 0 };
    }

    // Prefer pre-built multimodal units from sync/import metadata
    if (Array.isArray(meta.imageUnits) && meta.imageUnits.length > 0) {
      const drafts = meta.imageUnits as DraftUnit[];
      await replaceUnitsForEntry(entry.id, drafts);
      unitCount = drafts.length;
      imageCount = drafts.filter(
        (d) => d.unit_type === "image_description" || d.unit_type === "image_ocr",
      ).length;
    } else if (Array.isArray(meta.slideUnits) && meta.slideUnits.length > 0) {
      const drafts = meta.slideUnits as DraftUnit[];
      await replaceUnitsForEntry(entry.id, drafts);
      unitCount = drafts.length;
      slideCount = drafts.filter((d) => d.unit_type === "slide").length;
    } else if (Array.isArray(meta.pdfPages) && (meta.pdfPages as unknown[]).length > 0) {
      const drafts = unitsFromPdfPages({
        title: entry.title,
        pages: meta.pdfPages as Array<{ pageNumber: number; text: string }>,
        sourceUrl: entry.source_url,
      });
      await replaceUnitsForEntry(entry.id, drafts);
      unitCount = drafts.length;
      pdfPageCount = drafts.length;
    } else if (isSpreadsheetEntry(entry)) {
      const workbook = meta.workbook as
        | {
            title?: string;
            sheets?: Array<{ name: string; gid?: number | null; grid: string[][] }>;
          }
        | undefined;

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
      slideCount = drafts.filter((d) => d.unit_type === "slide").length;
      pdfPageCount = drafts.filter((d) => d.unit_type === "pdf_page").length;
    }

    const embeddingsGenerated = await generateEmbeddingsForEntry(entry.id);

    await patchEntryIndexMeta(entry.id, {
      index_version: KNOWLEDGE_INDEX_VERSION,
      indexed_at: new Date().toISOString(),
      index_status: status,
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
      imageCount,
      pdfPageCount,
      slideCount,
      embeddingsGenerated,
      warnings,
      status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Index failed";
    await patchEntryIndexMeta(entry.id, {
      index_version: KNOWLEDGE_INDEX_VERSION,
      indexed_at: new Date().toISOString(),
      index_status: "failed",
      index_warnings: [message],
    });
    return emptyResult(entry, warnings, "failed", message);
  }
}

export async function reindexAllKnowledgeEntries(entries: KnowledgeEntry[]): Promise<{
  processed: number;
  unitsCreated: number;
  tablesDetected: number;
  rowsIndexed: number;
  imagesAnalyzed: number;
  pdfPagesIndexed: number;
  slidesIndexed: number;
  embeddingsGenerated: number;
  failures: IndexEntryResult[];
  results: IndexEntryResult[];
}> {
  const results: IndexEntryResult[] = [];
  let unitsCreated = 0;
  let tablesDetected = 0;
  let rowsIndexed = 0;
  let imagesAnalyzed = 0;
  let pdfPagesIndexed = 0;
  let slidesIndexed = 0;
  let embeddingsGenerated = 0;
  for (const entry of entries) {
    if (entry.status === "archived") continue;
    const result = await indexKnowledgeEntry(entry);
    results.push(result);
    unitsCreated += result.unitCount;
    tablesDetected += result.tableCount;
    rowsIndexed += result.rowCount;
    imagesAnalyzed += result.imageCount;
    pdfPagesIndexed += result.pdfPageCount;
    slidesIndexed += result.slideCount;
    embeddingsGenerated += result.embeddingsGenerated;
  }
  return {
    processed: results.length,
    unitsCreated,
    tablesDetected,
    rowsIndexed,
    imagesAnalyzed,
    pdfPagesIndexed,
    slidesIndexed,
    embeddingsGenerated,
    failures: results.filter((r) => r.status === "failed"),
    results,
  };
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
