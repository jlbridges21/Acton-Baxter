import type { KnowledgeEntry, KnowledgeSearchInput, KnowledgeSearchResult } from "./types";

function excerpt(content: string, query: string, maxLen = 220): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const q = query.trim().toLowerCase();
  if (!q) return normalized.slice(0, maxLen) + (normalized.length > maxLen ? "…" : "");
  const idx = normalized.toLowerCase().indexOf(q);
  if (idx < 0) return normalized.slice(0, maxLen) + (normalized.length > maxLen ? "…" : "");
  const start = Math.max(0, idx - 40);
  const slice = normalized.slice(start, start + maxLen);
  return `${start > 0 ? "…" : ""}${slice}${start + maxLen < normalized.length ? "…" : ""}`;
}

function citationLabel(entry: KnowledgeEntry): string {
  const source = entry.source_name?.trim();
  if (source) return `${source} — ${entry.title}`;
  return `${entry.category} — ${entry.title}`;
}

/**
 * Deterministic keyword relevance for approved employee-facing retrieval.
 * Title/tag matches weigh more than distant content matches.
 */
export function scoreKnowledgeMatch(entry: KnowledgeEntry, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const terms = q.split(/\s+/).filter(Boolean);
  let score = 0;
  const title = entry.title.toLowerCase();
  const summary = (entry.summary ?? "").toLowerCase();
  const content = entry.content.toLowerCase();
  const category = entry.category.toLowerCase();
  const source = (entry.source_name ?? "").toLowerCase();
  const tags = entry.tags.map((tag) => tag.toLowerCase());

  for (const term of terms) {
    if (title === term) score += 40;
    else if (title.includes(term)) score += 25;
    if (tags.some((tag) => tag === term)) score += 20;
    else if (tags.some((tag) => tag.includes(term))) score += 12;
    if (category.includes(term)) score += 10;
    if (source.includes(term)) score += 8;
    if (summary.includes(term)) score += 6;
    if (content.includes(term)) score += 3;
  }

  if (title.includes(q)) score += 15;
  return score;
}

export function buildKnowledgeSearchResult(
  entry: KnowledgeEntry,
  query: string,
  score: number,
): KnowledgeSearchResult {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    contentExcerpt: excerpt(entry.content, query),
    category: entry.category,
    tags: entry.tags,
    sourceName: entry.source_name,
    sourceUrl: entry.source_url,
    updatedAt: entry.updated_at,
    relevanceScore: score,
    citationLabel: citationLabel(entry),
  };
}

export function filterAndRankApprovedKnowledge(
  entries: KnowledgeEntry[],
  input: KnowledgeSearchInput,
): KnowledgeSearchResult[] {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const query = (input.query ?? "").trim();
  const visibility = input.visibility ?? "internal";

  const eligible = entries.filter((entry) => {
    if (entry.status !== "approved") return false;
    if (entry.visibility !== visibility) return false;
    if (input.categories?.length && !input.categories.includes(entry.category)) return false;
    if (input.tags?.length) {
      const wanted = input.tags.map((tag) => tag.toLowerCase());
      const have = entry.tags.map((tag) => tag.toLowerCase());
      if (!wanted.some((tag) => have.includes(tag))) return false;
    }
    return true;
  });

  if (!query) {
    return eligible
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit)
      .map((entry) => buildKnowledgeSearchResult(entry, "", 1));
  }

  return eligible
    .map((entry) => ({ entry, score: scoreKnowledgeMatch(entry, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updated_at.localeCompare(a.entry.updated_at))
    .slice(0, limit)
    .map((row) => buildKnowledgeSearchResult(row.entry, query, row.score));
}

/** Meaningful content fields — editing these returns approved entries to draft. */
export function isMeaningfulKnowledgeChange(
  before: KnowledgeEntry,
  after: {
    title: string;
    content: string;
    summary: string | null;
    category: string;
    tags: string[];
  },
): boolean {
  return (
    before.title !== after.title ||
    before.content !== after.content ||
    (before.summary ?? "") !== (after.summary ?? "") ||
    before.category !== after.category ||
    before.tags.join("|").toLowerCase() !== after.tags.join("|").toLowerCase()
  );
}
