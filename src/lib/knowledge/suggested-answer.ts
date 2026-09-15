/**
 * Knowledge Base authors optionally include a "Suggested Answer for Baxter"
 * section with the exact wording Baxter should prefer when it addresses the question.
 *
 * Preference, not override: if the suggested section does not cover the ask,
 * answer from the rest of the entry.
 */

const HEADING_PATTERNS: RegExp[] = [
  /^#{1,3}\s*suggested\s+answer\s+for\s+baxter\s*$/i,
  /^#{1,3}\s*suggested\s+baxter\s+answer\s*$/i,
  /^#{1,3}\s*suggested\s+answer\s*$/i,
  /^\*{0,2}suggested\s+answer\s+for\s+baxter\*{0,2}\s*:?\s*$/i,
  /^\*{0,2}suggested\s+baxter\s+answer\*{0,2}\s*:?\s*$/i,
  /^suggested\s+answer\s+for\s+baxter\s*:?\s*$/i,
];

/** Heading strings we match (for tests / diagnostics). */
export const SUGGESTED_ANSWER_HEADING_VARIANTS = [
  "## Suggested Answer for Baxter",
  "### Suggested Answer for Baxter",
  "# Suggested Answer for Baxter",
  "## Suggested Baxter Answer",
  "## Suggested Answer",
  "**Suggested Answer for Baxter**",
  "Suggested Answer for Baxter:",
] as const;

export type SuggestedAnswerSection = {
  heading: string;
  body: string;
  /** Full section including heading, for prompt injection. */
  fullText: string;
};

function isSuggestedHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return HEADING_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Extract the first Suggested Answer section from markdown/plain content.
 */
export function extractSuggestedAnswerSection(content: string): SuggestedAnswerSection | null {
  if (!content?.trim()) return null;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  let heading = "";
  for (let i = 0; i < lines.length; i += 1) {
    if (isSuggestedHeading(lines[i]!)) {
      start = i;
      heading = lines[i]!.trim();
      break;
    }
  }
  if (start < 0) return null;

  const bodyLines: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    // Stop at next markdown heading of same-or-higher weight, or another suggested block.
    if (/^#{1,3}\s+\S/.test(line.trim()) || isSuggestedHeading(line)) break;
    bodyLines.push(line);
  }
  const body = bodyLines.join("\n").trim();
  if (!body) return null;
  return {
    heading,
    body,
    fullText: `${heading}\n\n${body}`,
  };
}

/** Lightweight relevance: shared content tokens between question and suggested body. */
export function suggestedAnswerAddressesQuestion(suggestedBody: string, question: string): boolean {
  const qTokens = tokenize(question);
  const bodyTokens = new Set(tokenize(suggestedBody));
  if (qTokens.length === 0 || bodyTokens.size === 0) return false;
  // Process/howto asks: if the suggested body has actionable verbs/emails, treat as relevant
  // when the question shares process topic words OR is a short process ask against a process doc.
  const overlap = qTokens.filter((t) => bodyTokens.has(t));
  if (overlap.length >= 2) return true;
  if (overlap.length >= 1 && qTokens.length <= 6) return true;
  // Short process questions ("how to submit reimbursements") vs long suggested answers
  const processAsk = /\b(how|process|submit|reimburse|reimbursement|procedure|steps?)\b/i.test(
    question,
  );
  const processBody = /\b(email|submit|include|proof|invoice|payment|reimburse)\b/i.test(
    suggestedBody,
  );
  if (processAsk && processBody && overlap.length >= 1) return true;
  if (
    processAsk &&
    processBody &&
    /\breimburs/i.test(question) &&
    /\breimburs/i.test(suggestedBody)
  ) {
    return true;
  }
  return false;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9@.\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .filter(
      (t) =>
        ![
          "the",
          "and",
          "for",
          "with",
          "what",
          "how",
          "when",
          "where",
          "who",
          "this",
          "that",
          "from",
          "into",
          "about",
          "please",
          "baxter",
          "suggested",
          "answer",
        ].includes(t),
    );
}

/**
 * Prefer Suggested Answer text when building an excerpt for a matching question.
 * Falls back to null so callers keep their normal excerpt logic.
 */
export function preferSuggestedAnswerExcerpt(
  content: string,
  question: string,
  maxLen: number,
): string | null {
  const section = extractSuggestedAnswerSection(content);
  if (!section) return null;
  if (!suggestedAnswerAddressesQuestion(section.body, question)) return null;
  const text = section.body.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Format expanded evidence with Suggested Answer highlighted for the model.
 */
export function formatExpandedEntryWithSuggestedAnswer(input: {
  content: string;
  question: string;
  maxChars: number;
}): { excerpt: string; usedSuggestedAnswer: boolean } {
  const section = extractSuggestedAnswerSection(input.content);
  const addresses =
    section != null && suggestedAnswerAddressesQuestion(section.body, input.question);

  if (section && addresses) {
    const rest = input.content
      .replace(section.fullText, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const preferred = [
      "AUTHOR-SUGGESTED ANSWER FOR BAXTER (prefer this wording when it addresses the question; cite normally):",
      section.body.trim(),
      rest
        ? `\nAdditional context from the same entry (use only if the suggested answer does not cover the question):\n${rest}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const clipped =
      preferred.length <= input.maxChars
        ? preferred
        : `${preferred.slice(0, input.maxChars - 1).trimEnd()}…`;
    return { excerpt: clipped, usedSuggestedAnswer: true };
  }

  const raw = input.content.trim();
  const clipped =
    raw.length <= input.maxChars ? raw : `${raw.slice(0, input.maxChars - 1).trimEnd()}…`;
  return { excerpt: clipped, usedSuggestedAnswer: false };
}
