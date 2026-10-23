/**
 * Deterministic ranking and highlighting for Global Search. Pure and client-safe; the same
 * code ranks live provider results, registry results, and index candidates.
 *
 * Tier order (best first): exact title/name → exact identifier → prefix → email/phone →
 * address → field → fuzzy (typos) → description. Contextual boosts (recent, pinned,
 * frequent) are capped below one tier step and only reorder results inside a tier.
 */

import {
  addressMatches,
  canonicalAddressWord,
  looksLikeAddress,
  normalizeAddressTokens,
  normalizeEmail,
  normalizeIdentifier,
  normalizePhone,
  normalizeText,
  tokenize,
} from "./normalize";
import { MATCH_TIERS, type HighlightRange, type MatchTier } from "./types";

export type MatchDoc = {
  title: string;
  subtitle?: string | null;
  /** Job number, SKU, order number, record id… compared exactly (ignoring separators). */
  identifiers?: Array<string | null | undefined>;
  emails?: Array<string | null | undefined>;
  phones?: Array<string | null | undefined>;
  addresses?: Array<string | null | undefined>;
  /** Other approved searchable values (custom fields, department, customer name…). */
  fields?: Array<string | null | undefined>;
  /** Hidden aliases (never displayed). */
  keywords?: Array<string | null | undefined>;
  description?: string | null;
};

export type MatchResult = { tier: MatchTier; score: number };

const TIER_INDEX = new Map(MATCH_TIERS.map((t, i) => [t, i]));
export const tierIndex = (t: MatchTier) => TIER_INDEX.get(t)!;

/** Optimal-string-alignment distance with an early exit once `max` is exceeded. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const cols = b.length + 1;
  // Three rolling rows (OSA needs i-2 for transpositions); no per-call matrix allocation.
  let prev2 = new Uint8Array(cols);
  let prev = new Uint8Array(cols);
  let cur = new Uint8Array(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = Math.min(v, 255);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[b.length]!;
}

/** Distance from `q` to the whole of `t` or to a prefix of `t` of similar length. */
function fuzzyPrefixDistance(q: string, t: string, max: number): number {
  let best = editDistance(q, t, max);
  for (let len = Math.max(1, q.length - max); len <= q.length + max && len < t.length; len++) {
    best = Math.min(best, editDistance(q, t.slice(0, len), max));
    if (best === 0) break;
  }
  return best;
}

/** Typos allowed for a query token of this length. */
function allowedTypos(len: number): number {
  if (len < 4) return 0;
  if (len < 7) return 1;
  return 2;
}

const clean = (list: Array<string | null | undefined> | undefined) =>
  (list ?? []).filter((v): v is string => typeof v === "string" && v.trim().length > 0);

function tokensOf(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) out.push(...tokenize(v));
  return out;
}

function allTokensPrefix(query: string[], doc: string[]): boolean {
  return query.length > 0 && query.every((q) => doc.some((d) => d.startsWith(q)));
}

function matchOnce(query: string, doc: MatchDoc, allowFuzzy: boolean): MatchResult | null {
  const qn = normalizeText(query);
  if (!qn) return null;
  const qTokens = qn.split(" ");
  const titleN = normalizeText(doc.title);
  const subtitle = doc.subtitle ?? "";
  const identifiers = clean(doc.identifiers);
  const emails = clean(doc.emails);
  const phones = clean(doc.phones);
  const addresses = clean(doc.addresses);
  const fields = clean(doc.fields);
  const keywords = clean(doc.keywords);

  // 1. Exact title / name.
  if (titleN === qn) return { tier: "exact", score: 900 };

  // 2. Exact identifier.
  const qId = normalizeIdentifier(query);
  if (qId && identifiers.some((id) => normalizeIdentifier(id) === qId)) {
    return { tier: "identifier", score: 900 };
  }
  const qEmail = normalizeEmail(query);
  if (qEmail.includes("@") && emails.some((e) => normalizeEmail(e) === qEmail)) {
    return { tier: "identifier", score: 850 };
  }
  const qPhone = normalizePhone(query);
  if (qPhone.length >= 7 && phones.some((p) => normalizePhone(p) === qPhone)) {
    return { tier: "identifier", score: 850 };
  }

  // 3. Prefix: title starts with the query, then a title word starts with it, then an alias.
  if (titleN.startsWith(qn)) {
    return { tier: "prefix", score: 800 - Math.min(titleN.length - qn.length, 300) };
  }
  if (` ${titleN}`.includes(` ${qn}`)) return { tier: "prefix", score: 450 };
  if (keywords.some((k) => normalizeText(k) === qn)) return { tier: "prefix", score: 400 };
  if (qId.length >= 3 && identifiers.some((id) => normalizeIdentifier(id).startsWith(qId))) {
    return { tier: "prefix", score: 350 };
  }

  // 4. Email / phone (partial).
  if (qEmail.length >= 3 && emails.some((e) => normalizeEmail(e).includes(qEmail))) {
    return { tier: "contact", score: 600 };
  }
  if (qPhone.length >= 4 && qPhone.length === query.replace(/[\s()+.-]/g, "").length) {
    if (phones.some((p) => normalizePhone(p).includes(qPhone))) {
      return { tier: "contact", score: 500 };
    }
  }

  // 5. Address (normalized: Street = St, North = N, Apt = #, ZIP+4 = ZIP).
  if (addresses.length > 0 && (looksLikeAddress(query) || qTokens.some((t) => t.length >= 3))) {
    for (const a of addresses) {
      if (!addressMatches(query, a)) continue;
      const q = normalizeAddressTokens(query).join(" ");
      const full = normalizeAddressTokens(a).join(" ");
      return { tier: "address", score: full.startsWith(q) ? 800 : 400 };
    }
  }

  // 6. Field match: every query word starts a word somewhere in the searchable fields.
  const fieldTokens = tokensOf([doc.title, subtitle, ...fields, ...keywords, ...identifiers]);
  if (allTokensPrefix(qTokens, fieldTokens)) {
    const titleTokens = tokenize(doc.title);
    const inTitle = qTokens.filter((q) => titleTokens.some((t) => t.startsWith(q))).length;
    return { tier: "field", score: 300 + Math.round((inTitle / qTokens.length) * 300) };
  }

  // 7. Fuzzy (typo tolerant): every long query word is within a small edit distance.
  //    Numbers never fuzzy-match (1003 must not find 1004), and a typo candidate must share
  //    the first letter or the first two letters swapped, which keeps this cheap.
  if (allowFuzzy && qTokens.some((t) => t.length >= 4 && !/\d/.test(t))) {
    const unique = [...new Set(fieldTokens)];
    let total = 0;
    let ok = true;
    for (const q of qTokens) {
      const max = /\d/.test(q) ? 0 : allowedTypos(q.length);
      let best = max + 1;
      for (const t of unique) {
        if (t.startsWith(q)) {
          best = 0;
          break;
        }
        if (max === 0 || !(t[0] === q[0] || (t[0] === q[1] && t[1] === q[0]))) continue;
        best = Math.min(best, fuzzyPrefixDistance(q, t, max));
        if (best === 0) break;
      }
      if (best > max) {
        ok = false;
        break;
      }
      total += best;
    }
    if (ok) return { tier: "fuzzy", score: Math.max(100, 600 - total * 150) };
  }

  // 8. Description.
  if (doc.description && allTokensPrefix(qTokens, tokenize(doc.description))) {
    return { tier: "description", score: 300 };
  }
  return null;
}

