/**
 * PEM NEAT question intent — distinguish help/definitions from record lookup.
 */

export type PemQuestionIntent = "none" | "help_definition" | "record_lookup";

export type PemFieldFocus =
  | "summary"
  | "type1_pain"
  | "type2_pain"
  | "customer_story"
  | "customer_pain"
  | "budget"
  | "decision"
  | "schedule"
  | "alternatives"
  | "recommendation"
  | "next_steps"
  | "outcome"
  | "qualification"
  | "assessment"
  | "coaching"
  | "handoff"
  | "buildertrend"
  | "project"
  | "commitments"
  | "salesperson"
  | "identity";

export type PemIntentResult = {
  intent: PemQuestionIntent;
  fields: PemFieldFocus[];
  nameQuery: string | null;
  wantsLatest: boolean;
  wantsFirst: boolean;
  dateHint: string | null;
};

const HELP_DEFINITION =
  /\b(what (is|are) (a |an )?(pem|neat|palo|type\s*[12]\s*pain)|define (pem|neat|palo)|explain (pem|neat)|what does neat stand for|how (do i|to) (generate|create|make|start) (a )?(pem )?neat|where (do i|to) (paste|add).*(transcript|pem))\b/i;

const RECORD_SIGNAL =
  /\b(pem|neat|type\s*[12]|palo|budget|decision|schedule|outcome|qualification|coaching|assessment|handoff|buildertrend|follow[- ]?up email|customer story|customer pain|next steps?|salesperson|advisor)\b/i;

const LOOKUP_SIGNAL =
  /\b(tell me about|what (was|were|is|are)|who (conducted|ran|did)|how did .+ (do|perform)|what did .+ (commit|promise|miss)|handoff notes?|buildertrend (fields?|notes?)|type\s*[12]\s*pain)\b/i;

const FIELD_PATTERNS: Array<{ field: PemFieldFocus; re: RegExp }> = [
  { field: "type1_pain", re: /\btype\s*1\b|\btype one\b/i },
  { field: "type2_pain", re: /\btype\s*2\b|\btype two\b/i },
  { field: "customer_story", re: /\bcustomer story\b/i },
  { field: "customer_pain", re: /\bcustomer pain\b(?!.*type)/i },
  { field: "budget", re: /\bbudget\b|\bfunding\b|\bcash available\b|\bceiling\b/i },
  { field: "decision", re: /\bdecision\b|\bwho decides\b|\bdecision[- ]making\b|\bgating\b/i },
  { field: "schedule", re: /\bschedule\b|\btiming\b|\burgency\b/i },
  { field: "alternatives", re: /\balternatives?\b|\bcompetition\b|\bother options?\b/i },
  { field: "recommendation", re: /\brecommendation\b|\bacton (fit|recommendation)\b/i },
  { field: "next_steps", re: /\bnext steps?\b|\bwhat did .+ commit\b/i },
  { field: "outcome", re: /\boutcome\b|\bmeeting outcome\b/i },
  { field: "qualification", re: /\bqualif/i },
  {
    field: "coaching",
    re: /\bcoaching\b|\bone thing\b|\bwhat did .+ miss\b|\bimprovements?\b|\bhow did .+ do\b|\bsalesperson do\b|\badvisor do\b/i,
  },
  { field: "assessment", re: /\bassessment\b|\bgrading\b|\bsales execution\b|\bpalo\b/i },
  {
    field: "buildertrend",
    re: /\bbuildertrend\b|\bbt fields?\b|\bcustom fields?\b|\bhandoff notes?\b/i,
  },
  { field: "handoff", re: /\bhandoff\b|\bproject intelligence\b|\bproduction notes?\b/i },
  { field: "project", re: /\bproject (facts?|intelligence|notes?)\b/i },
  { field: "salesperson", re: /\bwho (conducted|ran|led)\b|\bsalesperson\b/i },
];

function isStopName(name: string): boolean {
  return /^(Type|Pain|Budget|Acton|Baxter|Partnership|Evaluation|Meeting|BuilderTrend|GoHighLevel|Process|Rulebook)$/i.test(
    name.trim(),
  );
}

export function extractNameQuery(question: string): string | null {
  const possessive = question.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:'s|’s)\b/);
  if (possessive?.[1] && !isStopName(possessive[1])) return possessive[1];

  const about = question.match(
    /\b(?:about|for|with|regarding)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/,
  );
  if (about?.[1] && !isStopName(about[1])) return about[1];

  const full = question.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/);
  if (full?.[1] && !isStopName(full[1])) return full[1];

  const surname = question.match(/\bthe\s+([A-Z][a-z]+)\s+(?:pem|neat|meeting)\b/i);
  if (surname?.[1] && !isStopName(surname[1])) return surname[1];

  return null;
}

function detectFields(question: string): PemFieldFocus[] {
  const hits: PemFieldFocus[] = [];
  for (const { field, re } of FIELD_PATTERNS) {
    if (re.test(question) && !hits.includes(field)) hits.push(field);
  }
  if (/\bfull (summary|neat|pem)\b|\beverything about\b/i.test(question)) {
    return ["summary", "type1_pain", "type2_pain", "budget", "decision", "outcome", "next_steps"];
  }
  return hits;
}

function extractDateHint(question: string): string | null {
  const m = question.match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s*\d{4})?\b/i,
  );
  return m?.[0] ?? null;
}

