/**
 * Lightweight saved-PEM prospect index for name-gated entity matching.
 * Used before PEM record retrieval — never dump full NEATs into the LLM for matching.
 */
import "server-only";

import { getPemNeatStore } from "@/lib/pem-neat/store";
import type { PemNeatListItem } from "@/lib/pem-neat/types";

export type PemProspectIndexEntry = {
  pemId: string;
  prospectName: string;
  normalizedName: string;
  baseName: string;
  normalizedBase: string;
  salesperson: string;
  meetingDate: string | null;
  status: string;
};

export type PemProspectMatch = {
  entry: PemProspectIndexEntry;
  score: number;
};

const MATCH_THRESHOLD = 60;

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripDiscriminator(prospectName: string): string {
  return prospectName
    .replace(/\s+(test|pem|neat|meeting|version|v|#)\s*[\w.-]+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value: string): string[] {
  return normalizeName(value).split(" ").filter(Boolean);
}

function scoreNameMatch(prospectName: string, query: string): number {
  const p = normalizeName(prospectName);
  const q = normalizeName(query);
  if (!q) return 0;
  if (p === q) return 100;
  if (p.includes(q) || q.includes(p)) return 80;
  const baseP = normalizeName(stripDiscriminator(prospectName));
  if (baseP && (baseP === q || baseP.includes(q) || q.includes(baseP))) return 75;
  const pt = nameTokens(prospectName);
  const qt = nameTokens(query);
  if (qt.length === 1) return pt.includes(qt[0]!) ? 60 : 0;
  const overlap = qt.filter((t) => pt.includes(t)).length;
  if (overlap === qt.length) return 90;
  if (overlap > 0) return 40 + overlap * 10;
  return 0;
}

export function toProspectIndexEntry(row: PemNeatListItem): PemProspectIndexEntry {
  const base = stripDiscriminator(row.prospect_name) || row.prospect_name;
  return {
    pemId: row.id,
    prospectName: row.prospect_name,
    normalizedName: normalizeName(row.prospect_name),
    baseName: base,
    normalizedBase: normalizeName(base),
    salesperson: row.salesperson_display_name,
    meetingDate: row.meeting_date ?? null,
    status: row.status,
  };
}

/**
 * Build an in-memory prospect index from completed (and optionally stale) PEMs.
 */
export async function buildPemProspectIndex(options?: {
  includeNeedsRegeneration?: boolean;
}): Promise<PemProspectIndexEntry[]> {
  const store = getPemNeatStore();
  const completed = await store.list({ status: "completed" });
  const stale = options?.includeNeedsRegeneration
    ? await store.list({ status: "needs_regeneration" })
    : [];
  const seen = new Set<string>();
  const entries: PemProspectIndexEntry[] = [];
  for (const row of [...completed, ...stale]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    entries.push(toProspectIndexEntry(row));
  }
  return entries;
}

/**
 * Match a candidate person name against the saved PEM prospect index.
 * Returns confident matches only — rejects generic phrases.
 */
export function matchProspectInIndex(
  candidateName: string | null | undefined,
  index: PemProspectIndexEntry[],
  threshold = MATCH_THRESHOLD,
): PemProspectMatch[] {
  const q = (candidateName ?? "").trim();
  if (!q || index.length === 0) return [];

  const scored: PemProspectMatch[] = [];
  for (const entry of index) {
    const score = Math.max(
      scoreNameMatch(entry.prospectName, q),
      scoreNameMatch(entry.baseName, q),
      scoreNameMatch(entry.prospectName, stripDiscriminator(q) || q),
    );
    if (score >= threshold) {
      scored.push({ entry, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function hasConfidentProspectMatch(
  candidateName: string | null | undefined,
  index: PemProspectIndexEntry[],
  threshold = MATCH_THRESHOLD,
): boolean {
  return matchProspectInIndex(candidateName, index, threshold).length > 0;
}
