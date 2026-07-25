import "server-only";

import { listAllKnowledgeEntriesForRetrieval } from "@/lib/knowledge/store";
import {
  listAllEmbeddableUnits,
  listAllSpreadsheetRowUnits,
} from "@/lib/knowledge-index/units-store";
import { KNOWLEDGE_INDEX_VERSION } from "@/lib/knowledge-index/types";

export type KnowledgeHealthSummary = {
  sources: number;
  approvedSources: number;
  indexedUnits: number;
  embeddingCoverage: {
    withEmbedding: number;
    embeddable: number;
    percent: number;
  };
  structuredTables: number;
  spreadsheetRows: number;
  multimodalSources: number;
  indexFailures: number;
  lastReindexAt: string | null;
  lastEvaluationAt: string | null;
  evalPassRate: number | null;
  indexVersion: number;
};

/**
 * Compact admin health summary for Knowledge Center / diagnostics.
 */
export async function getKnowledgeHealthSummary(): Promise<KnowledgeHealthSummary> {
  const entries = await listAllKnowledgeEntriesForRetrieval();
  const approved = entries.filter((e) => e.status === "approved" && e.visibility === "internal");

  let units: Awaited<ReturnType<typeof listAllEmbeddableUnits>> = [];
  let rows: Awaited<ReturnType<typeof listAllSpreadsheetRowUnits>> = [];
  try {
    units = await listAllEmbeddableUnits();
  } catch {
    units = [];
  }
  try {
    rows = await listAllSpreadsheetRowUnits();
  } catch {
    rows = [];
  }

  const withEmbedding = units.filter(
    (u) =>
      (Array.isArray(u.embedding) && u.embedding.length > 0) || Boolean(u.embedding_generated_at),
  ).length;

  const multimodalTypes = new Set([
    "image",
    "image_region",
    "pdf_page",
    "slide",
    "presentation_slide",
  ]);
  const multimodalUnitEntryIds = new Set(
    units
      .filter((u) => multimodalTypes.has(u.unit_type) || u.unit_type.startsWith("image"))
      .map((u) => u.knowledge_entry_id),
  );

  const indexFailures = entries.filter((e) => {
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const status = String(meta.index_status ?? meta.indexStatus ?? "").toLowerCase();
    return status === "failed" || status === "error" || Boolean(meta.index_error);
  }).length;

  const lastReindexCandidates = entries
    .map((e) => {
      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      return (meta.last_reindex_at ?? meta.lastReindexAt ?? e.updated_at) as string | undefined;
    })
    .filter(Boolean)
    .sort()
    .reverse();

  let lastEvaluationAt: string | null = null;
  let evalPassRate: number | null = null;
  const memory = (
    globalThis as typeof globalThis & {
      __baxterEvalMemory?: {
        runs: Array<{ passed: boolean }>;
      };
    }
  ).__baxterEvalMemory;
  if (memory?.runs?.length) {
    const recent = memory.runs.slice(0, 50);
    evalPassRate = recent.filter((r) => r.passed).length / recent.length;
    lastEvaluationAt = new Date().toISOString();
  }

  const tableEntryIds = new Set(rows.map((r) => r.knowledge_entry_id));

  return {
    sources: entries.length,
    approvedSources: approved.length,
    indexedUnits: units.length + rows.length,
    embeddingCoverage: {
      withEmbedding,
      embeddable: units.length,
      percent: units.length ? Math.round((withEmbedding / units.length) * 100) : 0,
    },
    structuredTables: tableEntryIds.size,
    spreadsheetRows: rows.length,
    multimodalSources: multimodalUnitEntryIds.size,
    indexFailures,
    lastReindexAt: lastReindexCandidates[0] ?? null,
    lastEvaluationAt,
    evalPassRate,
    indexVersion: KNOWLEDGE_INDEX_VERSION,
  };
}
