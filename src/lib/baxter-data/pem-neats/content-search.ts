/**
 * Entity-scoped PEM NEAT content search.
 * Lexical passage scoring within one already-resolved NEAT (no global transcript index).
 */

import { normalizeSearchText, tokenizeQuery } from "@/lib/knowledge/retrieval";
import type { PemNeatRecord } from "@/lib/pem-neat/types";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { ASSESSMENT_CATEGORY_LABELS } from "@/lib/pem-neat/constants";

export type PemContentPassageKind =
  "transcript" | "assessment_category" | "assessment_summary" | "sales_intelligence";

export type PemContentPassage = {
  kind: PemContentPassageKind;
  /** Stable section id for attribution, e.g. "transcript@39:31" or "assessment.type1_pain". */
  sectionId: string;
  label: string;
  /** Exact excerpt — never paraphrase when quoting transcript. */
  excerpt: string;
  /** Transcript timestamp when kind === "transcript". */
  timestamp: string | null;
  score: number;
};

export type PemContentSearchResult = {
  passages: PemContentPassage[];
  /** Total characters of returned excerpts (for context budgeting). */
  totalExcerptChars: number;
  truncated: boolean;
};

const DEFAULT_LIMIT = 4;
const MAX_PASSAGE_CHARS = 700;
const MAX_TOTAL_CHARS = 3_600;
/** Skip ultra-common coaching/query noise when scoring against long transcripts. */
const QUERY_NOISE = new Set([
  "want",
  "show",
  "jesse",
  "baxter",
  "missing",
  "saying",
  "said",
  "share",
  "more",
  "about",
  "need",
  "needs",
  "please",
  "tell",
  "find",
  "part",
  "where",
  "how",
  "did",
  "advisor",
  "salesperson",
  "handle",
  "handled",
]);

/** Domain terms that alone can justify a passage hit (field-like coaching asks). */
const STRONG_SINGLE_TERMS = new Set([
  "budget",
  "timeline",
  "pricing",
  "objection",
  "pain",
  "recommend",
  "disqualify",
  "disqualified",
  "adu",
  "schedule",
  "decision",
]);

/** Score a haystack against a question using the same term/phrase weights as lexical-search. */
export function scorePassageAgainstQuery(haystack: string, question: string): number {
  const terms = tokenizeQuery(question).filter((t) => t.length > 2 && !QUERY_NOISE.has(t));
  const normalizedQuestion = normalizeSearchText(question);
  const hay = normalizeSearchText(haystack);
  if (!hay) return 0;

  let score = 0;
  if (normalizedQuestion && hay.includes(normalizedQuestion) && normalizedQuestion.length > 8) {
    score += 40;
  }

  // Multi-word fragments from the question (coaching moments / quoted paraphrases).
  const words = normalizedQuestion.split(/\s+/).filter((w) => w.length > 2 && !QUERY_NOISE.has(w));
  for (let n = Math.min(5, words.length); n >= 3; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(" ");
      if (phrase.length >= 12 && hay.includes(phrase)) {
        score += 18 + n * 2;
      }
    }
  }

  let matched = 0;
  for (const term of terms) {
    if (hay.includes(term)) {
      matched += 1;
      score += term.length > 4 ? 6 : 3;
    }
  }
  if (matched === terms.length && terms.length >= 2) score += 12;
  if (matched >= 3) score += 8;

  // Single weak term hits (e.g. "discuss" inside "discussing") must not clear the
  // passage threshold — require 2+ terms, a phrase/fragment bonus, or a strong domain term.
  if (matched < 2 && score < 18) {
    const strongAlone = terms.some((t) => STRONG_SINGLE_TERMS.has(t) && hay.includes(t));
    if (!strongAlone) return 0;
  }
  return score;
}

/**
 * Split a PEM transcript into timestamped segments.
 * Supports lines like "39:31: text" or "39:31 - text".
 */
export function splitTranscriptIntoPassages(transcript: string): Array<{
  timestamp: string | null;
  text: string;
}> {
  const raw = (transcript ?? "").trim();
  if (!raw) return [];

  const re = /(?:^|\n)\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[:.\-–—]\s*/g;
  const marks: Array<{ matchStart: number; bodyStart: number; timestamp: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    marks.push({
      matchStart: m.index,
      bodyStart: m.index + m[0].length,
      timestamp: m[1]!,
    });
  }

  if (marks.length === 0) {
    return raw
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40)
      .map((text) => ({ timestamp: null as string | null, text }));
  }

  const out: Array<{ timestamp: string | null; text: string }> = [];
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i]!;
    const end = i + 1 < marks.length ? marks[i + 1]!.matchStart : raw.length;
    const body = raw.slice(cur.bodyStart, end).trim();
    if (body.length >= 20) out.push({ timestamp: cur.timestamp, text: body });
  }
  return out;
}

