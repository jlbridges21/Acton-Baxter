/**
 * PEM content-search answer ladder:
 * gated transcript → relevant structured fields → honest miss.
 */

import { normalizeSearchText, tokenizeQuery } from "@/lib/knowledge/retrieval";
import type { PemNeatRecord } from "@/lib/pem-neat/types";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { getPemField, type PemFieldKey } from "./fields";
import {
  type PemContentPassage,
  scorePassageAgainstQuery,
  isTranscriptFocusedQuestion,
} from "./content-search";

/**
 * Calibrated against measured scores (ENABLE_MOCK_RESEARCH embeddings):
 * - Fail A (Vertin timeline → sewer chunk): lexical 35, async ≈55 — BELOW
 * - Fail B (Kita solar → weak name/discussed hit): typically ≪70 or no topic anchor — BELOW
 * - Known-good Sharon Liu 39:31: lexical 96, async ≈126 — ABOVE
 */
export const TRANSCRIPT_RELEVANCE_FLOOR = 70;

/** Structured fields may clear a slightly lower bar — they are curated NEAT content. */
export const STRUCTURED_FIELD_RELEVANCE_FLOOR = 50;

const META_QUERY_TERMS = new Set([
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
  "talks",
  "talk",
  "discussed",
  "discuss",
  "discussion",
  "neat",
  "pem",
  "transcript",
  "quote",
  "passage",
  "look",
  "kevin",
  "they",
  "them",
  "his",
  "her",
  "him",
  "she",
  "he",
]);

/** Synonyms so "timeline" questions can match Schedule field wording ("timing", "months"). */
const TOPIC_SYNONYMS: Record<string, string[]> = {
  timeline: ["timeline", "timing", "schedule", "months", "rush", "timeframe"],
  timing: ["timing", "timeline", "schedule", "months"],
  schedule: ["schedule", "timeline", "timing", "months"],
  deciding: ["deciding", "decide", "decision"],
  decision: ["decision", "deciding", "decide"],
  solar: ["solar", "photovoltaic", "pv"],
  panels: ["panels", "panel", "solar"],
  budget: ["budget", "pricing", "price", "cost", "afford"],
  pricing: ["pricing", "price", "budget", "cost"],
  recommend: ["recommend", "recommendation"],
  disqualified: ["disqualified", "disqualify", "disqualification"],
  disqualify: ["disqualify", "disqualified", "disqualification"],
  pain: ["pain", "why-now", "motivation"],
};

export function extractTopicAnchorTerms(question: string): string[] {
  const terms = tokenizeQuery(question).filter((t) => t.length > 3 && !META_QUERY_TERMS.has(t));
  return Array.from(
    new Set(
      terms.filter((t) => {
        if (/^(robert|vertin|leslie|kita|sharon|liu|jeff|jesse|kevin|alex|razel|talle)$/i.test(t)) {
          return false;
        }
        return true;
      }),
    ),
  );
}

export function passageMatchesTopicAnchors(haystack: string, question: string): boolean {
  const anchors = extractTopicAnchorTerms(question);
  if (anchors.length === 0) return true;
  const hay = normalizeSearchText(haystack);
  return anchors.some((anchor) => {
    const variants = TOPIC_SYNONYMS[anchor] ?? [anchor];
    return variants.some((v) => hay.includes(v));
  });
}

export function passesTranscriptRelevanceGate(input: {
  excerpt: string;
  score: number;
  question: string;
}): boolean {
  if (input.score < TRANSCRIPT_RELEVANCE_FLOOR) return false;
  return passageMatchesTopicAnchors(input.excerpt, input.question);
}

const LADDER_FIELD_KEYS: PemFieldKey[] = [
  "schedule",
  "budget",
  "decision_process",
  "type_1_pain",
  "type_2_pain",
  "customer_story",
  "customer_pain",
  "next_steps",
  "outcome",
  "qualification",
  "fit",
  "competition",
];

/**
 * Score curated NEAT fields as ladder candidates (Failure A: Schedule beats sewer transcript).
 */
