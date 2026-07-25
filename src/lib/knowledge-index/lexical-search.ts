import "server-only";

import { normalizeSearchText, tokenizeQuery } from "@/lib/knowledge/retrieval";
import type { KnowledgeUnitRecord } from "./types";

export type LexicalHit = {
  unit: KnowledgeUnitRecord;
  score: number;
  reason: string;
};

/**
 * Lexical / exact-terminology retrieval over unit search_text and content.
 */
export function searchLexicalKnowledge(input: {
  question: string;
  units: KnowledgeUnitRecord[];
  approvedEntryIds: Set<string>;
  limit?: number;
}): LexicalHit[] {
  const limit = input.limit ?? 8;
  const terms = tokenizeQuery(input.question);
  const normalizedQuestion = normalizeSearchText(input.question);
  if (!terms.length && !normalizedQuestion) return [];

  const hits: LexicalHit[] = [];
  for (const unit of input.units) {
    if (!input.approvedEntryIds.has(unit.knowledge_entry_id)) continue;
    // Prefer non-row units for lexical terminology; still allow rows for acronyms/names
    const haystack = normalizeSearchText(
      [unit.title, unit.search_text, unit.content].filter(Boolean).join(" "),
    );
    if (!haystack) continue;

    let score = 0;
    let reason = "lexical_partial";

    if (
      normalizedQuestion &&
      haystack.includes(normalizedQuestion) &&
      normalizedQuestion.length > 4
    ) {
      score += 40;
      reason = "lexical_exact_phrase";
    }

    let matched = 0;
    for (const term of terms) {
      if (haystack.includes(term)) {
        matched += 1;
        score += term.length > 4 ? 6 : 3;
      }
    }
    if (matched === terms.length && terms.length >= 2) {
      score += 12;
      reason = "lexical_all_terms";
    }

    // Title boost
    const title = normalizeSearchText(unit.title ?? "");
    if (title && terms.some((t) => title.includes(t))) score += 8;

    if (score <= 0) continue;
    hits.push({ unit, score, reason });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
