/**
 * Bounded Acton acronym / synonym expansion for Slack query planning.
 * Deterministic — not LLM-invented.
 */

const EXPANSIONS: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /\bpem\b/i, terms: ["PEM", "Partnership Evaluation Meeting"] },
  { pattern: /\bfp\b|\bfeasibility package\b/i, terms: ["Feasibility Package", "FP"] },
  { pattern: /\bbt\b|\bbuildertrend\b/i, terms: ["BuilderTrend", "BT"] },
  { pattern: /\bghl\b|\bgohighlevel\b|\bgo high level\b/i, terms: ["GoHighLevel", "GHL"] },
  { pattern: /\braci\b/i, terms: ["RACI", "responsibility matrix"] },
  { pattern: /\bbr\b|\bbuild ready\b/i, terms: ["Build Ready", "BR"] },
  { pattern: /\bpm\b|\bproject[- ]management\b/i, terms: ["project-management", "PM"] },
];

/**
 * Return extra keywords to OR into follow-up Slack searches.
 * Does not replace the original question — only expands sparse queries.
 */
export function expandSlackSearchTerms(question: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of EXPANSIONS) {
    if (!entry.pattern.test(question)) continue;
    for (const term of entry.terms) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(term);
    }
  }
  return out;
}

export function buildExpandedKeywordVariants(keywords: string[], question: string): string[][] {
  const expansions = expandSlackSearchTerms(question);
  const variants: string[][] = [];
  if (keywords.length) variants.push(keywords);
  if (expansions.length) {
    const merged = [...new Set([...keywords, ...expansions.map((e) => e.toLowerCase())])];
    if (merged.join(" ") !== keywords.join(" ")) variants.push(merged);
  }
  // RACI-specific alternate
  if (/\braci\b/i.test(question)) {
    variants.push(["responsibility", "matrix"]);
    variants.push(["RACI", "review"]);
  }
  return variants.slice(0, 3);
}
