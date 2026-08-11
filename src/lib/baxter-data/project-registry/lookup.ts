/**
 * Deterministic lookups / filters / counts against Master Project Log rows.
 */

import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";
import type { ProjectLogRow } from "./types";

function norm(s: string): string {
  return (normalizeEntitySearchName(s) || s).trim().toLowerCase();
}

function scoreRow(row: ProjectLogRow, query: string): number {
  const q = norm(query);
  if (!q) return 0;
  let best = 0;
  const short = norm(row.shortName);
  const customer = norm(row.customerName);
  const number = norm(row.projectNumber);
  const numberBare = number.replace(/^#/, "");

  if (numberBare === q || number === q) best = Math.max(best, 100);
  if (short === q) best = Math.max(best, 98);
  if (customer === q) best = Math.max(best, 96);
  if (short && (short.includes(q) || q.includes(short))) best = Math.max(best, 85);
  if (customer && (customer.includes(q) || q.includes(customer))) best = Math.max(best, 80);
  if (numberBare.includes(q) || q.includes(numberBare)) best = Math.max(best, 75);

  // "Alvin Yeh" vs short name "Yeh"
  const qTokens = q.split(/\s+/).filter(Boolean);
  const last = qTokens[qTokens.length - 1] ?? "";
  if (last.length >= 2 && short === last) best = Math.max(best, 90);
  if (last.length >= 2 && customer.split(/\s+/).includes(last) && qTokens.length === 1) {
    best = Math.max(best, 70);
  }
  return best;
}

export type ProjectLookupResult =
  | { kind: "unique"; row: ProjectLogRow; score: number }
  | { kind: "ambiguous"; rows: ProjectLogRow[] }
  | { kind: "none" };

/**
 * Resolve a project by number, short name, or customer name.
 */
export function lookupProjectRow(rows: ProjectLogRow[], query: string): ProjectLookupResult {
  const scored = rows
    .map((row) => ({ row, score: scoreRow(row, query) }))
    .filter((x) => x.score >= 70)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: "none" };
  const top = scored[0]!;
  const tied = scored.filter(
    (x) => x.score >= top.score - 5 && x.row.projectNumber !== top.row.projectNumber,
  );
  if (tied.length > 0 && top.score < 95) {
    return { kind: "ambiguous", rows: [top.row, ...tied.map((t) => t.row)].slice(0, 6) };
  }
  // Exact / near-exact unique win
  const exactPeers = scored.filter((x) => x.score === top.score);
  if (exactPeers.length > 1) {
    return { kind: "ambiguous", rows: exactPeers.map((p) => p.row).slice(0, 6) };
  }
  return { kind: "unique", row: top.row, score: top.score };
}

export function filterProjectsByCity(rows: ProjectLogRow[], city: string): ProjectLogRow[] {
  const c = norm(city);
  if (!c) return [];
  return rows.filter((r) => {
    const cityN = norm(r.city);
    const jur = norm(r.jurisdiction);
    return cityN === c || cityN.includes(c) || c.includes(cityN) || jur === c || jur.includes(c);
  });
}

export function countProjects(
  rows: ProjectLogRow[],
  filters: { city?: string | null; salesperson?: string | null; year?: number | null },
): { count: number; rows: ProjectLogRow[] } {
  let filtered = rows;
  if (filters.city?.trim()) {
    filtered = filterProjectsByCity(filtered, filters.city);
  }
  if (filters.salesperson?.trim()) {
    const s = norm(filters.salesperson);
    filtered = filtered.filter((r) => {
      const n = norm(r.salesperson);
      return n === s || n.includes(s) || s.includes(n);
    });
  }
  if (filters.year) {
    const y = String(filters.year);
    filtered = filtered.filter((r) => r.startDate.includes(y));
  }
  return { count: filtered.length, rows: filtered };
}

/** Slack channel slug convention: l01-26016-yeh */
export function expectedSlackChannelSlug(row: ProjectLogRow): string | null {
  const num = row.projectNumber.trim().toLowerCase();
  const short = row.shortName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!num || !short) return null;
  return `${num}-${short}`;
}
