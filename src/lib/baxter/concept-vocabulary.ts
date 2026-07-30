/**
 * Reserved product / process vocabulary — never treat these as prospect/person names.
 * Used by PEM entity parsing, concept routing, and Knowledge ranking boosts.
 */

export type ConceptCategory =
  | "pem_neat"
  | "property_research"
  | "knowledge"
  | "slack"
  | "crm"
  | "process"
  | "assistant"
  | "google";

export type ConceptDefinition = {
  key: string;
  name: string;
  aliases: string[];
  category: ConceptCategory;
  /** Preferred Knowledge search phrases (exact title preferred when present). */
  knowledgeSearchTerms: string[];
  route?: string | null;
  createRoute?: string | null;
};

/** Single-token stop words that must never start/become a person name. */
export const RESERVED_CONCEPT_TOKENS = [
  "pem",
  "pems",
  "neat",
  "neats",
  "palo",
  "adu",
  "raci",
  "ghl",
  "crm",
  "kpi",
  "kpis",
  "baxter",
  "acton",
  "buildertrend",
  "gohighlevel",
  "slack",
  "knowledge",
  "rulebook",
  "monitoring",
  "transcript",
  "transcripts",
  "partnership",
  "evaluation",
  "meeting",
  "meetings",
  "pipeline",
  "opportunity",
  "opportunities",
  "property",
  "research",
  "process",
  "type",
  "pain",
  "pains",
  "budget",
  "decision",
  "schedule",
  "outcome",
  "assessment",
  "coaching",
  "handoff",
  "notes",
  "email",
  "sales",
  "marketing",
  "team",
  "area",
  "bay",
  "la",
  "february",
  "january",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "month",
  "months",
  "year",
  "years",
  "quarter",
  "many",
  "several",
  "few",
  "some",
  "most",
  "all",
  "our",
  "their",
  "his",
  "her",
  "its",
  "me",
  "us",
  "we",
  "you",
] as const;

/** Multi-word concept phrases (normalized lowercase). Longer first for stripping. */
export const RESERVED_CONCEPT_PHRASES = [
  "partnership evaluation meeting neat",
  "partnership evaluation meeting",
  "partnership evaluation meetings",
  "buildertrend custom fields",
  "buildertrend fields",
  "process monitoring",
  "process rulebook",
  "property research",
  "knowledge center",
  "knowledge base",
  "google workspace",
  "slack recall",
  "slack search",
  "type 1 pain",
  "type 2 pain",
  "type one pain",
  "type two pain",
  "pem neat",
  "pem neats",
  "pem meetings",
  "pem meeting",
  "bay area",
  "los angeles",
  "acton crm",
  "go high level",
  "gohighlevel",
  "sales team",
  "sales pipeline",
] as const;

