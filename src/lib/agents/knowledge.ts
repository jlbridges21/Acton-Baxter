/**
 * Agent Knowledge Hub — approved documents for specialists (Sam first).
 *
 * Isolation: these documents live in ai_knowledge_* tables and a private storage bucket.
 * Baxter's general retrieval (knowledge_entries / knowledge_units) never reads them, so
 * HR material cannot leak into ordinary Baxter answers.
 *
 * Access: retrieval first computes the set of document IDs the requester may use through
 * this agent (assigned to the agent, ready, and within the requester's sensitivity
 * access), and only then searches — inside that set only.
 */

import "server-only";

import { createHash } from "node:crypto";
import { parseKnowledgeUpload } from "@/lib/knowledge-import/parser";
import { chunkDocumentContent } from "@/lib/knowledge-index/chunking";
import { cosineSimilarity, embedText, embedTexts } from "@/lib/knowledge-index/embeddings";
import { createServiceClient } from "@/lib/supabase/admin";
import { ValidationError } from "@/lib/errors";
import { contentTokens, similarity } from "./text";
import { agentDb, callRpc, eq, inList, selectOne, usesAgentMemoryStore } from "./store";
import type { AccessLevel } from "./types";

export const KNOWLEDGE_BUCKET = "ai-agent-knowledge";
export const KNOWLEDGE_MAX_BYTES = 25 * 1024 * 1024;
/** Text-extractable formats only. Images/slides would require sending HR files to a vision model. */
export const KNOWLEDGE_EXTENSIONS = ["pdf", "docx", "md", "txt", "csv", "xlsx"] as const;

export type Sensitivity = "internal" | "confidential" | "restricted";

export type KnowledgeDocumentRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  sensitivity: Sensitivity;
  status: "processing" | "ready" | "failed" | "archived";
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  content_hash: string | null;
  chunk_count: number;
  index_error: string | null;
  indexed_at: string | null;
  version: number;
  replaces_document_id: string | null;
  uploaded_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type ChunkRow = {
  id: string;
  document_id: string;
  ordinal: number;
  heading: string | null;
  content: string;
  embedding?: number[] | string | null;
};

export type KnowledgeHit = {
  documentId: string;
  documentTitle: string;
  category: string;
  sensitivity: Sensitivity;
  heading: string | null;
  excerpt: string;
  score: number;
};

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function allowedSensitivities(access: Set<AccessLevel>): Sensitivity[] {
  return access.has("restricted_data")
    ? ["internal", "confidential", "restricted"]
    : ["internal", "confidential"];
}

export async function listDocumentsForAgent(
  agentId: string,
  options?: { includeArchived?: boolean },
) {
  const links = await agentDb().select<{ document_id: string }>("ai_knowledge_document_agents", {
    filters: [eq("agent_id", agentId)],
  });
  if (links.length === 0) return [];
  const docs = await agentDb().select<KnowledgeDocumentRow>("ai_knowledge_documents", {
    filters: [
      inList(
        "id",
        links.map((l) => l.document_id),
      ),
    ],
    order: { col: "updated_at", ascending: false },
  });
  return options?.includeArchived ? docs : docs.filter((d) => d.status !== "archived");
}

export async function getDocument(id: string): Promise<KnowledgeDocumentRow | null> {
  return selectOne<KnowledgeDocumentRow>("ai_knowledge_documents", { filters: [eq("id", id)] });
}

export async function getDocumentAgentIds(documentId: string): Promise<string[]> {
  const links = await agentDb().select<{ agent_id: string }>("ai_knowledge_document_agents", {
    filters: [eq("document_id", documentId)],
  });
  return links.map((l) => l.agent_id);
}

