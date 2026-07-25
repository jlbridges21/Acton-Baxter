import { inferRequestedFieldsFromQuestion } from "./aliases";
import type { KnowledgeQueryPlan } from "./types";
import { normalizeEntityText } from "./values";

const STOP = new Set([
  "a",
  "an",
  "the",
  "for",
  "of",
  "to",
  "in",
  "on",
  "was",
  "were",
  "is",
  "are",
  "what",
  "when",
  "how",
  "much",
  "many",
  "did",
  "does",
  "do",
  "our",
  "we",
  "project",
  "projects",
  "report",
  "trailing",
  "two",
  "year",
  "years",
]);

/**
 * Deterministic knowledge query planner — never turns user text into SQL.
 */
export function planKnowledgeQuery(question: string): KnowledgeQueryPlan {
  const raw = question.trim();
  const q = raw.toLowerCase();
  const requestedFields = inferRequestedFieldsFromQuestion(raw);
  if (/\bhow many (projects|contracts)\b|\bnumber of projects\b/i.test(raw)) {
    if (!requestedFields.includes("Total Contracts")) requestedFields.unshift("Total Contracts");
  }
  const entities = extractEntities(raw);
  const keywords = tokenize(raw);

  const wantsAggregate =
    /\b(how many|average|avg|total|sum|largest|highest|lowest|smallest|min|max)\b/i.test(q) ||
    requestedFields.some((f) => /total |avg |average /i.test(f));

  const wantsStructured =
    entities.length > 0 ||
    requestedFields.length > 0 ||
    /\b(agreement|margin|sq\.?\s*ft|close date|custom|build ready|lori|harris)\b/i.test(q) ||
    wantsAggregate;

  let aggregation: KnowledgeQueryPlan["aggregation"] = null;
  if (/\bhow many\b|\bcount\b|\btotal contracts\b|\bnumber of\b/i.test(q)) aggregation = "count";
  else if (/\baverage\b|\bavg\b/i.test(q)) aggregation = "average";
  else if (/\blargest\b|\bhighest\b|\bmax\b/i.test(q)) aggregation = "max";
  else if (/\bsmallest\b|\blowest\b|\bmin\b/i.test(q)) aggregation = "min";
  else if (/\btotal\b|\bsum\b/i.test(q) && !/\btotal contracts\b/i.test(q)) aggregation = "sum";

  const filters: KnowledgeQueryPlan["filters"] = [];
  if (
    /\bbuild ready\b|\b\bbr\b projects?\b/i.test(q) &&
    !/\bor custom\b|\bbr or custom\b|\bbuild ready or custom\b/i.test(q)
  ) {
    filters.push({ field: "Project Type (BR/Custom)", value: "BR" });
  }
  if (
    /\bcustom\b/i.test(q) &&
    /\b(projects?|type|average|avg|how many)\b/i.test(q) &&
    !/\bor custom\b|\bbr or custom\b|\bbuild ready or custom\b|\bwas .+ (build ready|custom)\b/i.test(
      q,
    )
  ) {
    filters.push({ field: "Project Type (BR/Custom)", value: "Custom" });
  }

  let mode: KnowledgeQueryPlan["mode"] = "document";
  if (wantsStructured && aggregation && entities.length === 0) {
    mode = "structured_aggregate";
  } else if (wantsStructured && entities.length > 0) {
    mode = "structured_lookup";
  } else if (wantsStructured) {
    mode = "hybrid";
  }

  // Summary metric style questions without a person name
  if (entities.length === 0 && requestedFields.some((f) => /total |avg /i.test(f))) {
    mode = "structured_aggregate";
  }

  // If the only entities look like report nouns, treat as aggregate
  const personLike = entities.filter(
    (e) => !/trailing|report|agreement|margin|total|average|project/i.test(e),
  );
  if (
    personLike.length === 0 &&
    requestedFields.some((f) => /total |avg |average /i.test(f) || f === "Total Contracts")
  ) {
    mode = "structured_aggregate";
    return {
      mode,
      entities: [],
      requestedFields,
      filters,
      aggregation: aggregation ?? (requestedFields.includes("Total Contracts") ? "count" : null),
      keywords,
      rawQuestion: raw,
    };
  }

  return {
    mode,
    entities: personLike.length ? personLike : entities,
    requestedFields,
    filters,
    aggregation,
    keywords,
    rawQuestion: raw,
  };
}

function tokenize(question: string): string[] {
  return normalizeEntityText(question)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Extract likely person/project entity phrases from the question.
 */
export function extractEntities(question: string): string[] {
  const entities: string[] = [];

  // Quoted names
  const quoted = question.match(/"([^"]+)"|'([^']+)'/g);
  if (quoted) {
    for (const q of quoted) entities.push(q.replace(/['"]/g, "").trim());
  }

  // "Lori Harris project" / "for Lori Harris" / "Lori Harris's"
  const patterns = [
    /\b(?:for|on|about|did|was|were)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})(?:['’]s)?\b/i,
    /\b([A-Z][a-z]+\s+[A-Z][a-z]+)(?:['’]s)?\b/,
    /\b(?:project|customer|client)\s+([A-Za-z][A-Za-z\s-]{1,40}?)\s+(?:agreement|close|cost|margin|for)\b/i,
  ];
  for (const re of patterns) {
    const m = question.match(re);
    if (m?.[1]) {
      const name = m[1].trim().replace(/['’]s$/i, "");
      if (name.length >= 3 && !/^(What|When|How|Which|Our|The|Total|Was|Were)$/i.test(name)) {
        entities.push(name);
      }
    }
  }

  // Lowercase fallback: "lori harris" — strip leading interrogatives
  let lower = question.toLowerCase();
  lower = lower.replace(/^(what|when|how|which|was|were|did|does|is|are|who)\s+/g, "");
  lower = lower.replace(/^(what|when|how|which|was|were|did|does|is|are|who)\s+/g, "");
  const nameLike = lower.match(/\b([a-z]{3,})\s+([a-z]{3,})\b/);
  if (nameLike && !STOP.has(nameLike[1]!) && !STOP.has(nameLike[2]!)) {
    const skipPairs = new Set([
      "how much",
      "how many",
      "what was",
      "when did",
      "project agreement",
      "internal cost",
      "gross margin",
      "close date",
      "square footage",
      "trailing two",
      "two year",
      "agreement amount",
      "build ready",
      "or custom",
    ]);
    const pair = `${nameLike[1]} ${nameLike[2]}`;
    if (
      !skipPairs.has(pair) &&
      !/^(how|what|when|which|much|many|was|did|the|our|for|build|ready)\b/.test(pair)
    ) {
      entities.push(
        pair
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      );
    }
  }

  // Dedupe and clean: drop trailing role words that aren't part of a person name
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entities) {
    const cleaned = e
      .replace(/\b(Build Ready|Custom|Project|Agreement|Margin|Report)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const key = normalizeEntityText(cleaned || e);
    if (!key || key.length < 3) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned || e);
  }
  return out;
}