export const BAXTER_CONCEPT_CATALOG: ConceptDefinition[] = [
  {
    key: "pem_neat",
    name: "PEM NEAT",
    aliases: [
      "pem neat",
      "neat",
      "pem",
      "partnership evaluation meeting",
      "partnership evaluation",
    ],
    category: "pem_neat",
    knowledgeSearchTerms: ["PEM NEAT", "Partnership Evaluation Meeting", "PEM"],
    route: "/pem-neats",
    createRoute: "/pem-neats/new",
  },
  {
    key: "property_research",
    name: "Property Research",
    aliases: ["property research", "property research tool", "parcel research"],
    category: "property_research",
    knowledgeSearchTerms: ["Property Research"],
    route: "/dashboard",
    createRoute: "/reports/new",
  },
  {
    key: "knowledge_center",
    name: "Knowledge Center",
    aliases: ["knowledge center", "knowledge base", "approved knowledge"],
    category: "knowledge",
    knowledgeSearchTerms: ["Knowledge Center", "Knowledge Base"],
    route: null,
  },
  {
    key: "slack_recall",
    name: "Slack Recall",
    aliases: ["slack recall", "slack search", "/recall"],
    category: "slack",
    knowledgeSearchTerms: ["Slack Recall", "Slack Search"],
    route: "/settings/integrations",
  },
  {
    key: "ghl",
    name: "GoHighLevel",
    aliases: ["ghl", "gohighlevel", "go high level", "acton crm", "crm"],
    category: "crm",
    knowledgeSearchTerms: ["GoHighLevel", "GHL", "Acton CRM"],
    route: null,
  },
  {
    key: "process_rulebook",
    name: "Process Rulebook",
    aliases: ["process rulebook", "rulebook", "raci"],
    category: "process",
    knowledgeSearchTerms: ["Process Rulebook", "RACI"],
    route: "/admin/baxter/rulebook",
  },
  {
    key: "process_monitoring",
    name: "Process Monitoring",
    aliases: ["process monitoring", "monitoring"],
    category: "process",
    knowledgeSearchTerms: ["Process Monitoring"],
    route: "/admin/baxter/monitoring",
  },
  {
    key: "google_workspace",
    name: "Google Workspace",
    aliases: ["google workspace", "google drive", "google docs"],
    category: "google",
    knowledgeSearchTerms: ["Google Workspace"],
    route: null,
  },
  {
    key: "baxter",
    name: "Baxter",
    aliases: ["baxter", "acton baxter"],
    category: "assistant",
    knowledgeSearchTerms: ["Baxter"],
    route: "/",
  },
  {
    key: "palo",
    name: "PALO",
    aliases: ["palo", "up-front contract", "up front contract"],
    category: "pem_neat",
    knowledgeSearchTerms: ["PALO", "PEM"],
    route: "/pem-neats",
  },
  {
    key: "type_1_pain",
    name: "Type 1 Pain",
    aliases: ["type 1 pain", "type one pain", "type 1"],
    category: "pem_neat",
    knowledgeSearchTerms: ["Type 1 Pain", "PEM NEAT", "PEM"],
    route: "/pem-neats",
  },
  {
    key: "type_2_pain",
    name: "Type 2 Pain",
    aliases: ["type 2 pain", "type two pain", "type 2"],
    category: "pem_neat",
    knowledgeSearchTerms: ["Type 2 Pain", "PEM NEAT", "PEM"],
    route: "/pem-neats",
  },
];

export type ConceptQuestionKind = "definition" | "how_to" | "capability_overview" | "none";

export type ConceptQuestionDetection = {
  kind: ConceptQuestionKind;
  conceptKey: string | null;
  conceptName: string | null;
  knowledgeSearchTerms: string[];
  /** True when the question is clearly about a tool/process, not a person/record. */
  isConcept: boolean;
};

const DEFINITION_SHAPE =
  /\b(what (is|are)|what does .{0,40} mean|define|explain|what (is|are) .{0,40} (for|used for)|how does .{0,40} work|what can .{0,40} do)\b/i;

const HOW_TO_SHAPE =
  /\b(how (do i|to|can i)|where (do i|can i)|how do you)\b.+\b(generate|create|make|start|use|open|run|add|paste)\b/i;

const CAPABILITY_OVERVIEW =
  /\b(what can you (do|help with|help)|what (all )?can (baxter|you) help( me)? with|what are your (capabilities|limits|limitations)|what (all )?(systems|tools|sources) (do you|can you|you have)|tell me (everything|all) .{0,30}(can|capabilities)|give me (a )?(list|overview) of (your )?capabilities|how do you (work|help))\b/i;