async function storeFile(path: string, buffer: Buffer, mimeType: string) {
  if (usesAgentMemoryStore()) return;
  const { error } = await createServiceClient()
    .storage.from(KNOWLEDGE_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Could not store the file: ${error.message}`);
}

export async function createSignedDownloadUrl(doc: KnowledgeDocumentRow): Promise<string | null> {
  if (!doc.storage_path || usesAgentMemoryStore()) return null;
  const { data } = await createServiceClient()
    .storage.from(KNOWLEDGE_BUCKET)
    .createSignedUrl(doc.storage_path, 60);
  return data?.signedUrl ?? null;
}

export type UploadKnowledgeInput = {
  agentIds: string[];
  filename: string;
  buffer: Buffer;
  mimeType: string | null;
  title: string;
  description: string | null;
  category: string;
  sensitivity: Sensitivity;
  uploadedBy: string | null;
  replacesDocumentId?: string | null;
};

/** Upload, extract text, chunk, and embed. Returns the stored document (ready or failed). */
export async function uploadKnowledgeDocument(
  input: UploadKnowledgeInput,
): Promise<KnowledgeDocumentRow> {
  const ext = extensionOf(input.filename);
  if (!(KNOWLEDGE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new ValidationError(
      `This file type isn't supported. Upload ${KNOWLEDGE_EXTENSIONS.map((e) => `.${e}`).join(", ")}.`,
    );
  }
  if (input.buffer.byteLength === 0) throw new ValidationError("The file is empty.");
  if (input.buffer.byteLength > KNOWLEDGE_MAX_BYTES) {
    throw new ValidationError("The file is larger than 25 MB.");
  }
  if (input.agentIds.length === 0) throw new ValidationError("Choose at least one agent.");

  const db = agentDb();
  let version = 1;
  if (input.replacesDocumentId) {
    const previous = await getDocument(input.replacesDocumentId);
    if (!previous) throw new ValidationError("The document being replaced no longer exists.");
    version = previous.version + 1;
  }

  const contentHash = createHash("sha256").update(input.buffer).digest("hex");
  const storagePath = `${new Date().toISOString().slice(0, 7)}/${contentHash.slice(0, 16)}-${Date.now()}.${ext}`;
  const [doc] = await db.insert<KnowledgeDocumentRow>("ai_knowledge_documents", {
    title: input.title.trim().slice(0, 300) || input.filename,
    description: input.description,
    category: input.category,
    sensitivity: input.sensitivity,
    status: "processing",
    filename: input.filename.slice(0, 300),
    mime_type: input.mimeType,
    size_bytes: input.buffer.byteLength,
    storage_path: usesAgentMemoryStore() ? null : storagePath,
    content_hash: contentHash,
    chunk_count: 0,
    index_error: null,
    indexed_at: null,
    version,
    replaces_document_id: input.replacesDocumentId ?? null,
    uploaded_by: input.uploadedBy,
    metadata: {},
  });
  await db.insert(
    "ai_knowledge_document_agents",
    input.agentIds.map((agentId) => ({ document_id: doc!.id, agent_id: agentId })),
  );

  try {
    await storeFile(storagePath, input.buffer, input.mimeType ?? "application/octet-stream");
    const parsed = await parseKnowledgeUpload({
      filename: input.filename,
      buffer: input.buffer,
      mimeType: input.mimeType,
    });
    const indexed = await indexDocumentText(doc!.id, doc!.title, parsed.content);
    const [ready] = await db.update<KnowledgeDocumentRow>(
      "ai_knowledge_documents",
      [eq("id", doc!.id)],
      {
        status: indexed.chunks > 0 ? "ready" : "failed",
        chunk_count: indexed.chunks,
        index_error:
          indexed.chunks === 0
            ? "No readable text was found in this file."
            : indexed.embeddingWarning,
        indexed_at: new Date().toISOString(),
        metadata: { warnings: parsed.warnings.slice(0, 5), extraction: parsed.extractionStatus },
      },
    );
    if (ready?.status === "ready" && input.replacesDocumentId) {
      await db.update("ai_knowledge_documents", [eq("id", input.replacesDocumentId)], {
        status: "archived",
      });
    }
    return ready!;
  } catch (error) {
    const [failed] = await db.update<KnowledgeDocumentRow>(
      "ai_knowledge_documents",
      [eq("id", doc!.id)],
      {
        status: "failed",
        index_error: error instanceof Error ? error.message.slice(0, 500) : "Indexing failed.",
      },
    );
    return failed!;
  }
}

