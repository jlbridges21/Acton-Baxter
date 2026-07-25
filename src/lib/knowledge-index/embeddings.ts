import "server-only";

import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";
import { KNOWLEDGE_INDEX_VERSION, type KnowledgeUnitRecord } from "./types";

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/** Unit types that should receive embeddings (not exact spreadsheet row values). */
export const EMBEDDABLE_UNIT_TYPES = new Set([
  "document_section",
  "paragraph",
  "table",
  "summary",
  "summary_metrics",
  "note",
  "image_description",
  "image_ocr",
  "pdf_page",
  "slide",
  "key_value",
]);

export type EmbeddingResult = {
  vector: number[];
  provider: string;
  model: string;
  contentHash: string;
};

export type EmbeddingProviderConfig = {
  provider: string;
  model: string;
};

export function getEmbeddingConfig(): EmbeddingProviderConfig {
  try {
    const env = getEnv();
    return {
      provider: (env.BAXTER_EMBEDDING_PROVIDER || "openai").toLowerCase().trim(),
      model: (env.BAXTER_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).trim(),
    };
  } catch {
    return { provider: "openai", model: DEFAULT_EMBEDDING_MODEL };
  }
}

export function hashEmbeddingContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Deterministic mock embedding for tests / ENABLE_MOCK_RESEARCH.
 * Produces a unit vector in 1536-d space from content hash.
 */
export function mockEmbedText(text: string): number[] {
  const hash = hashEmbeddingContent(text);
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (let i = 0; i < hash.length && i < EMBEDDING_DIMENSIONS; i++) {
    vector[i] = (hash.charCodeAt(i) % 97) / 97;
  }
  // Sprinkle tokens for crude semantic similarity in tests
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const token of tokens) {
    let h = 0;
    for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0;
    const idx = h % EMBEDDING_DIMENSIONS;
    vector[idx] = (vector[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function shouldMockEmbeddings(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

/**
 * Embed a single text string. Batches should use embedTexts.
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
  const results = await embedTexts([text]);
  return results[0]!;
}

/**
 * Batch embeddings (OpenAI supports multiple inputs per request).
 */
export async function embedTexts(texts: string[]): Promise<EmbeddingResult[]> {
  const config = getEmbeddingConfig();
  if (texts.length === 0) return [];

  if (shouldMockEmbeddings() || config.provider === "mock") {
    return texts.map((text) => ({
      vector: mockEmbedText(text),
      provider: "mock",
      model: "mock-embedding",
      contentHash: hashEmbeddingContent(text),
    }));
  }

  if (config.provider !== "openai") {
    throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }

  const env = getEnv();
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for embeddings");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.EXTERNAL_API_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: texts.map((t) => t.slice(0, 8000)),
      }),
      signal: controller.signal,
    });
    const data = (await response.json()) as {
      data?: Array<{ embedding: number[]; index: number }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(data.error?.message || `Embedding request failed (${response.status})`);
    }
    const byIndex = new Map((data.data ?? []).map((row) => [row.index, row.embedding]));
    return texts.map((text, index) => ({
      vector: byIndex.get(index) ?? mockEmbedText(text),
      provider: "openai",
      model: config.model,
      contentHash: hashEmbeddingContent(text),
    }));
  } finally {
    clearTimeout(timer);
  }
}

export function embeddingTextForUnit(
  unit: Pick<KnowledgeUnitRecord, "title" | "content" | "search_text">,
): string {
  return [unit.title, unit.search_text || unit.content].filter(Boolean).join("\n").trim();
}

export function unitNeedsEmbedding(
  unit: KnowledgeUnitRecord & {
    embedding_content_hash?: string | null;
    embedding?: number[] | null;
    embedding_model?: string | null;
  },
): boolean {
  if (!EMBEDDABLE_UNIT_TYPES.has(unit.unit_type)) return false;
  const config = getEmbeddingConfig();
  const text = embeddingTextForUnit(unit);
  const hash = hashEmbeddingContent(text);
  if (!unit.embedding || unit.embedding.length === 0) return true;
  if (unit.embedding_content_hash !== hash) return true;
  if (unit.embedding_model && unit.embedding_model !== config.model && config.provider !== "mock") {
    return true;
  }
  if (unit.index_version < KNOWLEDGE_INDEX_VERSION) return true;
  return false;
}

export { KNOWLEDGE_INDEX_VERSION };