const RETRY_SHAPE =
  /\b(try again|bad answer|wrong answer|that('s| is) (wrong|incorrect|not (right|what i)|bad)|do better|re(-| )?answer|explain (it |that )?(again|properly|better)|for those who don'?t know)\b/i;

function normalizeConceptText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\w\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isReservedConceptToken(token: string): boolean {
  const t = normalizeConceptText(token);
  if (!t) return false;
  return (RESERVED_CONCEPT_TOKENS as readonly string[]).includes(t);
}

/** True when a candidate "person name" is actually only reserved concept vocabulary. */
export function isReservedConceptName(name: string): boolean {
  const n = normalizeConceptText(name);
  if (!n) return true;
  if ((RESERVED_CONCEPT_PHRASES as readonly string[]).some((p) => p === n)) return true;
  const parts = n.split(/\s+/).filter(Boolean);
  if (!parts.length) return true;
  return parts.every((p) => isReservedConceptToken(p) || /^(type|one|two|[12])$/.test(p));
}

/** Remove reserved multi-word phrases so leftover text can be scanned for real names. */
export function stripReservedConceptPhrases(text: string): string {
  let out = ` ${normalizeConceptText(text)} `;
  const phrases = [...RESERVED_CONCEPT_PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    out = out.replace(new RegExp(`\\s${escapeRegExp(phrase)}\\s`, "gi"), " ");
  }
  // Also strip standalone reserved tokens that commonly appear as false names
  out = out.replace(/\b(pem|pems|neat|neats|palo|kpi|kpis)\b/gi, " ");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Operational / metric questions about PEMs as meetings — not prospect NEAT records.
 * e.g. "How many PEM meetings were conducted in February…"
 */
export function isOperationalPemMetricQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (hasLikelyPersonRecordSignal(q)) return false;
  const metricShape =
    /\b(how many|how much|number of|count of|total|average|avg|kpi|kpis|conversion rate|win rate|volume)\b/i.test(
      q,
    ) ||
    /\b(conducted|ran|run|held|completed|scheduled)\b.+\b(pem|meeting|meetings)\b/i.test(q) ||
    /\b(pem|meeting|meetings)\b.+\b(conducted|ran|run|held|completed|kpi)\b/i.test(q);
  if (!metricShape) return false;
  // Explicit prospect-field asks are not operational metrics
  if (
    /\b(type\s*[12]\s*pain|customer story|customer pain|budget|decision process|meeting outcome|sales assessment|buildertrend handoff)\b/i.test(
      q,
    ) &&
    hasLikelyPersonRecordSignal(q)
  ) {
    return false;
  }
  return true;
}

/**
 * Company-wide structured metric / KPI / count questions (any domain).
 */
export function isStructuredMetricQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (hasLikelyPersonRecordSignal(q)) return false;
  if (isOperationalPemMetricQuestion(q)) return true;
  return (
    /\b(how many|how much|number of|total|average|avg|kpi|kpis|conversion rate|year to date|ytd)\b/i.test(
      q,
    ) &&
    /\b(sold|sell|sales|projects?|contracts?|deals?|margin|revenue|meetings?|pems?|pipeline|opportunities)\b/i.test(
      q,
    )
  );
}

