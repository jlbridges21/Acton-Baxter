/**
 * Defensive normalization for extracted entity names used in GHL / PEM / Slack search.
 * Strips generic descriptor words that often trail or lead a proper name in natural phrasing
 * ("the Katie Liniger project", "customer Robert Vertin", "Denis Kornilov's opportunity").
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
] as const;

const NOISE = new Set(ENTITY_DESCRIPTOR_NOISE_WORDS.map((w) => w.toLowerCase()));

const LEAD_ARTICLES = new Set(["the", "a", "an"]);

/** Instructional / filler phrases that regexes sometimes glue onto a name. */
const LEAD_PHRASE_PATTERNS = [
  /^(give|get|show|tell|find|look\s*up)\s+(me\s+)?(more\s+)?(information|info|details|data)\s+(about|on|for|regarding)\s+/i,
  /^(more\s+)?(information|info|details|data)\s+(about|on|for|regarding)\s+/i,
  /^(tell|show|give)\s+(me\s+)?(about|on)\s+/i,
  /^(about|regarding|concerning|for|with)\s+/i,
  /^(look\s*up|find|search\s+for)\s+/i,
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
 * Normalize an extracted entity name for CRM / PEM / Slack identity search.
 * Returns null when nothing usable remains.
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
  return name;
}