/**
 * Rank one document against a query. Admin synonyms (e.g. "hr" → "bamboohr") are tried only
 * when the literal query does not match, and a synonym hit is never better than a field match.
 */
export function matchDocument(
  query: string,
  doc: MatchDoc,
  options: { synonyms?: Map<string, string[]> } = {},
): MatchResult | null {
  const direct = matchOnce(query, doc, true);
  if (direct || !options.synonyms?.size) return direct;
  const tokens = tokenize(query);
  for (let i = 0; i < tokens.length; i++) {
    for (const alt of options.synonyms.get(tokens[i]!) ?? []) {
      const variant = [...tokens.slice(0, i), alt, ...tokens.slice(i + 1)].join(" ");
      const hit = matchOnce(variant, doc, false);
      if (hit) {
        const tier = tierIndex(hit.tier) < tierIndex("field") ? "field" : hit.tier;
        return { tier, score: Math.min(hit.score, 250) };
      }
    }
  }
  return null;
}

/** Context boost, always < 100 so it can never cross a tier (tier step is 1000). */
export function contextBoost(input: { recent?: boolean; pinned?: boolean; uses?: number }): number {
  let b = 0;
  if (input.pinned) b += 40;
  if (input.recent) b += 30;
  if (input.uses) b += Math.min(input.uses, 10) * 2.5;
  return Math.min(b, 99);
}

/** Single sortable number: tier dominates, within-tier score + boost orders the rest. */
export function combinedScore(match: MatchResult, boost = 0): number {
  return (MATCH_TIERS.length - tierIndex(match.tier)) * 1000 + Math.min(match.score, 899) + boost;
}

export function compareRanked(
  a: { tier: MatchTier; score: number; title: string },
  b: { tier: MatchTier; score: number; title: string },
): number {
  return (
    tierIndex(a.tier) - tierIndex(b.tier) || b.score - a.score || a.title.localeCompare(b.title)
  );
}

function stripMarks(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Character ranges in `text` to highlight for `query` (word prefixes, address synonyms, typos). */
export function highlightRanges(text: string | null | undefined, query: string): HighlightRange[] {
  if (!text) return [];
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const ranges: HighlightRange[] = [];
  const phrase = normalizeText(query);
  const lower = stripMarks(text);
  if (phrase.length >= 2 && lower.length === text.length) {
    const at = lower.indexOf(phrase);
    if (at >= 0 && (at === 0 || !/[a-z0-9]/.test(lower[at - 1]!))) {
      ranges.push([at, at + phrase.length]);
    }
  }
  const wordRe = /[\p{L}\p{N}]+/gu;
  for (const m of text.matchAll(wordRe)) {
    const word = stripMarks(m[0]);
    const start = m.index ?? 0;
    for (const q of qTokens) {
      // Address synonyms first, so "st" highlights all of "Street".
      if (canonicalAddressWord(word) === canonicalAddressWord(q) && word.length > 0) {
        ranges.push([start, start + m[0].length]);
        break;
      }
      if (word.startsWith(q)) {
        ranges.push([start, start + Math.min(q.length, m[0].length)]);
        break;
      }
      const max = /\d/.test(q) ? 0 : allowedTypos(q.length);
      if (max > 0 && word[0] === q[0] && fuzzyPrefixDistance(q, word, max) <= max) {
        ranges.push([start, start + m[0].length]);
        break;
      }
    }
  }
  return mergeRanges(ranges);
}

export function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: HighlightRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}
