import { inferRequestedFieldsFromQuestion } from "./aliases";
import type { KnowledgeQueryPlan } from "./types";
import { normalizeEntityText } from "./values";
import { parseTimeRangeFromQuestion } from "./temporal";

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
  "sold",
  "sell",
  "have",
  "this",
  "last",
]);

/**
 * Deterministic knowledge query planner — never turns user text into SQL.
 */
export function planKnowledgeQuery(question: string, now: Date = new Date()): KnowledgeQueryPlan {
  const raw = question.trim();
  const q = raw.toLowerCase();
  const requestedFields = inferRequestedFieldsFromQuestion(raw);
  if (/\bhow many (projects|contracts)\b|\bnumber of projects\b/i.test(raw)) {
    if (!requestedFields.includes("Total Contracts")) requestedFields.unshift("Total Contracts");
  }

  // Sales language → Agreement Amount sum (not "recognized revenue")
  const soldIntent =
    /\b(how much (have|did|do) we (sold|sell)|we sold|sold this|sold (in|during|last)|sales (this|last|in)|total (sales|sold)|agreement value sold|revenue sold|contract value)\b/i.test(
      q,
    );
  if (soldIntent && !requestedFields.includes("Agreement Amount")) {
    requestedFields.unshift("Agreement Amount");
  }

  const timeRange = parseTimeRangeFromQuestion(raw, now);
  const entities = extractEntities(raw);
  const keywords = tokenize(raw);

  const wantsAggregate =
    soldIntent ||
    Boolean(timeRange) ||
    /\b(how many|average|avg|total|sum|largest|highest|lowest|smallest|min|max|how much (have|did|do) we)\b/i.test(
      q,
    ) ||
    requestedFields.some((f) => /total |avg |average /i.test(f));

  const wantsStructured =
    entities.length > 0 ||
    requestedFields.length > 0 ||
    soldIntent ||
    Boolean(timeRange) ||
    /\b(agreement|margin|sq\.?\s*ft|close date|custom|build ready|lori|harris)\b/i.test(q) ||
    wantsAggregate;

  let aggregation: KnowledgeQueryPlan["aggregation"] = null;
  if (/\bhow many\b|\bcount\b|\btotal contracts\b|\bnumber of\b/i.test(q)) aggregation = "count";
  else if (/\baverage\b|\bavg\b/i.test(q) && !/\bmargin\b/i.test(q)) aggregation = "average";
  else if (/\blargest\b|\bhighest\b|\bmax\b/i.test(q)) aggregation = "max";
  else if (/\bsmallest\b|\blowest\b|\bmin\b/i.test(q)) aggregation = "min";
  else if (soldIntent || (/\b(total|sum|how much)\b/i.test(q) && !/\btotal contracts\b/i.test(q))) {
    aggregation = "sum";
  }

  const weightedMargin =
    /\b(gross margin (percentage|percent|%)|margin %|our (gross )?margin)\b/i.test(q) &&
    (Boolean(timeRange) || wantsAggregate) &&
    !/\baverage project margin\b/i.test(q);

  if (weightedMargin) {
    if (!requestedFields.includes("Estimated Gross Margin $")) {
      requestedFields.unshift("Estimated Gross Margin $");
    }
    if (!requestedFields.includes("Agreement Amount")) {
      requestedFields.push("Agreement Amount");
    }
    aggregation = "sum";
  }

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

  const wantsMultimodal =
    /\b(diagram|image|screenshot|photo|chart|slide|presentation|floor plan|site plan|png|jpg|jpeg)\b/i.test(
      q,
    );
  const wantsProcedure =
    /\b(what happens|procedure|process|after|before|during|steps?|how (do|does|to)|workflow)\b/i.test(
      q,
    );
  const wantsAcronym = /\b(stand for|acronym|mean|definition of|what is [A-Z]{2,6}\b)/i.test(raw);

  let mode: KnowledgeQueryPlan["mode"] = "document";
  let intent: KnowledgeQueryPlan["intent"] = "document_lookup";

  const personLike = entities.filter(
    (e) => !/trailing|report|agreement|margin|total|average|project/i.test(e),
  );

  // Company-wide sold / temporal aggregates: never keep spurious entities
  if (soldIntent || timeRange) {
    const realPeople = personLike.filter(
      (e) =>
        !/\b(we|sell|sold|this|last|year|have|did|do|much|many|in)\b/i.test(e) &&
        /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(e) &&
        !/^(How|What|When|Our|The)\b/i.test(e),
    );
    if (realPeople.length === 0) {
      mode = "structured_aggregate";
      intent = "structured_aggregation";
      if (!aggregation) aggregation = soldIntent ? "sum" : aggregation;
      return {
        mode,
        intent,
        entities: [],
        requestedFields,
        filters,
        timeRange,
        aggregation: aggregation ?? "sum",
        weightedMargin,
        keywords,
        rawQuestion: raw,
      };
    }
  }

  if (wantsStructured && aggregation && personLike.length === 0) {
    mode = "structured_aggregate";
    intent = "structured_aggregation";
  } else if (wantsStructured && personLike.length > 0) {
    mode = "structured_lookup";
    intent = "structured_lookup";
  } else if (wantsStructured) {
    mode = "hybrid";
    intent = "hybrid";
  } else if (wantsMultimodal) {
    mode = "multimodal";
    intent = "multimodal_lookup";
  } else if (wantsProcedure) {
    mode = "hybrid";
    intent = "acton_procedure";
  } else if (wantsAcronym) {
    mode = "lexical";
    intent = "acton_factual";
  }

  if (personLike.length === 0 && requestedFields.some((f) => /total |avg /i.test(f))) {
    mode = "structured_aggregate";
    intent = "structured_aggregation";
  }

  if (
    personLike.length === 0 &&
    requestedFields.some((f) => /total |avg |average /i.test(f) || f === "Total Contracts")
  ) {
    mode = "structured_aggregate";
    intent = "structured_aggregation";
    return {
      mode,
      intent,
      entities: [],
      requestedFields,
      filters,
      timeRange,
      aggregation: aggregation ?? (requestedFields.includes("Total Contracts") ? "count" : null),
      weightedMargin,
      keywords,
      rawQuestion: raw,
    };
  }

  if (mode === "document" && intent === "document_lookup" && keywords.length > 0) {
    intent = "acton_factual";
    mode = "hybrid";
  }

  return {
    mode,
    intent,
    entities: personLike.length ? personLike : entities,
    requestedFields,
    filters,
    timeRange,
    aggregation,
    weightedMargin,
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

  const quoted = question.match(/"([^"]+)"|'([^']+)'/g);
  if (quoted) {
    for (const q of quoted) entities.push(q.replace(/['"]/g, "").trim());
  }

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
      "this year",
      "last year",
      "have we",
      "did we",
      "we sold",
      "we sell",
      "sell in",
      "sold in",
      "all year",
      "much did",
      "much have",
    ]);
    const pair = `${nameLike[1]} ${nameLike[2]}`;
    if (
      !skipPairs.has(pair) &&
      !/^(how|what|when|which|much|many|was|did|the|our|for|build|ready|this|last|have|sold)\b/.test(
        pair,
      )
    ) {
      entities.push(
        pair
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      );
    }
  }

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