export function scoreStructuredFieldCandidates(
  record: Pick<
    PemNeatRecord,
    "structured_result" | "salesperson_display_name" | "buildertrend_fields"
  >,
  question: string,
): PemContentPassage[] {
  const structured =
    record.structured_result && typeof record.structured_result === "object"
      ? (record.structured_result as PemNeatStructuredResult)
      : null;
  if (!structured) return [];

  const out: PemContentPassage[] = [];
  for (const key of LADDER_FIELD_KEYS) {
    const field = getPemField(structured, key, {
      salespersonName: record.salesperson_display_name,
      buildertrendFallback: (record.buildertrend_fields ?? {}) as Record<string, unknown>,
    });
    if (!field.determinable || field.lines.length === 0) continue;
    const text = field.lines.join("\n");
    let score = scorePassageAgainstQuery(text, question);
    // Boost when topic anchors clearly point at this field.
    if (passageMatchesTopicAnchors(text, question)) {
      score += 25;
    }
    // Timeline / schedule asks → prefer Schedule field even if transcript said "transcript".
    if (key === "schedule" && /\b(timeline|timing|schedule|when|months|rush)\b/i.test(question)) {
      score += 30;
    }
    if (key === "budget" && /\b(budget|pricing|price|cost|afford)\b/i.test(question)) {
      score += 30;
    }
    if (score < STRUCTURED_FIELD_RELEVANCE_FLOOR) continue;
    out.push({
      kind: "sales_intelligence",
      sectionId: `field.${key}`,
      label: `${field.label} (NEAT field)`,
      excerpt: text.length > 700 ? `${text.slice(0, 699).trimEnd()}…` : text,
      timestamp: null,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export type PemLadderResult = {
  candidates: PemContentPassage[];
  /** True when we are answering from a gated-but-not-stellar match. */
  uncertain: boolean;
  soughtTopic: string | null;
};

/**
 * Merge gated transcript hits with structured-field hits; pick top candidates.
 */
export function selectPemLadderCandidates(input: {
  question: string;
  transcriptPassages: PemContentPassage[];
  fieldPassages: PemContentPassage[];
  limit?: number;
}): PemLadderResult {
  const limit = input.limit ?? 3;
  const gatedTx = input.transcriptPassages.filter(
    (p) =>
      p.kind === "transcript" &&
      passesTranscriptRelevanceGate({
        excerpt: p.excerpt,
        score: p.score,
        question: input.question,
      }),
  );
  // Assessment/SI lexical hits must also clear the floor + topic anchors — otherwise
  // coaching notes that casually mention "timeline" steal the answer from Schedule.
  const gatedOther = input.transcriptPassages.filter(
    (p) =>
      p.kind !== "transcript" &&
      p.score >= TRANSCRIPT_RELEVANCE_FLOOR &&
      passageMatchesTopicAnchors(p.excerpt, input.question),
  );

  const merged = [...gatedTx, ...input.fieldPassages, ...gatedOther].sort(
    (a, b) => b.score - a.score,
  );

  const top = merged.slice(0, limit);
  const best = top[0];
  const uncertain = Boolean(
    best && best.kind === "transcript" && best.score < TRANSCRIPT_RELEVANCE_FLOOR + 25,
  );

  const anchors = extractTopicAnchorTerms(input.question);
  const soughtTopic =
    anchors.find((a) => /^(solar|panels|timeline|budget|pricing|objection)$/i.test(a)) ??
    anchors[0] ??
    null;

  // Prefer curated NEAT fields when they outrank a weak-but-gated transcript / assessment.
  if (
    isTranscriptFocusedQuestion(input.question) &&
    top.length > 1 &&
    top[0]?.kind !== "transcript" &&
    top[0]?.sectionId.startsWith("field.") &&
    top.some((p) => p.kind === "transcript")
  ) {
    const tx = top.find((p) => p.kind === "transcript");
    if (tx && (top[0]?.score ?? 0) >= tx.score + 10) {
      return {
        candidates: top.filter((p) => p.sectionId.startsWith("field.")).slice(0, 2),
        uncertain: false,
        soughtTopic,
      };
    }
  }

  return { candidates: top, uncertain, soughtTopic };
}
