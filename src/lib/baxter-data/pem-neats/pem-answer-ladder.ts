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

/**
 * Structured-field floor (Denis kid living situation, measured):
 * - Decision Process 57 / Competition 51 — false positives via weak "living"↔"Living Large"
 * - Customer Story 51 — true positive (son / college / apartment) but under-boosted
 * After synonym expansion + rejecting weak-only anchors, true fields clear ~80+;
 * keep floor at 62 so weak Living-Large collisions stay out even with a leftover boost.
 */
export const STRUCTURED_FIELD_RELEVANCE_FLOOR = 62;

/** Max structured/transcript candidates shown before synthesis (was 3 — too dump-y). */
export const PEM_LADDER_CANDIDATE_CAP = 2;

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
  "living",
  "situation",
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
  kid: ["kid", "kids", "child", "children", "son", "daughter", "college", "apartment"],
  kids: ["kid", "kids", "child", "children", "son", "daughter", "college", "apartment"],
  child: ["child", "children", "kid", "kids", "son", "daughter", "college", "apartment"],
  children: ["child", "children", "kid", "kids", "son", "daughter"],
  son: ["son", "child", "kid", "children", "daughter", "college", "apartment"],
  daughter: ["daughter", "child", "kid", "children", "son"],
  apartment: ["apartment", "housing", "rent", "renter", "living arrangement"],
  college: ["college", "community college", "school", "university"],
};

const PERSON_NAME_NOISE =
  /^(robert|vertin|leslie|kita|sharon|liu|jeff|jesse|kevin|alex|razel|talle|denis|deni|kornilov|cindy|lee|robin|mortarotti|normandie|ramirez)$/i;

export function extractTopicAnchorTerms(question: string): string[] {
  const terms = tokenizeQuery(question)
    .map((t) => t.replace(/[^a-z0-9]/gi, ""))
    .filter((t) => t.length > 3 && !META_QUERY_TERMS.has(t));
  return Array.from(
    new Set(
      terms.filter((t) => {
        if (PERSON_NAME_NOISE.test(t)) return false;
        return true;
      }),
    ),
  );
}

/** Expand question terms with topic synonyms for lexical scoring / sentence pick. */
export function expandQuestionWithTopicSynonyms(question: string): string {
  const anchors = extractTopicAnchorTerms(question);
  const extras: string[] = [];
  for (const a of anchors) {
    for (const v of TOPIC_SYNONYMS[a] ?? []) {
      if (!extras.includes(v)) extras.push(v);
    }
  }
  // Also expand raw family words even if filtered as short ("kid" is length 3).
  if (/\b(kid|kids|child|children|son|daughter)\b/i.test(question)) {
    for (const v of TOPIC_SYNONYMS.kid ?? []) {
      if (!extras.includes(v)) extras.push(v);
    }
  }
  return extras.length ? `${question} ${extras.join(" ")}` : question;
}

export function passageMatchesTopicAnchors(haystack: string, question: string): boolean {
  const anchors = extractTopicAnchorTerms(question);
  const familyAsk = /\b(kid|kids|child|children|son|daughter)\b/i.test(question);
  const effectiveAnchors = anchors.length > 0 ? anchors : familyAsk ? ["kid"] : [];
  if (effectiveAnchors.length === 0) return true;
  const hay = normalizeSearchText(haystack);
  return effectiveAnchors.some((anchor) => {
    const variants = TOPIC_SYNONYMS[anchor] ?? [anchor];
    return variants.some((v) => {
      const token = normalizeSearchText(v);
      if (!token) return false;
      // Word-boundary-ish: avoid "living" matching only as part of unrelated brands when
      // stronger family synonyms are available — prefer multi-char specific terms.
      return new RegExp(
        `(?:^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`,
      ).test(hay);
    });
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

  const scoringQuestion = expandQuestionWithTopicSynonyms(question);
  const requiresAnchor =
    extractTopicAnchorTerms(question).length > 0 ||
    /\b(kid|kids|child|children|son|daughter)\b/i.test(question);
  const out: PemContentPassage[] = [];
  for (const key of LADDER_FIELD_KEYS) {
    const field = getPemField(structured, key, {
      salespersonName: record.salesperson_display_name,
      buildertrendFallback: (record.buildertrend_fields ?? {}) as Record<string, unknown>,
    });
    if (!field.determinable || field.lines.length === 0) continue;
    const text = field.lines.join("\n");
    // Same discipline as transcript gate: topic anchors must hit when present.
    if (requiresAnchor && !passageMatchesTopicAnchors(text, question)) continue;
    let score = scorePassageAgainstQuery(text, scoringQuestion);
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
    if (
      key === "customer_story" &&
      /\b(kid|kids|child|children|son|daughter|living situation|apartment|college)\b/i.test(
        question,
      )
    ) {
      score += 20;
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
  const limit = input.limit ?? PEM_LADDER_CANDIDATE_CAP;
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
