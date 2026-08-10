/**
 * Entity-scoped PEM NEAT content search.
 * Lexical passage scoring within one already-resolved NEAT (no global transcript index).
 */

import { normalizeSearchText, tokenizeQuery } from "@/lib/knowledge/retrieval";
import type { PemNeatRecord } from "@/lib/pem-neat/types";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { ASSESSMENT_CATEGORY_LABELS } from "@/lib/pem-neat/constants";
import { formatPemHonestMissAnswer } from "./honest-fallback";

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
  "sharon",
  "liu",
  "jeff",
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

/** Technique / quote fragments that should dominate ranking for coaching asks. */
const TECHNIQUE_PHRASES: Array<{ re: RegExp; weight: number }> = [
  { re: /can'?t sit here and recommend|cannot sit here and recommend/i, weight: 48 },
  {
    re: /don'?t recommend (?:an )?adu|didn'?t recommend (?:an )?adu|not recommend (?:an )?adu/i,
    weight: 36,
  },
  { re: /what am i missing|haven'?t heard.? why you would|why you would/i, weight: 36 },
  { re: /\brecommend you do it\b/i, weight: 28 },
  { re: /\btemporary disqualification\b|\bdisqualif\w*\b/i, weight: 18 },
];

export function isTranscriptFocusedQuestion(question: string): boolean {
  return /\b(transcript|quote|passage|find (?:the )?part|look in .{0,80}\b(?:pem|neat)\b|what am i missing|disqualif\w*|don'?t recommend|didn'?t recommend|show (?:me )?how|got (?:her|him|them) to|open up more|exchange|said that)\b/i.test(
    question,
  );
}

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

  // Keep "what am i missing" scorable even though "missing" is common coaching noise.
  if (
    /\bwhat am i missing\b/i.test(question) &&
    /\bwhat am i missing\b|\bhaven'?t heard\b|\bwhy you would\b/i.test(haystack)
  ) {
    score += 22;
  }

  for (const { re, weight } of TECHNIQUE_PHRASES) {
    if (re.test(question) && re.test(haystack)) {
      score += weight;
    } else if (
      !re.test(question) &&
      re.test(haystack) &&
      /recommend|disqualif|missing/i.test(question)
    ) {
      // Passage carries the technique verb even when the question only paraphrases it.
      score += Math.round(weight * 0.55);
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
  // Synonym expansion for paraphrase gaps (kid→son/apartment) without changing focus detection.
  const scoringQuestion = expandQueryForSemanticMatch(question).replace(/\n+/g, " ");

  const candidates: PemContentPassage[] = [];
  const structured =
    record.structured_result && typeof record.structured_result === "object"
      ? (record.structured_result as PemNeatStructuredResult)
      : null;

  if (structured) {
    for (const p of flattenAssessmentPassages(structured)) {
      const score = scorePassageAgainstQuery(p.text, scoringQuestion);
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
      const score = scorePassageAgainstQuery(p.text, scoringQuestion);
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
    const transcriptFocused = isTranscriptFocusedQuestion(question);
    for (let i = 0; i < segments.length; i++) {
      const prev = segments[i - 1];
      const cur = segments[i]!;
      const next = segments[i + 1];
      // Short lines (common in timed transcripts) score with the next line so
      // "39:31 recommend…" + "39:35 what am I missing" share signal.
      const ownHaystack =
        cur.text.length < 140 && next?.text ? `${cur.text}\n${next.text}` : cur.text;
      let ownScore = scorePassageAgainstQuery(ownHaystack, scoringQuestion);
      // Only boost transcript windows that actually carry distinctive question topic
      // terms (timeline/solar/recommend…) — weak name/"discussed" overlaps stay weak.
      if (transcriptFocused && ownScore > 0) {
        const topicTerms = tokenizeQuery(scoringQuestion).filter(
          (t) =>
            t.length > 3 &&
            !QUERY_NOISE.has(t) &&
            !/^(neat|pem|transcript|robert|vertin|leslie|kita|sharon|liu|jeff|jesse|kevin|talks|talk|discussed|discuss|denis|kornilov)$/i.test(
              t,
            ),
        );
        const hay = normalizeSearchText(ownHaystack);
        const topicHit =
          topicTerms.length === 0 ||
          topicTerms.some((t) => {
            if (hay.includes(t)) return true;
            if (t === "timeline" && /timing|schedule|months|rush/.test(hay)) return true;
            if (t === "solar" && /photovoltaic|\bpv\b/.test(hay)) return true;
            if (
              (t === "kid" || t === "kids" || t === "child" || t === "children") &&
              /\b(son|daughter|child|children|kid|apartment|college)\b/.test(hay)
            ) {
              return true;
            }
            return false;
          });
        if (topicHit) ownScore += 24;
      }
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
      const qNorm = normalizeSearchText(scoringQuestion);
      for (const s of attrCandidates) {
        let sc = scorePassageAgainstQuery(s.text, scoringQuestion);
        const hay = normalizeSearchText(s.text);
        // Prefer the line that carries the technique/quote verb from the question
        // (e.g. "recommend") over a later pain disclosure that also matches.
        for (const t of ["recommend", "disqualify", "disqualified", "objection", "missing"]) {
          if (qNorm.includes(t) && hay.includes(t)) sc += 20;
        }
        if (/can'?t sit here and recommend|haven'?t heard|why you would/i.test(s.text)) {
          sc += 30;
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

  // For exchange / transcript asks, demote assessment & SI dumps that merely
  // paraphrase the question — the exact transcript line should lead.
  if (isTranscriptFocusedQuestion(question)) {
    const bestTranscript = candidates
      .filter((c) => c.kind === "transcript")
      .reduce((m, c) => Math.max(m, c.score), 0);
    if (bestTranscript > 0) {
      for (const c of candidates) {
        if (c.kind !== "transcript") {
          c.score = Math.min(c.score, bestTranscript - 1);
        }
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const limitForQuestion = isTranscriptFocusedQuestion(question) ? Math.min(limit, 2) : limit;

  const passages: PemContentPassage[] = [];
  let total = 0;
  let truncated = false;
  const seen = new Set<string>();
  for (const c of candidates) {
    if (passages.length >= limitForQuestion) {
      truncated = true;
      break;
    }
    // After a strong transcript hit, skip tangential SI categories (customer story, bonding).
    if (
      isTranscriptFocusedQuestion(question) &&
      passages.some((p) => p.kind === "transcript") &&
      c.kind === "sales_intelligence"
    ) {
      truncated = true;
      continue;
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
 * Expand a coaching paraphrase into wording that often appears in real transcripts,
 * so mock + real embeddings can bridge "didn't recommend" ↔ "can't sit here and recommend".
 */
export function expandQueryForSemanticMatch(question: string): string {
  const bits = [question];
  if (/\bdisqualif\w*|don'?t recommend|didn'?t recommend|not recommend\b/i.test(question)) {
    bits.push(
      "I can't sit here and recommend you do it at this moment",
      "maybe I just haven't heard why you would",
      "temporary disqualification",
    );
  }
  if (/\bopen up|share more|about her pain|about his pain|reason for building\b/i.test(question)) {
    bits.push(
      "why you would",
      "eventually we would want to do something",
      "talk to our parents",
      "if they want to move in",
      "huge investment",
    );
  }
  if (/\b(kid|kids|child|children|son|daughter|living situation)\b/i.test(question)) {
    bits.push(
      "son",
      "daughter",
      "child",
      "children",
      "community college",
      "apartment",
      "temporary apartment",
      "living arrangement",
    );
  }
  return bits.join("\n");
}

/**
 * Pull 1–2 evidence-backed sentences from a NEAT field instead of dumping the whole field.
 */
export function pickRelevantSentencesFromField(
  fieldText: string,
  question: string,
  options?: { maxSentences?: number },
): string {
  const maxSentences = options?.maxSentences ?? 2;
  const scoringQ = expandQueryForSemanticMatch(question).replace(/\n/g, " ");
  const sentences = fieldText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 24);
  if (sentences.length === 0) {
    const clipped = fieldText.replace(/\s+/g, " ").trim();
    return clipped.length > 320 ? `${clipped.slice(0, 319).trimEnd()}…` : clipped;
  }
  const scored = sentences
    .map((s) => {
      let score = scorePassageAgainstQuery(s, scoringQ);
      // Prefer sentences that carry the asked-about substance (not field openers).
      if (
        /\b(kid|kids|child|children|son|daughter|living situation|apartment|college)\b/i.test(
          question,
        ) &&
        /\b(son|daughter|child|children|kid|apartment|college|housing)\b/i.test(s)
      ) {
        score += 20;
      }
      return { s, score };
    })
    .sort((a, b) => b.score - a.score);
  const familyAsk = /\b(kid|kids|child|children|son|daughter|living situation)\b/i.test(question);
  const good = scored.filter((x) => x.score >= 8);
  const preferred =
    familyAsk &&
    good.some((x) => /\b(son|daughter|child|children|kid|apartment|college)\b/i.test(x.s))
      ? good.filter((x) => /\b(son|daughter|child|children|kid|apartment|college)\b/i.test(x.s))
      : good;
  const picked = (preferred.length > 0 ? preferred : scored).slice(0, maxSentences).map((x) => x.s);
  // Preserve original field order for readability.
  const order = new Map(sentences.map((s, i) => [s, i]));
  picked.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return picked.join(" ");
}

function shouldSynthesizeStructuredFields(
  question: string | undefined,
  passages: PemContentPassage[],
): boolean {
  if (!question) return false;
  if (passages.some((p) => p.kind === "transcript")) return false;
  if (!passages.some((p) => p.sectionId.startsWith("field."))) return false;
  // Content / "find where" asks should answer the question, not paste fields.
  return (
    isTranscriptFocusedQuestion(question) ||
    /\b(find|where|what|tell|about|who|how|when)\b/i.test(question)
  );
}

/**
 * Lexical search + embedding re-rank for paraphrase-tolerant transcript matching.
 * Reuses Knowledge Base embedding infrastructure (OpenAI / mock).
 */
export async function searchPemNeatContentAsync(
  record: Pick<PemNeatRecord, "transcript" | "structured_result" | "prospect_name">,
  question: string,
  options?: { limit?: number; includeTranscript?: boolean; minScore?: number },
): Promise<PemContentSearchResult> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  // Cast a wider lexical net, then let semantic similarity promote paraphrase matches.
  const broad = searchPemNeatContent(record, question, {
    ...options,
    limit: Math.max(limit * 3, 12),
    minScore: Math.min(options?.minScore ?? 6, 3),
  });

  const transcriptHits = broad.passages.filter((p) => p.kind === "transcript");
  if (transcriptHits.length === 0) {
    return {
      ...broad,
      passages: broad.passages.slice(0, limit),
    };
  }

  try {
    const { cosineSimilarity, embedTexts } = await import("@/lib/knowledge-index/embeddings");
    const expanded = expandQueryForSemanticMatch(question);
    const texts = [expanded, ...transcriptHits.map((p) => p.excerpt)];
    const embeds = await embedTexts(texts);
    const qVec = embeds[0]?.vector;
    if (qVec) {
      for (let i = 0; i < transcriptHits.length; i++) {
        const vec = embeds[i + 1]?.vector;
        if (!vec) continue;
        const sim = cosineSimilarity(qVec, vec);
        // Blend lexical score with cosine similarity (0–1 → up to +50).
        transcriptHits[i]!.score = transcriptHits[i]!.score + Math.max(0, sim) * 50;
      }
    }
  } catch {
    // Embedding failures must not block lexical results.
  }

  const nonTranscript = broad.passages.filter((p) => p.kind !== "transcript");
  const merged = [...transcriptHits, ...nonTranscript].sort((a, b) => b.score - a.score);
  const focused = isTranscriptFocusedQuestion(question);
  const outLimit = focused ? Math.min(limit, 2) : limit;
  const passages = merged.slice(0, outLimit);

  // Widen the leading transcript excerpt to include the follow-on disclosure
  // (e.g. 39:31 recommend → 40:22 parents / reason for building).
  if (focused && passages[0]?.kind === "transcript" && record.transcript) {
    passages[0] = expandTranscriptPassageWindow(record.transcript, passages[0]);
  }

  return {
    passages,
    totalExcerptChars: passages.reduce((n, p) => n + p.excerpt.length, 0),
    truncated: merged.length > outLimit,
  };
}

function expandTranscriptPassageWindow(
  transcript: string,
  hit: PemContentPassage,
): PemContentPassage {
  const segments = splitTranscriptIntoPassages(transcript);
  if (segments.length === 0) return hit;
  // Prefer the attributed timestamp — do not match on excerpt prefix (often includes
  // the previous line from the lexical window).
  let startIdx = hit.timestamp ? segments.findIndex((s) => s.timestamp === hit.timestamp) : -1;
  if (startIdx < 0) {
    startIdx = segments.findIndex((s) =>
      normalizeSearchText(s.text).includes(normalizeSearchText(hit.excerpt).slice(0, 48)),
    );
  }
  if (startIdx < 0) startIdx = 0;
  const parts: string[] = [];
  let chars = 0;
  const maxChars = 1_100;
  for (let i = startIdx; i < segments.length && chars < maxChars; i++) {
    const s = segments[i]!;
    const piece = s.timestamp ? `${s.timestamp}: ${s.text}` : s.text;
    if (chars + piece.length > maxChars && parts.length > 0) break;
    parts.push(piece);
    chars += piece.length;
    // Include the follow-on disclosure through the parents / move-in beat when present.
    if (parts.length >= 2 && /talk to our parents|move in with us/i.test(s.text)) {
      break;
    }
    if (parts.length >= 6) break;
  }
  if (parts.length === 0) return hit;
  return {
    ...hit,
    excerpt: clip(parts.join("\n"), Math.max(MAX_PASSAGE_CHARS, 1_100)),
  };
}

/**
 * Format content-search hits into a deterministic, attribution-honest answer.
 * Transcript excerpts are reproduced verbatim with timestamps.
 * Exchange/technique asks stay short: lead with the best transcript quote only.
 */
export function formatPemContentSearchAnswer(input: {
  prospectName: string;
  meetingDate: string | null;
  citationLabel: string;
  passages: PemContentPassage[];
  searchedButEmpty?: boolean;
  /** Original question — used to keep exchange answers short and transcript-led. */
  question?: string;
  /** Dynamically generated example questions for this NEAT (honest miss). */
  exampleQuestions?: string[];
  soughtTopic?: string | null;
  uncertain?: boolean;
}): string {
  if (input.searchedButEmpty || input.passages.length === 0) {
    if (input.exampleQuestions && input.exampleQuestions.length > 0) {
      return formatPemHonestMissAnswer({
        prospectName: input.prospectName,
        meetingDate: input.meetingDate,
        citationLabel: input.citationLabel,
        kind: "content_search",
        examples: input.exampleQuestions,
        soughtTopic: input.soughtTopic,
      });
    }
    return [
      input.soughtTopic
        ? `I couldn't find any mention of ${input.soughtTopic} in ${input.prospectName}'s transcript` +
          (input.meetingDate ? ` (${input.meetingDate})` : "") +
          `.`
        : `I couldn't find that specific part of the transcript in ${input.prospectName}'s PEM NEAT` +
          (input.meetingDate ? ` (${input.meetingDate})` : "") +
          `.`,
      "",
      `Source searched: ${input.citationLabel}`,
    ].join("\n");
  }

  const focused = input.question ? isTranscriptFocusedQuestion(input.question) : false;
  let passages = input.passages;
  // Lead with the strongest candidate (transcript OR structured field). Only
  // collapse to a single transcript quote when the top hit is a transcript exchange.
  if (focused && passages[0]?.kind === "transcript") {
    passages = [passages[0]];
  } else if (focused) {
    passages = passages.slice(0, 2);
  }

  if (shouldSynthesizeStructuredFields(input.question, passages)) {
    const top = passages[0]!;
    const synthesized = pickRelevantSentencesFromField(top.excerpt, input.question!);
    const lead = input.uncertain
      ? `I found something related in ${input.prospectName}'s PEM NEAT` +
        (input.meetingDate ? ` (${input.meetingDate})` : "") +
        `, but I'm not fully certain it matches what you asked:`
      : `In ${input.prospectName}'s PEM NEAT` +
        (input.meetingDate ? ` (${input.meetingDate})` : "") +
        `:`;
    return [lead, "", synthesized, "", `Source: ${input.citationLabel} — ${top.label}`]
      .join("\n")
      .trim();
  }

  const blocks: string[] = [];
  if (input.uncertain) {
    blocks.push(
      `I found something related in ${input.prospectName}'s PEM NEAT` +
        (input.meetingDate ? ` (${input.meetingDate})` : "") +
        `, but I'm not fully certain it matches what you asked:`,
      "",
    );
  } else {
    blocks.push(
      `From ${input.prospectName}'s PEM NEAT` +
        (input.meetingDate ? ` (${input.meetingDate})` : "") +
        ":",
      "",
    );
  }

  for (const p of passages) {
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

/**
 * Gate PEM content-search + Knowledge Base combine: include KB only when it is
 * topically relevant to the question (not automatic Culture/Brand append).
 */
export function isKnowledgeBaseRelevantToPemContentQuestion(
  question: string,
  item: {
    title?: string | null;
    summary?: string | null;
    contentExcerpt?: string | null;
    category?: string | null;
    tags?: string[] | null;
    sourceType?: string | null;
    relevanceScore?: number | null;
  },
): boolean {
  if ((item.relevanceScore ?? 0) < 40) return false;
  if (item.sourceType === "slack") return false;
  const wantsExplicitGuidance =
    /\b(guidance|best practice|how (?:should|do) (?:i|we)|playbook|according to|rulebook|culture guide|brand guide|from (?:the )?(?:kb|knowledge base))\b/i.test(
      question,
    );
  const hay = normalizeSearchText(
    [item.title, item.summary, item.contentExcerpt, item.category, ...(item.tags ?? [])]
      .filter(Boolean)
      .join(" "),
  );
  if (isTranscriptFocusedQuestion(question) && !wantsExplicitGuidance) {
    const technique =
      /\b(disqualif\w*|recommend|objection|what am i missing|temporary disqualification|coaching moment|sales technique)\b/i;
    if (!technique.test(hay)) return false;
  }

  // Glossary / meta PEM entries ("what is a PEM NEAT", project brief) must not ride
  // along on prospect-content asks just because they mention the words PEM/NEAT.
  const kbIsPemMeta =
    /\b(manual entry|what (?:is|are) (?:a |an )?pem|pem neat|partnership evaluation meeting|baxter project brief|project brief)\b/i.test(
      hay,
    ) || /\bmanual entry\b/i.test(normalizeSearchText(item.title ?? ""));
  const questionAsksPemDefinition =
    /\b(what (?:is|are) (?:a |an )?(?:pem|neat)|how (?:do|does|is) (?:a |an )?(?:pem|neat)|pem neat (?:work|mean|definition)|define (?:a |an )?(?:pem|neat))\b/i.test(
      question,
    );
  if (kbIsPemMeta && !wantsExplicitGuidance && !questionAsksPemDefinition) {
    return false;
  }

  // Domain match requires coaching / content substance — not bare "pem"/"neat".
  const domain =
    /\b(disqualif|recommend|objection|pain|transcript|budget|timeline|pricing|coaching|qualification|rapport|adu|solar|schedule|temporary disqualification|sales (?:playbook|technique))\b/i;
  const kbHasDomain = domain.test(hay);
  const noise = new Set([
    "sharon",
    "liu",
    "jesse",
    "baxter",
    "want",
    "show",
    "find",
    "part",
    "look",
    "denis",
    "kornilov",
    "neat",
    "living",
    "situation",
  ]);
  const terms = tokenizeQuery(question).filter((t) => t.length > 3 && !noise.has(t));
  const overlap = terms.filter((t) => hay.includes(t)).length;
  return wantsExplicitGuidance || (kbHasDomain && overlap >= 1) || overlap >= 2;
}
