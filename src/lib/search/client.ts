/**
 * Browser-side helpers for Global Search: NDJSON stream reading, section building, relative
 * freshness labels, and the "Ask Baxter" hand-off to the existing chat. Client-safe.
 */

import { tierIndex } from "./rank";
import {
  SEARCH_CATEGORIES,
  categoryLabel,
  type ProviderOutcome,
  type SearchCategoryId,
  type SearchResult,
  type SearchStreamEvent,
} from "./types";

/** Read an NDJSON response, calling onEvent per line. Resolves when the stream ends. */
export async function readSearchStream(
  response: Response,
  onEvent: (event: SearchStreamEvent) => void,
): Promise<void> {
  if (!response.body) {
    const text = await response.text();
    for (const line of text.split("\n"))
      if (line.trim()) onEvent(JSON.parse(line) as SearchStreamEvent);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as SearchStreamEvent);
      nl = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as SearchStreamEvent);
}

export type SearchSection = {
  category: SearchCategoryId;
  label: string;
  results: SearchResult[];
  /** Matching results the viewer may see (never counts hidden records). */
  count: number;
  hasMore: boolean;
};

/**
 * Group results into category sections. Sections with a better best match come first (an
 * exact customer name outranks a fuzzy tool); ties keep the fixed category order.
 */
export function buildSections(
  results: SearchResult[],
  outcomes: ProviderOutcome[],
  perSection: number,
): SearchSection[] {
  const order = new Map(SEARCH_CATEGORIES.map((c, i) => [c.id, i]));
  const byCategory = new Map<SearchCategoryId, SearchResult[]>();
  for (const r of results) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  const sections: SearchSection[] = [];
  for (const [category, list] of byCategory) {
    const sorted = [...list].sort(
      (a, b) =>
        tierIndex(a.tier) - tierIndex(b.tier) ||
        b.score - a.score ||
        a.title.localeCompare(b.title),
    );
    const related = outcomes.filter((o) => o.category === category);
    const count = related.reduce((n, o) => n + o.count, 0) || sorted.length;
    sections.push({
      category,
      label: categoryLabel(category),
      results: sorted.slice(0, perSection),
      count: Math.max(count, sorted.length),
      hasMore: related.some((o) => o.hasMore) || count > perSection || sorted.length > perSection,
    });
  }
  return sections.sort((a, b) => {
    const ta = a.results[0] ? tierIndex(a.results[0].tier) : 99;
    const tb = b.results[0] ? tierIndex(b.results[0].tier) : 99;
    return ta - tb || (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0);
  });
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** "JobTread · Last synced 12 min ago" for cached data; just the source for live data. */
export function sourceLine(result: SearchResult, now = Date.now()): string {
  if (result.freshness.kind === "cached") {
    const rel = formatRelative(result.freshness.syncedAt, now);
    return `${result.sourceLabel} · ${result.freshness.label} ${rel ?? "time unknown"}`;
  }
  return result.sourceLabel;
}

export function countLabel(count: number, hasMore: boolean): string {
  return `${count}${hasMore && count > 0 ? "+" : ""} result${count === 1 && !hasMore ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Ask Baxter hand-off (sessionStorage, never the URL: queries can contain names)
// ---------------------------------------------------------------------------

export const ASK_BAXTER_DRAFT_KEY = "baxter.chat.draft";
export const ASK_BAXTER_EVENT = "baxter:ask";

export function handOffToBaxter(question: string) {
  try {
    window.sessionStorage.setItem(ASK_BAXTER_DRAFT_KEY, question.slice(0, 500));
  } catch {
    // storage unavailable: the event below still reaches a mounted chat
  }
  window.dispatchEvent(new CustomEvent(ASK_BAXTER_EVENT, { detail: { question } }));
}

export function takeBaxterDraft(): string | null {
  try {
    const v = window.sessionStorage.getItem(ASK_BAXTER_DRAFT_KEY);
    if (v) window.sessionStorage.removeItem(ASK_BAXTER_DRAFT_KEY);
    return v;
  } catch {
    return null;
  }
}
