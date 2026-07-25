import { describe, expect, it } from "vitest";
import { tokenizeQuery, scoreKnowledgeMatch, normalizeSearchText } from "@/lib/knowledge/retrieval";
import { dedupeSearchResults } from "@/lib/baxter-ai/context";
import { expandQuestionWithHistory, retrievalQueryFromHistory } from "@/lib/baxter-ai/memory";
import { buildBaxterSystemPrompt } from "@/lib/baxter-ai/prompts";
import { GENERAL_KNOWLEDGE_NOTE, INSUFFICIENT_KNOWLEDGE_ANSWER } from "@/lib/baxter-ai/citations";
import type { KnowledgeEntry, KnowledgeSearchResult } from "@/lib/knowledge/types";

function fakeEntry(partial: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: partial.id ?? "11111111-1111-1111-1111-111111111111",
    title: partial.title ?? "Untitled",
    content: partial.content ?? "",
    summary: partial.summary ?? null,
    category: partial.category ?? "General",
    tags: partial.tags ?? [],
    source_name: partial.source_name ?? null,
    source_type: partial.source_type ?? "manual",
    source_url: partial.source_url ?? null,
    source_external_id: partial.source_external_id ?? null,
    status: partial.status ?? "approved",
    visibility: partial.visibility ?? "internal",
    version: partial.version ?? 1,
    created_by: partial.created_by ?? null,
    updated_by: partial.updated_by ?? null,
    approved_by: partial.approved_by ?? null,
    approved_at: partial.approved_at ?? null,
    archived_at: partial.archived_at ?? null,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00.000Z",
    metadata: partial.metadata ?? {},
  };
}

describe("Prompt 3 — Knowledge Center quality", () => {
  it("matches PEM with Partnership Evaluation Meeting", () => {
    const terms = tokenizeQuery("PEM checklist");
    expect(terms.some((t) => t.includes("partnership"))).toBe(true);
    const entry = fakeEntry({
      title: "Partnership Evaluation Meeting guide",
      content: "How Acton runs the Partnership Evaluation Meeting.",
      tags: ["pem"],
    });
    expect(scoreKnowledgeMatch(entry, "What is PEM?")).toBeGreaterThan(0);
    expect(scoreKnowledgeMatch(entry, "partnership evaluation meeting")).toBeGreaterThan(0);
  });

  it("normalizes apostrophes and casing for search", () => {
    expect(normalizeSearchText("Acton’s PEM")).toContain("acton");
    expect(normalizeSearchText("Acton's PEM")).toContain("acton");
  });

  it("dedupes overlapping retrieval results", () => {
    const a: KnowledgeSearchResult = {
      id: "a",
      title: "Same Title",
      summary: null,
      contentExcerpt: "Hello world excerpt",
      category: "General",
      tags: [],
      sourceName: null,
      sourceUrl: "https://example.com/doc",
      sourceType: "manual",
      mimeType: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      relevanceScore: 10,
      citationLabel: "Same Title",
    };
    const b = { ...a, id: "b", relevanceScore: 8 };
    expect(dedupeSearchResults([a, b])).toHaveLength(1);
  });

  it("expands follow-up pronouns using conversation history", () => {
    const history = [
      { role: "user" as const, content: "What is our PEM process?" },
      { role: "assistant" as const, content: "PEM is the Partnership Evaluation Meeting." },
    ];
    const expanded = expandQuestionWithHistory("Tell me more about that", history);
    expect(expanded).toContain("PEM");
    const retrieval = retrievalQueryFromHistory("what about it?", history);
    expect(retrieval.toLowerCase()).toContain("pem");
  });

  it("uses teammate-style prompts and softer insufficient copy", () => {
    const system = buildBaxterSystemPrompt();
    expect(system).toMatch(/knowledgeable coworker/i);
    expect(INSUFFICIENT_KNOWLEDGE_ANSWER).toMatch(/couldn.?t find an approved Acton source/i);
    expect(GENERAL_KNOWLEDGE_NOTE).toMatch(/general knowledge/i);
  });
});
