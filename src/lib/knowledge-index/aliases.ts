import { normalizeHeaderKey } from "./values";

/**
 * Generic column aliases: employee phrasing → normalized header keys.
 * Matching is against normalizeHeaderKey(header).
 */
export const COLUMN_ALIASES: Record<string, string[]> = {
  "customer name": ["customer", "client", "customer name", "client name", "name"],
  project: ["project", "project name", "opportunity", "opportunity name", "job"],
  "close date": ["close date", "closed", "sold date", "close", "closing date"],
  "project sq ft": [
    "project sq ft",
    "sq ft",
    "square footage",
    "square feet",
    "size",
    "sf",
    "footage",
  ],
  "agreement amount": [
    "agreement amount",
    "agreement",
    "contract amount",
    "project agreement",
    "agreement value",
    "contract value",
    "lead value",
    "sale amount",
    "sold amount",
  ],
  "internal cost est": [
    "internal cost est",
    "internal cost",
    "estimated cost",
    "est cost",
    "sold cost",
    "cost",
  ],
  "estimated gross margin": [
    "estimated gross margin",
    "gross margin",
    "margin",
    "gm",
    "estimated margin",
  ],
  "gross margin": [
    "gross margin",
    "margin percent",
    "margin percentage",
    "gm percent",
    "gm %",
    "margin %",
  ],
  "project type br custom": [
    "project type br custom",
    "project type",
    "type",
    "build ready",
    "custom",
    "br custom",
  ],
  "total contracts": ["total contracts", "number of projects", "project count", "how many"],
  "total agreement value": [
    "total agreement value",
    "total agreement",
    "total sales",
    "total contract value",
  ],
  "total internal cost": ["total internal cost", "total cost"],
  "total gross margin": ["total gross margin", "total margin"],
  "avg margin": ["avg margin", "average margin", "average margin percent"],
};

export function resolveFieldToHeader(requestedField: string, headers: string[]): string | null {
  const want = normalizeHeaderKey(requestedField);
  if (!want) return null;

  // Direct header match
  for (const header of headers) {
    if (normalizeHeaderKey(header) === want) return header;
    if (normalizeHeaderKey(header).includes(want) || want.includes(normalizeHeaderKey(header))) {
      return header;
    }
  }

  // Alias map: find which canonical key the request matches, then find header
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    const aliasHit =
      aliases.some((a) => a === want || want.includes(a) || a.includes(want)) ||
      canonical === want ||
      want.includes(canonical);
    if (!aliasHit) continue;
    for (const header of headers) {
      const nk = normalizeHeaderKey(header);
      if (
        nk === canonical ||
        nk.includes(canonical) ||
        canonical.includes(nk) ||
        aliases.some((a) => nk === a || nk.includes(a))
      ) {
        return header;
      }
    }
  }

  return null;
}

export function inferRequestedFieldsFromQuestion(question: string): string[] {
  const q = question.toLowerCase();
  const fields: string[] = [];

  const checks: Array<[RegExp, string]> = [
    [
      /\bagreement\b|\bcontract (amount|value)\b|\blead value\b|\bhow much\b.*\b(project|agreement|sold)\b|\bwas the .+ (for|agreement)\b/,
      "Agreement Amount",
    ],
    [
      /\binternal cost\b|\bestimated cost\b|\bcost (us|internally)\b|\bactually cost\b/,
      "Internal Cost (Est.)",
    ],
    [/\baverage margin\b|\bavg margin\b|\bour average margin\b/, "Avg Margin %"],
    [/\bmargin %\b|\bmargin percent\b|\bgross margin %\b|\bgm %\b/, "Gross Margin %"],
    [
      /\bmargin \$\b|\bgross margin \$\b|\bestimated (gross )?margin\b(?! %)/,
      "Estimated Gross Margin $",
    ],
    [/\bmargin\b/, "Gross Margin %"],
    [/\b(sq\.?\s*ft|square (foot|feet|footage)|how big|size)\b/, "Project Sq Ft"],
    [/\b(close|closed|closing)( date)?\b|\bwhen did\b.+\bclose\b|\bsold date\b/, "Close Date"],
    [/\b(build ready|custom|project type|br\/custom|br or custom)\b/, "Project Type (BR/Custom)"],
    [/\btotal agreement\b|\btotal (contract|sales) value\b/, "Total Agreement Value"],
    [
      /\bhow many (projects|contracts)\b|\btotal contracts\b|\bnumber of projects\b/,
      "Total Contracts",
    ],
    [/\btotal (internal )?cost\b/, "Total Internal Cost"],
    [/\btotal (gross )?margin\b(?! %)/, "Total Gross Margin"],
  ];

  for (const [re, field] of checks) {
    if (re.test(q) && !fields.includes(field)) fields.push(field);
  }

  // "how much was X for" without other cues → agreement
  if (fields.length === 0 && /\bhow much\b/.test(q)) {
    fields.push("Agreement Amount");
  }

  return fields;
}
