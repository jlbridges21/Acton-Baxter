/**
 * Defensive normalization for extracted entity names used in GHL / PEM / Slack search.
 * Strips generic descriptor words that often trail or lead a proper name in natural phrasing
 * ("the Katie Liniger project", "customer Robert Vertin", "Denis Kornilov's opportunity").
 * Also strips leading interrogative residue ("what the", "where's the") so those never become
 * a search key. Candidates that are only stopwords/interrogatives are rejected (null).
 */

/** Generic CRM/category words — never part of a person/contact search key. */
export const ENTITY_DESCRIPTOR_NOISE_WORDS = [
  "project",
  "opportunity",
  "deal",
  "customer",
  "contact",
  "account",
  "record",
  "file",
  "pipeline",
  "stage",
  "slack",
] as const;

const NOISE = new Set(ENTITY_DESCRIPTOR_NOISE_WORDS.map((w) => w.toLowerCase()));

const LEAD_ARTICLES = new Set(["the", "a", "an"]);

/** Question words that regexes sometimes glue onto a possessive name ("what's Sharon Liu"). */
const LEAD_QUESTION_WORDS = new Set([
  "what",
  "who",
  "when",
  "where",
  "how",
  "which",
  "whats",
  "whos",
  "wheres",
  "whens",
  "hows",
]);

/**
 * Tokens that can never form an entity name on their own (interrogatives, articles,
 * copulas, demonstratives, prepositions, generic project words).
 */
const ENTITY_STOPWORDS = new Set([
  ...LEAD_ARTICLES,
  ...LEAD_QUESTION_WORDS,
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "can",
  "could",
  "would",
  "should",
  "will",
  "shall",
  "may",
  "might",
  "of",
  "for",
  "to",
  "from",
  "in",
  "on",
  "at",
  "by",
  "with",
  "about",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "his",
  "her",
  "their",
  "my",
  "your",
  "our",
  "me",
  "you",
  "we",
  "they",
  "he",
  "she",
  "and",
  "or",
  "but",
  "if",
  "then",
  "so",
  "project",
  "projects",
  "address",
  "location",
  "city",
  "info",
  "information",
  "details",
  "please",
  "tell",
  "give",
  "show",
  "find",
  "get",
  "know",
]);

/** Instructional / filler phrases that regexes sometimes glue onto a name. */
const LEAD_PHRASE_PATTERNS = [
  /^(give|get|show|tell|find|look\s*up)\s+(me\s+)?(more\s+)?(information|info|details|data)\s+(about|on|for|regarding)\s+/i,
  /^(more\s+)?(information|info|details|data)\s+(about|on|for|regarding)\s+/i,
  /^(tell|show|give)\s+(me\s+)?(about|on)\s+/i,
  /^(about|regarding|concerning|for|with)\s+/i,
  /^(look\s*up|find|search\s+for)\s+/i,
  // Leading interrogative phrasing: "what the", "what's the", "where is the", "where's"
  /^(what|where|who|when|which|how)(?:'s|’s|s)?\s+(is\s+|are\s+|was\s+|were\s+)?(the\s+|a\s+|an\s+)?/i,
  /^(what|where|who|when|which|how)\s+the\b\s*/i,
];

function stripLeadPhrases(value: string): string {
  let out = value.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of LEAD_PHRASE_PATTERNS) {
      const next = out.replace(re, "").trim();
      if (next !== out) {
        out = next;
        changed = true;
      }
    }
  }
  return out;
}

function stripPossessive(value: string): string {
  return value
    .replace(/['\u2019]s\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripEdgeNoiseWords(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  while (words.length && LEAD_ARTICLES.has(words[0]!.toLowerCase())) {
    words.shift();
  }
  while (
    words.length &&
    LEAD_QUESTION_WORDS.has(words[0]!.toLowerCase().replace(/['\u2019]s$/i, ""))
  ) {
    words.shift();
  }
  while (words.length && NOISE.has(words[0]!.toLowerCase())) {
    words.shift();
  }
  while (words.length && NOISE.has(words[words.length - 1]!.toLowerCase())) {
    words.pop();
  }
  while (words.length && LEAD_ARTICLES.has(words[0]!.toLowerCase())) {
    words.shift();
  }
  return words.join(" ").trim();
}

/**
 * True when every remaining token is a stopword/interrogative — not a searchable entity.
 */
export function isEntitySearchNameRejected(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const tokens = raw
    .replace(/[?.,!:;]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase().replace(/['\u2019]s$/i, ""));
  if (tokens.length === 0) return true;
  return tokens.every((t) => ENTITY_STOPWORDS.has(t) || NOISE.has(t));
}

/**
 * Normalize an extracted entity name for CRM / PEM / Slack identity search.
 * Returns null when nothing usable remains (including stopword-only residue like "what the").
 */
export function normalizeEntitySearchName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.replace(/\s+/g, " ").trim();
  if (!name) return null;

  name = stripPossessive(name);
  name = stripLeadPhrases(name);
  name = stripEdgeNoiseWords(name);
  // Second pass: lead phrases can reappear after noise strip ("the project Katie" rare).
  name = stripLeadPhrases(name);
  name = stripEdgeNoiseWords(name);
  name = name.replace(/[?.,!:;]+$/g, "").trim();

  if (!name || name.length < 2) return null;
  if (isEntitySearchNameRejected(name)) return null;
  return name;
}