async function indexDocumentText(
  documentId: string,
  title: string,
  content: string,
): Promise<{ chunks: number; embeddingWarning: string | null }> {
  const units = chunkDocumentContent({ title, content }).slice(0, 2000);
  if (units.length === 0) return { chunks: 0, embeddingWarning: null };
  let vectors: number[][] | null = null;
  let embeddingWarning: string | null = null;
  try {
    const results: number[][] = [];
    for (let i = 0; i < units.length; i += 64) {
      const batch = await embedTexts(units.slice(i, i + 64).map((u) => u.content));
      results.push(...batch.map((b) => b.vector));
    }
    vectors = results;
  } catch {
    embeddingWarning =
      "Semantic search unavailable for this file (embeddings failed); keyword search still works.";
  }
  const rows = units.map((u, i) => ({
    document_id: documentId,
    ordinal: u.ordinal,
    heading: u.title,
    content: u.content.slice(0, 8000),
    embedding: vectors ? (usesAgentMemoryStore() ? vectors[i] : JSON.stringify(vectors[i])) : null,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    await agentDb().insert("ai_knowledge_chunks", rows.slice(i, i + 200));
  }
  return { chunks: rows.length, embeddingWarning };
}

export async function updateDocumentMetadata(
  id: string,
  patch: Partial<
    Pick<KnowledgeDocumentRow, "title" | "description" | "category" | "sensitivity" | "status">
  >,
  agentIds?: string[],
): Promise<KnowledgeDocumentRow | null> {
  const [doc] = await agentDb().update<KnowledgeDocumentRow>(
    "ai_knowledge_documents",
    [eq("id", id)],
    patch,
  );
  if (agentIds) {
    await agentDb().remove("ai_knowledge_document_agents", [eq("document_id", id)]);
    if (agentIds.length) {
      await agentDb().insert(
        "ai_knowledge_document_agents",
        agentIds.map((agentId) => ({ document_id: id, agent_id: agentId })),
      );
    }
  }
  return doc ?? null;
}

/** Permanently delete a document, its chunks, and its stored file. */
export async function deleteKnowledgeDocument(id: string): Promise<void> {
  const doc = await getDocument(id);
  if (!doc) return;
  if (doc.storage_path && !usesAgentMemoryStore()) {
    await createServiceClient().storage.from(KNOWLEDGE_BUCKET).remove([doc.storage_path]);
  }
  await agentDb().remove("ai_knowledge_documents", [eq("id", id)]);
  if (usesAgentMemoryStore()) {
    await agentDb().remove("ai_knowledge_chunks", [eq("document_id", id)]);
    await agentDb().remove("ai_knowledge_document_agents", [eq("document_id", id)]);
  }
}

export async function getDocumentPreview(id: string, maxChunks = 8): Promise<ChunkRow[]> {
  return agentDb().select<ChunkRow>("ai_knowledge_chunks", {
    filters: [eq("document_id", id)],
    order: { col: "ordinal" },
    limit: maxChunks,
    columns: "id, document_id, ordinal, heading, content",
  });
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export async function authorizedDocumentsForAgent(input: {
  agentId: string;
  access: Set<AccessLevel>;
  categories?: string[];
}): Promise<KnowledgeDocumentRow[]> {
  const sensitivities = new Set(allowedSensitivities(input.access));
  const docs = await listDocumentsForAgent(input.agentId);
  return docs.filter(
    (d) =>
      d.status === "ready" &&
      sensitivities.has(d.sensitivity) &&
      (!input.categories?.length || input.categories.includes(d.category)),
  );
}

function excerpt(textIn: string, max = 900): string {
  const body = textIn.replace(/^Document: .*\n(Section: .*\n)?\n?/u, "").trim();
  return body.length > max ? `${body.slice(0, max)}…` : body;
}

export async function searchAgentKnowledge(input: {
  agentId: string;
  access: Set<AccessLevel>;
  query: string;
  limit: number;
}): Promise<{ hits: KnowledgeHit[]; searchedDocuments: number }> {
  const docs = await authorizedDocumentsForAgent({ agentId: input.agentId, access: input.access });
  if (docs.length === 0) return { hits: [], searchedDocuments: 0 };
  const docById = new Map(docs.map((d) => [d.id, d]));
  const ids = docs.map((d) => d.id);
  const scores = new Map<string, { chunk: ChunkRow; score: number }>();

  // Lexical pass over the authorized documents only.
  const chunks = await agentDb().select<ChunkRow>("ai_knowledge_chunks", {
    filters: [inList("document_id", ids)],
    limit: 4000,
    columns: usesAgentMemoryStore() ? undefined : "id, document_id, ordinal, heading, content",
  });
  const qTokens = contentTokens(input.query);
  for (const chunk of chunks) {
    const s = similarity(qTokens, contentTokens(`${chunk.heading ?? ""} ${chunk.content}`));
    if (s > 0.05) scores.set(chunk.id, { chunk, score: s });
  }

  // Semantic pass (best effort).
  try {
    const { vector } = await embedText(input.query);
    let semantic: Array<{ chunk: ChunkRow; similarity: number }> = [];
    if (usesAgentMemoryStore()) {
      semantic = chunks
        .filter((c) => Array.isArray(c.embedding))
        .map((c) => ({ chunk: c, similarity: cosineSimilarity(vector, c.embedding as number[]) }));
    } else {
      const rows = await callRpc<Array<ChunkRow & { similarity: number }>>(
        "match_ai_knowledge_chunks",
        {
          query_embedding: JSON.stringify(vector),
          allowed_document_ids: ids,
          match_count: input.limit * 2,
        },
      );
      semantic = rows.map((r) => ({ chunk: r, similarity: r.similarity }));
    }
    for (const { chunk, similarity: sim } of semantic) {
      if (!docById.has(chunk.document_id) || sim < 0.25) continue;
      const prior = scores.get(chunk.id);
      scores.set(chunk.id, { chunk, score: Math.max(prior?.score ?? 0, sim) + (prior ? 0.1 : 0) });
    }
  } catch {
    // Lexical results still stand.
  }

  const hits = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map(({ chunk, score }) => {
      const doc = docById.get(chunk.document_id)!;
      return {
        documentId: doc.id,
        documentTitle: doc.title,
        category: doc.category,
        sensitivity: doc.sensitivity,
        heading: chunk.heading,
        excerpt: excerpt(chunk.content),
        score: Math.round(score * 1000) / 1000,
      };
    });
  return { hits, searchedDocuments: docs.length };
}