export function detectPemIntent(question: string): PemIntentResult {
  const q = question.trim();
  const empty: PemIntentResult = {
    intent: "none",
    fields: [],
    nameQuery: null,
    wantsLatest: true,
    wantsFirst: false,
    dateHint: null,
  };
  if (!q) return empty;

  // Pure help / definitions — not prospect lookup
  if (HELP_DEFINITION.test(q) && !extractNameQuery(q)) {
    return { ...empty, intent: "help_definition" };
  }

  const nameQuery = extractNameQuery(q);
  // Capability/help "can you update BuilderTrend?" is not a prospect lookup.
  const capabilityShape =
    /\b(can you|are you able to|do you (support|have)|how do i|where (do i|can i))\b/i.test(q) &&
    !nameQuery;

  const looksLikeRecord =
    !capabilityShape &&
    ((RECORD_SIGNAL.test(q) && LOOKUP_SIGNAL.test(q)) ||
      (RECORD_SIGNAL.test(q) && Boolean(nameQuery)) ||
      /\b(pem|neat)\b.*\b(for|about|with)\b/i.test(q) ||
      /\b(tell me about|what about)\b.+\b(pem|meeting|neat)\b/i.test(q) ||
      (/\btell me about\b/i.test(q) &&
        Boolean(nameQuery) &&
        !/\b(acton|google|baxter|policy|procedure|rulebook|knowledge)\b/i.test(q)) ||
      (/\b(type\s*[12]\s*pain|handoff notes?|buildertrend)\b/i.test(q) && Boolean(nameQuery)));

  if (!looksLikeRecord) return empty;

  const wantsFirst = /\b(first|earlier|initial|older)\b/i.test(q);
  return {
    intent: "record_lookup",
    fields: detectFields(q).length ? detectFields(q) : ["summary"],
    nameQuery,
    wantsLatest: !wantsFirst,
    wantsFirst,
    dateHint: extractDateHint(q),
  };
}

/** Authoritative short definitions from Acton PEM/NEAT governing docs. */
export function pemHelpDefinitionAnswer(question: string): string | null {
  const q = question.toLowerCase();
  if (/\bwhat is a? ?pem\b|\bwhat are pems\b|\bdefine pem\b/.test(q) && !/\bneat\b/.test(q)) {
    return [
      "A **PEM** is a Partnership Evaluation Meeting — Acton's sales meeting to determine whether there's a mutually appropriate ADU partnership.",
      "",
      "In a PEM, the advisor builds trust, sets an up-front agreement (PALO), and explores Type 1 pain (why build), Type 2 pain (why the right partner), budget, decision process, schedule, fit, and a clear next step.",
      "",
      "It's not just a product pitch — it's a structured evaluation of fit on both sides.",
    ].join("\n");
  }
  if (
    /\bwhat is a? ?pem neat\b|\bwhat is a? ?neat\b|\bwhat does neat stand for\b|\bdefine neat\b/.test(
      q,
    )
  ) {
    return [
      "A **PEM NEAT** is Acton's internal sales intelligence artifact produced from a PEM transcript.",
      "",
      "NEAT stands for **N**otes, **E**mail, **A**ssessment, and **T**ranscript.",
      "",
      "It captures customer story/pain, Type 1 & Type 2 pain, budget, decision process, schedule, outcome, sales coaching, a customer follow-up email, and BuilderTrend handoff fields for copy/paste.",
      "",
      "Generate one in Baxter: open Partnership Evaluation Meeting NEAT → + Add PEM NEAT → paste the transcript → Generate.",
      "",
      "Start here: /pem-neats/new",
    ].join("\n");
  }
  if (
    /\bhow (do i|to) (generate|create|make|start|run) (a )?(pem )?neat\b|\bwhere (do i|to) (paste|add).*(transcript|pem)\b/i.test(
      q,
    )
  ) {
    return [
      "To generate a PEM NEAT in Baxter:",
      "1. Open **Partnership Evaluation Meeting NEAT**",
      "2. Click **+ Add PEM NEAT**",
      "3. Enter the prospect, select the salesperson, and paste the meeting transcript",
      "4. Click **Generate**",
      "",
      "Baxter saves the NEAT so you can reopen it later, edit the transcript, or regenerate.",
      "",
      "Start here: /pem-neats/new",
    ].join("\n");
  }
  if (/\bwhat is palo\b|\bdefine palo\b|\bup[- ]?front contract\b/i.test(q)) {
    return [
      "**PALO** is Acton's up-front contract in a PEM: **P**urpose, **A**genda, **L**ogistics, and **O**utcome.",
      "",
      "The advisor should clearly set why you're meeting, what you'll cover, meeting logistics/time, and the possible meeting outcomes before deep discovery.",
    ].join("\n");
  }
  if (/\bwhat is type\s*1\b|\bdefine type\s*1\b/i.test(q)) {
    return [
      "**Type 1 Pain** is why the homeowner is considering an ADU — the functional need and deeper consequence (for example: independent nearby housing for a family member).",
      "",
      "It's distinct from Type 2 Pain, which is why choosing the right building partner matters.",
    ].join("\n");
  }
  if (/\bwhat is type\s*2\b|\bdefine type\s*2\b/i.test(q)) {
    return [
      "**Type 2 Pain** is why the right construction partner matters — concerns like communication, surprise costs, project management, transparency, or coordination across trades.",
      "",
      "It's distinct from Type 1 Pain (why build an ADU at all).",
    ].join("\n");
  }
  return null;
}
