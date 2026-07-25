import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { listAllKnowledgeEntriesForRetrieval, getKnowledgeEntry } from "@/lib/knowledge/store";
import {
  indexKnowledgeEntry,
  reindexAllKnowledgeEntries,
  KNOWLEDGE_INDEX_VERSION,
} from "@/lib/knowledge-index";

export async function GET() {
  try {
    await requireAdmin();
    const entries = await listAllKnowledgeEntriesForRetrieval();
    const needing = entries.filter((e) => {
      const meta = e.metadata as { indexVersion?: number; structuredIndexed?: boolean };
      const version = (e as { index_version?: number }).index_version ?? meta.indexVersion;
      return version !== KNOWLEDGE_INDEX_VERSION;
    });
    return jsonOk({
      currentIndexVersion: KNOWLEDGE_INDEX_VERSION,
      totalEntries: entries.length,
      needingReindex: needing.length,
    });
  } catch (error) {
    return jsonError(error, "GET /api/admin/knowledge/reindex");
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const parsed = z
      .object({
        entryId: z.string().uuid().optional(),
        all: z.boolean().optional(),
      })
      .parse(body);

    if (parsed.entryId) {
      const entry = await getKnowledgeEntry(parsed.entryId);
      if (!entry) throw new Error("Knowledge entry not found");
      const result = await indexKnowledgeEntry(entry);
      return jsonOk({ result });
    }

    const entries = await listAllKnowledgeEntriesForRetrieval();
    const summary = await reindexAllKnowledgeEntries(entries);
    return jsonOk({
      summary: {
        processed: summary.processed,
        unitsCreated: summary.unitsCreated,
        tablesDetected: summary.tablesDetected,
        rowsIndexed: summary.rowsIndexed,
        failureCount: summary.failures.length,
      },
      failures: summary.failures.slice(0, 20),
    });
  } catch (error) {
    return jsonError(error, "POST /api/admin/knowledge/reindex");
  }
}