function clip(text: string, max = MAX_PASSAGE_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function flattenAssessmentPassages(
  structured: PemNeatStructuredResult,
): Array<{ sectionId: string; label: string; text: string; kind: PemContentPassageKind }> {
  const out: Array<{
    sectionId: string;
    label: string;
    text: string;
    kind: PemContentPassageKind;
  }> = [];
  const a = structured.assessment;
  if (!a) return out;

  if (a.topStrengths?.length) {
    out.push({
      sectionId: "assessment.topStrengths",
      label: "Top Strengths (NEAT assessment)",
      text: a.topStrengths.join("; "),
      kind: "assessment_summary",
    });
  }
  if (a.topImprovements?.length) {
    out.push({
      sectionId: "assessment.topImprovements",
      label: "Top Improvements (NEAT assessment)",
      text: a.topImprovements.join("; "),
      kind: "assessment_summary",
    });
  }
  if (a.oneThing?.trim()) {
    out.push({
      sectionId: "assessment.oneThing",
      label: "The One Thing (NEAT assessment)",
      text: a.oneThing.trim(),
      kind: "assessment_summary",
    });
  }

  for (const cat of a.categories ?? []) {
    const label =
      ASSESSMENT_CATEGORY_LABELS[cat.key as keyof typeof ASSESSMENT_CATEGORY_LABELS] ??
      cat.label ??
      cat.key;
    const parts = [
      cat.evidence ? `Evidence: ${cat.evidence}` : "",
      cat.whatWorked ? `What worked: ${cat.whatWorked}` : "",
      cat.coachingOpportunity ? `Coaching: ${cat.coachingOpportunity}` : "",
    ].filter(Boolean);
    if (parts.length === 0) continue;
    out.push({
      sectionId: `assessment.${cat.key}`,
      label: `${label} (NEAT assessment)`,
      text: parts.join("\n"),
      kind: "assessment_category",
    });
  }
  return out;
}

function flattenSalesIntelligencePassages(
  structured: PemNeatStructuredResult,
): Array<{ sectionId: string; label: string; text: string; kind: PemContentPassageKind }> {
  const si = structured.salesIntelligence;
  if (!si) return [];

  const stringify = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "text" in item) {
            return String((item as { text?: unknown }).text ?? "");
          }
          if (item && typeof item === "object" && "value" in item) {
            return String((item as { value?: unknown }).value ?? "");
          }
          return JSON.stringify(item);
        })
        .filter(Boolean)
        .join("; ");
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.summary === "string" && obj.summary.trim()) return obj.summary.trim();
      if (typeof obj.process === "string" && obj.process.trim()) return obj.process.trim();
      return Object.values(obj)
        .filter((v) => typeof v === "string" && v.trim())
        .join("; ");
    }
    return String(value);
  };

  const rows: Array<{ id: string; label: string; value: string }> = [
    { id: "customerStory", label: "Customer Story", value: stringify(si.customerStory) },
    { id: "customerPain", label: "Customer Pain", value: stringify(si.customerPain) },
    { id: "type1Pain", label: "Type 1 Pain", value: stringify(si.type1Pain) },
    { id: "type2Pain", label: "Type 2 Pain", value: stringify(si.type2Pain) },
    { id: "budget", label: "Budget", value: stringify(si.budget) },
    { id: "decisionProcess", label: "Decision Process", value: stringify(si.decisionProcess) },
    { id: "schedule", label: "Schedule", value: stringify(si.schedule) },
    { id: "nextSteps", label: "Next Steps", value: stringify(si.nextSteps) },
    {
      id: "actonRecommendation",
      label: "Acton Recommendation",
      value: stringify(si.actonRecommendation),
    },
  ];
  return rows
    .filter((r) => r.value && r.value.trim().length > 8)
    .map((r) => ({
      sectionId: `salesIntelligence.${r.id}`,
      label: `${r.label} (NEAT sales intelligence)`,
      text: r.value.trim(),
      kind: "sales_intelligence" as const,
    }));
}

/**
 * Search within one resolved NEAT for passages relevant to the question.
 * Entity-scoped only — callers must already resolve the PEM record.
 */
