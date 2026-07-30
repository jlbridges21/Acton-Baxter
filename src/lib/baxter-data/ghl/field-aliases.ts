/**
 * Strict GHL field alias registry.
 * Longest / most specific phrases win before generic tokens like "address".
 */

export type GhlRequestedField =
  | "email"
  | "phone"
  | "address"
  | "city"
  | "owner"
  | "tags"
  | "source"
  | "stage"
  | "pipeline"
  | "value"
  | "other";

/** Ordered longest-first phrase → field. */
const FIELD_PHRASES: Array<{ re: RegExp; field: GhlRequestedField }> = [
  // Email before generic "address"
  { re: /\be-?mail\s+address(?:es)?\b/i, field: "email" },
  { re: /\bcontact\s+e-?mail\b/i, field: "email" },
  { re: /\be-?mails?\b/i, field: "email" },

  { re: /\bphone\s+numbers?\b/i, field: "phone" },
  { re: /\b(mobile|cell|telephone)\s+numbers?\b/i, field: "phone" },
  { re: /\b(phone|mobile|cell|telephone)\b/i, field: "phone" },

  { re: /\bstreet\s+address(?:es)?\b/i, field: "address" },
  { re: /\b(home|mailing|full)\s+address(?:es)?\b/i, field: "address" },
  { re: /\bproperty\s+address(?:es)?\b/i, field: "address" },
  // bare "address" only when not part of "email address" (already handled)
  { re: /\baddress(?:es)?\b/i, field: "address" },

  { re: /\bcity\b/i, field: "city" },
  { re: /\b(zip(?:\s*code)?|postal(?:\s*code)?)\b/i, field: "address" },

  { re: /\bpipeline\s+stages?\b/i, field: "stage" },
  { re: /\b(opportunity\s+)?stages?\b/i, field: "stage" },
  { re: /\bpipelines?\b/i, field: "pipeline" },
  { re: /\b(monetary\s+)?value\b/i, field: "value" },
  { re: /\b(owner|assigned|who owns)\b/i, field: "owner" },
  { re: /\b(tags?|tagged)\b/i, field: "tags" },
  { re: /\b(lead\s+)?source\b/i, field: "source" },
];

const STOPWORD_NAMES = new Set([
  "his",
  "her",
  "their",
  "them",
  "he",
  "she",
  "they",
  "this",
  "that",
  "it",
  "the",
  "a",
  "an",
  "our",
  "my",
  "your",
  "someone",
  "anybody",
  "anyone",
]);

/**
 * Detect all requested CRM fields (multi-field aware).
 * "email address" → email only (never street address).
 */
export function detectRequestedGhlFields(question: string): GhlRequestedField[] {
  const q = question.toLowerCase();
  const found = new Set<GhlRequestedField>();

  // Protect "email address" from street-address matching by masking it first.
  const masked = q.replace(/\be-?mail\s+address(?:es)?\b/g, " email ");

  for (const { re, field } of FIELD_PHRASES) {
    const hay = field === "address" ? masked : q;
    if (re.test(hay)) found.add(field);
  }

  // Stage/pipeline from opportunity wording even without the word "stage"
  if (/\b(opportunit|deal)\b/i.test(q) && /\b(what|which|where)\b/i.test(q)) {
    if (/\bstage\b/i.test(q) || /\bwhere\b/i.test(q)) found.add("stage");
    if (/\bpipeline\b/i.test(q)) found.add("pipeline");
  }

  if (!found.size) return ["other"];
  // Prefer concrete CRM fields over "other"
  found.delete("other");
  return found.size ? [...found] : ["other"];
}

/** Single primary field for legacy callers (first by priority). */
export function primaryRequestedField(fields: GhlRequestedField[]): GhlRequestedField {
  const order: GhlRequestedField[] = [
    "email",
    "phone",
    "address",
    "city",
    "stage",
    "pipeline",
    "owner",
    "tags",
    "source",
    "value",
    "other",
  ];
  for (const f of order) {
    if (fields.includes(f)) return f;
  }
  return "other";
}

export function isPronounOrStopwordName(name: string | null | undefined): boolean {
  if (!name) return true;
  const tokens = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  if (tokens.length === 1 && STOPWORD_NAMES.has(tokens[0]!)) return true;
  return tokens.every((t) => STOPWORD_NAMES.has(t));
}

export function looksLikePronounFollowUp(question: string): boolean {
  return /\b(his|her|their|he|she|they|him|them)\b/i.test(question.trim());
}

/** Contact-level fields (not opportunity). */
export function isContactField(field: GhlRequestedField): boolean {
  return (
    field === "email" ||
    field === "phone" ||
    field === "address" ||
    field === "city" ||
    field === "owner" ||
    field === "tags" ||
    field === "source"
  );
}

export function isOpportunityField(field: GhlRequestedField): boolean {
  return field === "stage" || field === "pipeline" || field === "value";
}
