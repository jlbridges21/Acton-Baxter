import type { KnowledgeEntry, KnowledgeSearchInput, KnowledgeSearchResult } from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "it",
  "me",
  "my",
  "our",
  "your",
  "their",
  "this",
  "that",
  "these",
  "those",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "as",
  "and",
  "or",
  "but",
  "if",
  "then",
  "so",
  "do",
  "does",
  "did",
  "what",
  "which",
  "when",
  "where",
  "why",
  "how",
  "who",
  "whom",
  "about",
  "into",
  "over",
  "after",
  "before",
  "can",
  "could",
  "should",
  "would",
  "will",
  "just",
  "than",
  "too",
  "very",
  "also",
  "any",
  "all",
  "not",
  "no",
  "yes",
]);

/** Small controlled synonym / intent expansions — not a full NLP stack. */
const SYNONYM_EXPAND: Record<string, string[]> = {
  baxter: ["baxter", "assistant", "teammate", "digital employee", "ai agent", "operations agent"],
  acton: ["acton", "acton adu", "company"],
  adu: ["adu", "accessory dwelling", "accessory dwelling unit"],
  pem: ["pem", "partnership evaluation", "partnership evaluation meeting", "partnership eval"],
  partnership: ["partnership", "pem", "partnership evaluation meeting"],
  evaluation: ["evaluation", "pem", "partnership evaluation meeting"],
  raci: ["raci", "responsible", "accountable", "consulted", "informed"],
  process: ["process", "procedure", "workflow", "steps"],
  procedure: ["procedure", "process", "workflow", "sop"],
  policy: ["policy", "handbook", "guideline"],
  feasibility: ["feasibility", "adu feasibility", "feasibility study"],
};

function lightStem(token: string): string[] {
  const out = [token];
  if (token.endsWith("ies") && token.length > 4) out.push(`${token.slice(0, -3)}y`);
  else if (token.endsWith("ing") && token.length > 5) out.push(token.slice(0, -3));
  else if (token.endsWith("ed") && token.length > 4) out.push(token.slice(0, -2));
  else if (token.endsWith("ses") && token.length > 4) out.push(token.slice(0, -2));
  else if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    out.push(token.slice(0, -1));
  }
  return out;
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[’‘‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\p{L}\p{N}\s'#./+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function tokenizeQuery(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const raw = normalized.split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  for (const token of raw) {
    if (STOP_WORDS.has(token)) continue;
    if (token.length < 2) continue;
    terms.push(...lightStem(token));
    const expanded = SYNONYM_EXPAND[token];
    if (expanded) {
      for (const phrase of expanded) {
        for (const part of phrase.split(/\s+/)) {
          if (part.length >= 2 && !STOP_WORDS.has(part)) terms.push(part);
        }
        terms.push(phrase);
      }
    }
  }
  return Array.from(new Set(terms));
}

function excerpt(content: string, query: string, maxLen = 280): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const hay = normalizeSearchText(normalized);
  const terms = tokenizeQuery(query);
  let idx = -1;
  for (const term of terms) {
    idx = hay.indexOf(term);
    if (idx >= 0) break;
  }
  if (idx < 0) {
    return normalized.slice(0, maxLen) + (normalized.length > maxLen ? "…" : "");
  }
  // Map approx index back using original spacing — good enough for excerpts.
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
 * Title/tag/summary matches weigh more than distant content matches.
 */
export function scoreKnowledgeMatch(entry: KnowledgeEntry, query: string): number {
  const q = normalizeSearchText(query);
  if (!q) return 0;
  const terms = tokenizeQuery(query);
  if (terms.length === 0) {
    // Fall back to full query without stop-word filter for short queries like "baxter"
    const fallback = q.split(/\s+/).filter((t) => t.length >= 2);
    if (fallback.length === 0) return 0;
    return scoreTerms(entry, fallback, q);
  }
  return scoreTerms(entry, terms, q);
}

function scoreTerms(entry: KnowledgeEntry, terms: string[], fullQuery: string): number {
  let score = 0;
  const title = normalizeSearchText(entry.title);
  const summary = normalizeSearchText(entry.summary ?? "");
  const content = normalizeSearchText(entry.content);
  const category = normalizeSearchText(entry.category);
  const source = normalizeSearchText(entry.source_name ?? "");
  const tags = entry.tags.map((tag) => normalizeSearchText(tag));

  for (const term of terms) {
    if (title === term) score += 50;
    else if (title.includes(term)) score += 30;
    else if (title.split(/\s+/).some((word) => word.startsWith(term) && term.length >= 3)) {
      score += 18;
    }

    if (tags.some((tag) => tag === term)) score += 24;
    else if (tags.some((tag) => tag.includes(term))) score += 14;

    if (category.includes(term)) score += 12;
    if (source.includes(term)) score += 10;
    if (summary.includes(term)) score += 16;
    if (content.includes(term)) score += 5;
  }

  if (fullQuery.length >= 4) {
    if (title.includes(fullQuery)) score += 20;
    if (summary.includes(fullQuery)) score += 12;
    if (content.includes(fullQuery)) score += 8;
  }

  // Exact / near-exact title match for concept questions (e.g. title "PEM NEAT")
  const titleCompact = title.replace(/\s+/g, " ").trim();
  const queryConcept = fullQuery
    .replace(
      /\b(what|is|are|a|an|the|explain|define|does|mean|for|used|how|do|i|to|generate|create|make)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (titleCompact && queryConcept && titleCompact === queryConcept) {
    score += 80;
  } else if (
    titleCompact &&
    queryConcept &&
    titleCompact.includes(queryConcept) &&
    queryConcept.length >= 3
  ) {
    score += 40;
  }

  // Phrase boost for common Acton vocabulary
  for (const phrase of [
    "digital employee",
    "operations agent",
    "acton adu",
    "knowledge base",
    "partnership evaluation meeting",
    "partnership evaluation",
    "pem neat",
    "type 1 pain",
    "type 2 pain",
    "property research",
    "process rulebook",
    "process monitoring",
    "slack recall",
  ]) {
    if (
      (fullQuery.includes(phrase) || terms.some((t) => phrase.includes(t) && t.length >= 3)) &&
      (title.includes(phrase) || summary.includes(phrase) || content.includes(phrase))
    ) {
      score += 14;
    }
  }

  return score;
}

export function buildKnowledgeSearchResult(
  entry: KnowledgeEntry,
  query: string,
  score: number,
): KnowledgeSearchResult {
  const google =
    entry.metadata?.google && typeof entry.metadata.google === "object"
      ? (entry.metadata.google as { mimeType?: string })
      : null;
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    contentExcerpt: excerpt(entry.content, query),
    category: entry.category,
    tags: entry.tags,
    sourceName: entry.source_name,
    sourceUrl: entry.source_url,
    sourceType: entry.source_type,
    mimeType: google?.mimeType ?? null,
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
    if (input.docKinds?.length) {
      if (!entry.doc_kind || !input.docKinds.includes(entry.doc_kind)) return false;
    }
    // Jurisdiction filter: never surface another city's building-code docs.
    // Untagged entries stay eligible for general Acton process knowledge.
    if (input.jurisdictionKey) {
      if (
        entry.jurisdiction_key &&
        entry.jurisdiction_key !== input.jurisdictionKey &&
        entry.doc_kind
      ) {
        return false;
      }
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
