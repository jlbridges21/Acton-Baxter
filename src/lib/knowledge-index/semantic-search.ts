import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import type { KnowledgeUnitRecord } from "./types";
import {
  cosineSimilarity,
  embedText,
  embeddingTextForUnit,
  EMBEDDABLE_UNIT_TYPES,
  mockEmbedText,
  type EmbeddingResult,
} from "./embeddings";

export type SemanticHit = {
  unit: KnowledgeUnitRecord;
  score: number;
  reason: string;
};

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

/**
 * Semantic (embedding) retrieval over knowledge units.
 * Respects parent approval via caller-supplied approved entry IDs.
 */
export async function searchSemanticKnowledge(input: {
  question: string;
  approvedEntryIds: Set<string>;
  limit?: number;
  memoryUnits?: KnowledgeUnitRecord[];
}): Promise<SemanticHit[]> {
  const limit = input.limit ?? 8;
  const queryEmbedding = await embedText(input.question);

  if (shouldUseMemory() || input.memoryUnits) {
    const units = (input.memoryUnits ?? []).filter(
      (u) =>
        input.approvedEntryIds.has(u.knowledge_entry_id) && EMBEDDABLE_UNIT_TYPES.has(u.unit_type),
    );
    return rankByEmbedding(units, queryEmbedding, limit);
  }

  // Prefer RPC when available; fall back to fetching embeddable units
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("match_knowledge_units", {
      query_embedding: queryEmbedding.vector,
      match_count: limit * 3,
      filter_entry_ids: Array.from(input.approvedEntryIds),
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      return (data as Array<KnowledgeUnitRecord & { similarity?: number }>)
        .filter((row) => input.approvedEntryIds.has(row.knowledge_entry_id))
        .slice(0, limit)
        .map((row) => ({
          unit: row,
          score: Number(row.similarity ?? 0),
          reason: "semantic_similarity",
        }));
    }
  } catch {
    // RPC may not exist until migration applied
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("knowledge_units")
      .select("*")
      .not("embedding", "is", null)
      .in("knowledge_entry_id", Array.from(input.approvedEntryIds).slice(0, 200))
      .limit(400);
    if (error || !data) return [];
    return rankByEmbedding(data as KnowledgeUnitRecord[], queryEmbedding, limit);
  } catch {
    return [];
  }
}

function rankByEmbedding(
  units: Array<
    KnowledgeUnitRecord & {
      embedding?: number[] | string | null;
      embedding_vector?: number[] | null;
    }
  >,
  query: EmbeddingResult,
  limit: number,
): SemanticHit[] {
  const scored: SemanticHit[] = [];
  for (const unit of units) {
    let vector = unit.embedding_vector ?? null;
    if (!vector && Array.isArray(unit.embedding)) vector = unit.embedding;
    if (!vector && typeof unit.embedding === "string") {
      try {
        vector = JSON.parse(unit.embedding) as number[];
      } catch {
        vector = null;
      }
    }
    // Memory-mode units may lack stored vectors — embed on the fly from content
    if (!vector || vector.length === 0) {
      vector = mockEmbedText(embeddingTextForUnit(unit));
    }
    const score = cosineSimilarity(query.vector, vector);
    if (score < 0.15) continue;
    scored.push({
      unit,
      score,
      reason: "semantic_similarity",
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