export function matchConceptFromQuestion(question: string): ConceptDefinition | null {
  const q = normalizeConceptText(question);
  let best: ConceptDefinition | null = null;
  let bestScore = 0;
  for (const concept of BAXTER_CONCEPT_CATALOG) {
    let score = 0;
    for (const alias of concept.aliases) {
      const a = normalizeConceptText(alias);
      if (!a) continue;
      if (q.includes(a))
        score += a.length + (a === "pem neat" || a === concept.name.toLowerCase() ? 8 : 0);
    }
    if (score > bestScore) {
      bestScore = score;
      best = concept;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Detect concept/tool/process questions vs none.
 * Does not itself decide PEM record lookup — callers combine with person-name signals.
 */
export function detectConceptQuestion(question: string): ConceptQuestionDetection {
  const q = question.trim();
  if (!q) {
    return {
      kind: "none",
      conceptKey: null,
      conceptName: null,
      knowledgeSearchTerms: [],
      isConcept: false,
    };
  }

  if (CAPABILITY_OVERVIEW.test(q)) {
    return {
      kind: "capability_overview",
      conceptKey: "baxter",
      conceptName: "Baxter",
      knowledgeSearchTerms: ["Baxter"],
      isConcept: true,
    };
  }

  // "What is the last email from X in GHL?" is CRM recall, not a tool definition.
  if (
    /\b(last|latest|recent)\s+(e-?mail|message|sms|conversation)\b/i.test(q) ||
    /\bwhat did\s+.+\s+(e-?mail|say|send)\b/i.test(q)
  ) {
    return {
      kind: "none",
      conceptKey: null,
      conceptName: null,
      knowledgeSearchTerms: [],
      isConcept: false,
    };
  }

  const concept = matchConceptFromQuestion(q);
  const hasPersonSignal = hasLikelyPersonRecordSignal(q);

  if (HOW_TO_SHAPE.test(q) && concept && !hasPersonSignal) {
    return {
      kind: "how_to",
      conceptKey: concept.key,
      conceptName: concept.name,
      knowledgeSearchTerms: concept.knowledgeSearchTerms,
      isConcept: true,
    };
  }

  if (DEFINITION_SHAPE.test(q) && concept && !hasPersonSignal) {
    // "What is the RACI for <specific process>?" is a lookup, not a tool definition.
    // "What is a PEM NEAT for?" / "... for those who don't know" stays a definition.
    const forTail = q.match(/\bfor\b(.+)$/i)?.[1]?.trim() ?? "";
    const purposeFraming =
      !forTail ||
      /^(used for)?\s*\??$/i.test(forTail) ||
      /^(those who|people who|someone who|anyone who)\b/i.test(forTail);
    if (forTail && !purposeFraming && !/\bused for\b/i.test(q)) {
      // fall through — not a clean concept definition
    } else {
      return {
        kind: "definition",
        conceptKey: concept.key,
        conceptName: concept.name,
        knowledgeSearchTerms: concept.knowledgeSearchTerms,
        isConcept: true,
      };
    }
  }

  // "What is Type 1 Pain?" / "What is PALO?" without catalog match edge cases
  if (
    !hasPersonSignal &&
    /\b(what (is|are)|define|explain)\b/i.test(q) &&
    /\b(type\s*[12]\s*pain|palo|pem(\s+neat)?|neat|rulebook|slack recall|property research|process monitoring|knowledge (center|base)|ghl|gohighlevel)\b/i.test(
      q,
    )
  ) {
    const fallback = concept ?? matchConceptFromQuestion(q);
    return {
      kind: "definition",
      conceptKey: fallback?.key ?? null,
      conceptName: fallback?.name ?? null,
      knowledgeSearchTerms: fallback?.knowledgeSearchTerms ?? [],
      isConcept: true,
    };
  }

  return {
    kind: "none",
    conceptKey: concept?.key ?? null,
    conceptName: concept?.name ?? null,
    knowledgeSearchTerms: concept?.knowledgeSearchTerms ?? [],
    isConcept: false,
  };
}

/** Possessive / named-person cues that mean record lookup, not concept definition. */
export function hasLikelyPersonRecordSignal(question: string): boolean {
  const q = question.trim();
  // Possessive person: "Carter French's" / "Robert's"
  if (/\b([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){0,2})(?:'s|’s)\b/.test(q)) {
    const matches = [
      ...q.matchAll(/\b([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){0,2})(?:'s|’s)\b/g),
    ];
    for (const m of matches) {
      const raw = m[1] ?? "";
      const parts = raw.split(/\s+/).filter(Boolean);
      while (parts.length && isReservedConceptToken(parts[0]!)) parts.shift();
      const candidate = parts.join(" ");
      if (
        candidate &&
        !isReservedConceptName(candidate) &&
        !/^(his|her|their|its)$/i.test(candidate)
      ) {
        return true;
      }
    }
  }
  // "for/about Robert Vertin" — require a person-like name, not "for those who…"
  if (/\b(?:for|about|with|regarding)\s+[A-Za-z]/i.test(q)) {
    const m = q.match(
      /\b(?:for|about|with|regarding)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})\b/i,
    );
    const candidate = m?.[1]?.trim() ?? "";
    if (
      candidate &&
      !isReservedConceptName(candidate) &&
      !/^(the|a|an|this|that|his|her|their|those|these|them|people|someone|anyone|everyone|users|employees|who|whom|what|which|when|where|why|how)\b/i.test(
        candidate,
      )
    ) {
      // Prefer capitalized or multi-token personal names
      if (
        /^[A-Z]/.test(candidate) ||
        (candidate.split(/\s+/).length >= 2 &&
          !/^(those who|people who|anyone who|someone who)\b/i.test(candidate))
      ) {
        return true;
      }
    }
  }
  // Person + PEM field (case-insensitive): "robert vertin type 1 pain" / "Carter French budget"
  if (/\b(type\s*[12]\s*pain|budget|decision|outcome|handoff|buildertrend|score)\b/i.test(q)) {
    const cleaned = stripReservedConceptPhrases(
      q.replace(/\b(test\s*[\w.-]+)\b/gi, " ").replace(/['’]s\b/gi, ""),
    );
    const pairs = cleaned.matchAll(/\b([A-Za-z][A-Za-z'-]+)\s+([A-Za-z][A-Za-z'-]+)\b/g);
    for (const pair of pairs) {
      const candidate = `${pair[1]} ${pair[2]}`;
      if (
        !isReservedConceptName(candidate) &&
        !isReservedConceptToken(pair[1]!) &&
        !isReservedConceptToken(pair[2]!)
      ) {
        // Require name-like tokens (not question words)
        if (!/^(what|when|where|which|whose|this|that|with|from|into|about)$/i.test(pair[1]!)) {
          return true;
        }
      }
    }
  }
  // Capitalized First Last + pem/neat/pain
  if (
    /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(q) &&
    /\b(type\s*[12]|budget|decision|pain|outcome|pem|neat|score)\b/i.test(q)
  ) {
    const names = q.match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g) ?? [];
    for (const n of names) {
      if (!isReservedConceptName(n)) return true;
    }
  }
  // Pronoun record follow-ups: "his type 1 pain", "their budget"
  if (/\b(his|her|their)\b.+\b(type\s*[12]|budget|decision|pain|outcome|pem|neat)\b/i.test(q)) {
    return true;
  }
  return false;
}

export function isRetryOrCorrectionRequest(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (/^(try again|again|retry)[.!?]*$/i.test(q)) return true;
  return RETRY_SHAPE.test(q) && q.length < 180;
}

/**
 * When the user says "try again" / challenges the last answer, recover the prior
 * substantive user question so intent can be re-evaluated.
 */
export function resolveRetryQuestion(
  question: string,
  history: Array<{ role: string; content: string }>,
): string | null {
  if (!isRetryOrCorrectionRequest(question)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    if (msg.role !== "user") continue;
    const content = msg.content.trim();
    if (!content) continue;
    if (isRetryOrCorrectionRequest(content)) continue;
    // Prefer questions that look like the original ask
    return content;
  }
  // "Try again. Explain what a PEM NEAT is..." — strip retry preface
  const stripped = question
    .replace(/^(bad answer[.!]?\s*)?/i, "")
    .replace(/^try again[.!]?\s*/i, "")
    .trim();
  return stripped && stripped.toLowerCase() !== question.trim().toLowerCase() ? stripped : null;
}

/**
 * Resolve "how do I make one?" style follow-ups against the prior concept topic.
 */
export function resolveConceptFollowUp(
  question: string,
  history: Array<{ role: string; content: string }>,
): string | null {
  const q = question.trim();
  if (!q || history.length === 0) return null;
  const incomplete =
    /\bhow (do i|to) (make|generate|create|start|use) (one|it|that)\b|\bwhat (about|does) (it|that|one)\b|\btype\s*[12]\s*pain\b.*\bin (it|that|one)\b/i.test(
      q,
    ) || /^(how do i make one|how do i generate one|what about type\s*[12])\??$/i.test(q);
  if (!incomplete) return null;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    if (msg.role !== "user") continue;
    const prior = msg.content.trim();
    if (!prior || isRetryOrCorrectionRequest(prior)) continue;
    const priorConcept = detectConceptQuestion(prior);
    if (!priorConcept.isConcept || !priorConcept.conceptName) continue;
    if (/\b(make|generate|create|start)\b/i.test(q)) {
      return `How do I generate a ${priorConcept.conceptName}?`;
    }
    if (/\btype\s*1\b/i.test(q)) {
      return `What is Type 1 Pain in a ${priorConcept.conceptName}?`;
    }
    if (/\btype\s*2\b/i.test(q)) {
      return `What is Type 2 Pain in a ${priorConcept.conceptName}?`;
    }
    return `Explain ${priorConcept.conceptName}`;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