export function searchPemNeatContent(
  record: Pick<PemNeatRecord, "transcript" | "structured_result" | "prospect_name">,
  question: string,
  options?: { limit?: number; includeTranscript?: boolean; minScore?: number },
): PemContentSearchResult {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const minScore = options?.minScore ?? 6;
  const includeTranscript = options?.includeTranscript !== false;

  const candidates: PemContentPassage[] = [];
  const structured =
    record.structured_result && typeof record.structured_result === "object"
      ? (record.structured_result as PemNeatStructuredResult)
      : null;

  if (structured) {
    for (const p of flattenAssessmentPassages(structured)) {
      const score = scorePassageAgainstQuery(p.text, question);
      if (score >= minScore) {
        candidates.push({
          kind: p.kind,
          sectionId: p.sectionId,
          label: p.label,
          excerpt: clip(p.text),
          timestamp: null,
          score,
        });
      }
    }
    for (const p of flattenSalesIntelligencePassages(structured)) {
      const score = scorePassageAgainstQuery(p.text, question);
      if (score >= minScore) {
        candidates.push({
          kind: p.kind,
          sectionId: p.sectionId,
          label: p.label,
          excerpt: clip(p.text),
          timestamp: null,
          score,
        });
      }
    }
  }

  if (includeTranscript && record.transcript?.trim()) {
    // Score each timestamped segment on its own text so attribution stays accurate;
    // include short neighbors only in the returned excerpt for context.
    const segments = splitTranscriptIntoPassages(record.transcript);
    for (let i = 0; i < segments.length; i++) {
      const prev = segments[i - 1];
      const cur = segments[i]!;
      const next = segments[i + 1];
      // Short lines (common in timed transcripts) score with the next line so
      // "39:31 recommend…" + "39:35 what am I missing" share signal.
      const ownHaystack =
        cur.text.length < 140 && next?.text ? `${cur.text}\n${next.text}` : cur.text;
      const ownScore = scorePassageAgainstQuery(ownHaystack, question);
      if (ownScore < minScore) continue;
      const prevText = prev && prev.text.length <= 280 ? prev.text : null;
      const nextText = next && next.text.length <= 280 ? next.text : null;
      const windowText = [prevText, cur.text, nextText].filter(Boolean).join("\n");
      // Attribute to the window line that best matches the question (not merely the
      // loop index), so short coaching lines keep their true timestamps.
      const attrCandidates = [prev, cur, next].filter(
        (s): s is { timestamp: string | null; text: string } => Boolean(s && s.text.length <= 280),
      );
      let attr = cur;
      let attrScore = -1;
      const qNorm = normalizeSearchText(question);
      for (const s of attrCandidates) {
        let sc = scorePassageAgainstQuery(s.text, question);
        const hay = normalizeSearchText(s.text);
        // Prefer the line that carries the technique/quote verb from the question
        // (e.g. "recommend") over a later pain disclosure that also matches.
        for (const t of ["recommend", "disqualify", "disqualified", "objection"]) {
          if (qNorm.includes(t) && hay.includes(t)) sc += 20;
        }
        if (sc > attrScore) {
          attr = s;
          attrScore = sc;
        }
      }
      const stamp = attr.timestamp ?? cur.timestamp;
      candidates.push({
        kind: "transcript",
        sectionId: stamp ? `transcript@${stamp}` : `transcript#${i}`,
        label: stamp ? `Transcript quote (${stamp})` : "Transcript quote",
        excerpt: clip(windowText),
        timestamp: stamp,
        score: ownScore + (stamp ? 2 : 0),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const passages: PemContentPassage[] = [];
  let total = 0;
  let truncated = false;
  const seen = new Set<string>();
  for (const c of candidates) {
    if (passages.length >= limit) {
      truncated = true;
      break;
    }
    if (seen.has(c.sectionId)) continue;
    if (total + c.excerpt.length > MAX_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    seen.add(c.sectionId);
    passages.push(c);
    total += c.excerpt.length;
  }

  return { passages, totalExcerptChars: total, truncated };
}

/**
 * Format content-search hits into a deterministic, attribution-honest answer.
 * Transcript excerpts are reproduced verbatim with timestamps.
 */
export function formatPemContentSearchAnswer(input: {
  prospectName: string;
  meetingDate: string | null;
  citationLabel: string;
  passages: PemContentPassage[];
  searchedButEmpty?: boolean;
}): string {
  if (input.searchedButEmpty || input.passages.length === 0) {
    return [
      `I searched ${input.prospectName}'s PEM NEAT` +
        (input.meetingDate ? ` (${input.meetingDate})` : "") +
        ` for relevant transcript and assessment passages but did not find a clear match.`,
      "",
      `Source searched: ${input.citationLabel}`,
    ].join("\n");
  }

  const blocks: string[] = [
    `From ${input.prospectName}'s PEM NEAT` +
      (input.meetingDate ? ` (${input.meetingDate})` : "") +
      ":",
    "",
  ];

  for (const p of input.passages) {
    if (p.kind === "transcript") {
      blocks.push(
        p.timestamp
          ? `Transcript quote (${p.timestamp}) — exact wording from the NEAT transcript:`
          : "Transcript quote — exact wording from the NEAT transcript:",
      );
      blocks.push(`"${p.excerpt}"`);
      blocks.push("");
    } else {
      blocks.push(`${p.label}:`);
      blocks.push(p.excerpt);
      blocks.push("");
    }
  }

  blocks.push(`Source: ${input.citationLabel}`);
  return blocks.join("\n").trim();
}
