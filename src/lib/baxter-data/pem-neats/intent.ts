/**
 * PEM NEAT question intent — help/definitions vs record lookup.
 * Entity parsing is case-insensitive and supports "Robert Vertin Test 8".
 */
import { detectRequestedPemFields, type PemFieldKey } from "./fields";

export type PemQuestionIntent =
  "none" | "help_definition" | "record_lookup" | "pem_selection_reply";

/** @deprecated Prefer PemFieldKey from fields.ts */
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

export type PemEntityParse = {
  /** Full query text used for matching (may include Test N). */
  nameQuery: string | null;
  /** Base person name without discriminator when separable. */
  baseName: string | null;
  /** Discriminator like "Test 8", "Test 2". */
  discriminator: string | null;
};

export type PemIntentResult = {
  intent: PemQuestionIntent;
  fields: PemFieldKey[];
  nameQuery: string | null;
  baseName: string | null;
  discriminator: string | null;
  wantsLatest: boolean;
  wantsFirst: boolean;
  dateHint: string | null;
  switchPemHint: string | null;
};

const HELP_DEFINITION =
  /\b(what (is|are) (a |an )?(pem|neat|palo)|define (pem|neat|palo)|explain (pem|neat)|what does neat stand for|how (do i|to) (generate|create|make|start) (a )?(pem )?neat|where (do i|to) (paste|add).*(transcript|pem))\b/i;

const HELP_TYPE_CONCEPT =
  /\b(what (is|are) (a |an )?(type\s*[12]|type one|type two)\s*pain|define type\s*[12]|explain type\s*[12])\b/i;

const RECORD_SIGNAL =
  /\b(pem|neat|type\s*[12]|palo|budget|decision|schedule|outcome|qualification|coaching|assessment|handoff|buildertrend|follow[- ]?up email|customer story|customer pain|next steps?|salesperson|advisor)\b/i;

const LOOKUP_SIGNAL =
  /\b(tell me about|what (was|were|is|are)|who (conducted|ran|did)|how did .+ (do|perform)|what did .+ (commit|promise|miss)|handoff notes?|buildertrend (fields?|notes?)|type\s*[12]\s*pain)\b/i;

function isStopName(name: string): boolean {
  return /^(Type|Pain|Budget|Acton|Baxter|Partnership|Evaluation|Meeting|BuilderTrend|GoHighLevel|Process|Rulebook|Test|His|Her|Their|What|Who|When|Where|How|Tell|Give|Show|Use|Try|Pick|That|This|Is|Are|Was|Were|About|For|With|Regarding|Actually|Do|Does|Did|The|A|An)$/i.test(
    name.trim(),
  );
}

const QUESTION_LEAD =
  /^(?:what|who|when|where|how|tell(?:\s+me)?|give(?:\s+me)?|show(?:\s+me)?|use|try|pick|choose|actually|that|this|is|are|was|were|about|for|with|regarding|do|does|did|the|a|an)\b/i;

function stripQuestionLead(value: string): string {
  let v = value.trim();
  for (let i = 0; i < 6; i++) {
    if (!QUESTION_LEAD.test(v)) break;
    v = v.replace(QUESTION_LEAD, "").trim();
  }
  return v;
}

function looksLikePersonName(value: string): boolean {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) return false;
  if (parts.some((p) => isStopName(p))) return false;
  return parts.every((p) => /^[A-Za-z][A-Za-z'-]*$/.test(p));
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Parse prospect + optional PEM discriminator from a question (case-insensitive).
 */
export function parsePemEntityQuery(question: string): PemEntityParse {
  const q = question.trim();
  if (!q) return { nameQuery: null, baseName: null, discriminator: null };

  // Find "... Name Name Test N ..." by anchoring on the Test discriminator.
  const testMatch = q.match(/\b(test\s*[\w.-]+)\b/i);
  if (testMatch?.index != null && testMatch[1]) {
    const disc = titleCaseWords(testMatch[1]);
    const before = stripQuestionLead(
      q
        .slice(0, testMatch.index)
        .replace(/['’]s\s*$/i, "")
        .trim(),
    );
    const words = before.split(/\s+/).filter(Boolean);
    // Take trailing 1–3 name tokens
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      const candidate = words.slice(-n).join(" ");
      if (looksLikePersonName(candidate)) {
        const base = titleCaseWords(candidate);
        return { nameQuery: `${base} ${disc}`, baseName: base, discriminator: disc };
      }
    }
    // Discriminator alone (selection reply)
    if (
      /^\s*(?:use|try|pick|choose|go with|go back to|actually use)?\s*test\s*[\w.-]+\s*$/i.test(q)
    ) {
      return { nameQuery: null, baseName: null, discriminator: disc };
    }
  }

  // Possessive: Robert Vertin's / Robert's
  const possessive = q.match(/\b([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})(?:'s|’s)\b/);
  if (possessive?.[1] && looksLikePersonName(possessive[1])) {
    const base = titleCaseWords(possessive[1]);
    return { nameQuery: base, baseName: base, discriminator: null };
  }

  // about/for/with Name
  const about = q.match(
    /\b(?:about|for|with|regarding)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3})\b/i,
  );
  if (about?.[1]) {
    const cleaned = stripQuestionLead(about[1]);
    if (looksLikePersonName(cleaned)) {
      const base = titleCaseWords(cleaned);
      return { nameQuery: base, baseName: base, discriminator: null };
    }
  }

  // First Last somewhere after stripping leads
  const remainder = stripQuestionLead(q.replace(/[?’']/g, " "));
  const full = remainder.match(/\b([A-Za-z][A-Za-z'-]+)\s+([A-Za-z][A-Za-z'-]+)\b/);
  if (full?.[1] && full[2] && looksLikePersonName(`${full[1]} ${full[2]}`)) {
    const base = titleCaseWords(`${full[1]} ${full[2]}`);
    return { nameQuery: base, baseName: base, discriminator: null };
  }

  // "the Vertin meeting/pem/neat"
  const surname = q.match(/\bthe\s+([A-Za-z][A-Za-z'-]+)\s+(?:pem|neat|meeting)\b/i);
  if (surname?.[1] && looksLikePersonName(surname[1])) {
    const base = titleCaseWords(surname[1]);
    return { nameQuery: base, baseName: base, discriminator: null };
  }

  // Bare discriminator
  const bareDisc = q.match(
    /^\s*(?:use|try|pick|choose|go with|go back to|actually use)?\s*(test\s*[\w.-]+)\s*$/i,
  );
  if (bareDisc?.[1]) {
    return {
      nameQuery: null,
      baseName: null,
      discriminator: titleCaseWords(bareDisc[1]),
    };
  }

  return { nameQuery: null, baseName: null, discriminator: null };
}

export function extractNameQuery(question: string): string | null {
  return parsePemEntityQuery(question).nameQuery;
}

function extractDateHint(question: string): string | null {
  const m = question.match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s*\d{4})?\b/i,
  );
  return m?.[0] ?? null;
}

function extractSwitchPemHint(question: string): string | null {
  const m = question.match(
    /\b(?:use|try|pick|choose|go with|go back to|actually use|switch to)\s+((?:test\s*)?[\w.-]+)/i,
  );
  return m?.[1] ? m[1].trim() : null;
}

export function detectPemIntent(question: string): PemIntentResult {
  const q = question.trim();
  const empty: PemIntentResult = {
    intent: "none",
    fields: [],
    nameQuery: null,
    baseName: null,
    discriminator: null,
    wantsLatest: true,
    wantsFirst: false,
    dateHint: null,
    switchPemHint: null,
  };
  if (!q) return empty;

  const entity = parsePemEntityQuery(q);

  // Pure concept help — not a prospect lookup
  if (HELP_DEFINITION.test(q) && !entity.nameQuery) {
    return { ...empty, intent: "help_definition" };
  }
  if (
    HELP_TYPE_CONCEPT.test(q) &&
    !entity.nameQuery &&
    !/\b(his|her|their|robert|alex)\b/i.test(q)
  ) {
    return { ...empty, intent: "help_definition" };
  }

  // Bare / short discriminator replies are handled with pending state.
  if (!entity.nameQuery && entity.discriminator && /^(test\s*[\w.-]+)$/i.test(q.trim())) {
    return {
      ...empty,
      intent: "pem_selection_reply",
      discriminator: entity.discriminator,
      fields: detectRequestedPemFields(q),
    };
  }

  if (
    /^(use|try|pick|choose|go with|go back to|actually use)\b/i.test(q) &&
    !RECORD_SIGNAL.test(q)
  ) {
    return {
      ...empty,
      intent: "pem_selection_reply",
      discriminator: entity.discriminator ?? extractSwitchPemHint(q),
      fields: detectRequestedPemFields(q),
      switchPemHint: extractSwitchPemHint(q),
    };
  }

  const capabilityShape =
    /\b(can you|are you able to|do you (support|have)|how do i|where (do i|can i))\b/i.test(q) &&
    !entity.nameQuery;

  const looksLikeRecord =
    !capabilityShape &&
    ((RECORD_SIGNAL.test(q) && LOOKUP_SIGNAL.test(q)) ||
      (RECORD_SIGNAL.test(q) && Boolean(entity.nameQuery)) ||
      /\b(pem|neat)\b.*\b(for|about|with)\b/i.test(q) ||
      /\b(tell me about|what about)\b.+\b(pem|meeting|neat)\b/i.test(q) ||
      (/\btell me about\b/i.test(q) &&
        Boolean(entity.nameQuery) &&
        !/\b(acton|google|baxter|policy|procedure|rulebook|knowledge)\b/i.test(q)) ||
      (/\b(type\s*[12]\s*pain|handoff notes?|buildertrend)\b/i.test(q) &&
        (Boolean(entity.nameQuery) || /\b(his|her|their)\b/i.test(q))));

  if (!looksLikeRecord) {
    // Still allow discriminator + active context to be handled upstream
    if (entity.discriminator && /\b(type\s*[12]|budget|decision|pain)\b/i.test(q)) {
      return {
        ...empty,
        intent: "record_lookup",
        fields: detectRequestedPemFields(q),
        nameQuery: entity.nameQuery,
        baseName: entity.baseName,
        discriminator: entity.discriminator,
        switchPemHint: extractSwitchPemHint(q),
      };
    }
    return empty;
  }

  const wantsFirst = /\b(first|earlier|initial|older)\b/i.test(q);
  return {
    intent: "record_lookup",
    fields: detectRequestedPemFields(q),
    nameQuery: entity.nameQuery,
    baseName: entity.baseName,
    discriminator: entity.discriminator,
    wantsLatest: !wantsFirst,
    wantsFirst,
    dateHint: extractDateHint(q),
    switchPemHint: extractSwitchPemHint(q),
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
  if (
    (/\bwhat is type\s*1\b|\bdefine type\s*1\b|\bwhat is type one\b/i.test(q) ||
      /\bwhat is (a |an )?type\s*1\s*pain\b/i.test(q)) &&
    !/\b(his|her|their|[A-Za-z]+(?:'s|’s))\b/i.test(question)
  ) {
    return [
      "**Type 1 Pain** is why the homeowner is considering an ADU — the functional need and deeper consequence (for example: independent nearby housing for a family member).",
      "",
      "It's distinct from Type 2 Pain, which is why choosing the right building partner matters.",
    ].join("\n");
  }
  if (
    (/\bwhat is type\s*2\b|\bdefine type\s*2\b|\bwhat is type two\b/i.test(q) ||
      /\bwhat is (a |an )?type\s*2\s*pain\b/i.test(q)) &&
    !/\b(his|her|their|[A-Za-z]+(?:'s|’s))\b/i.test(question)
  ) {
    return [
      "**Type 2 Pain** is why the right construction partner matters — concerns like communication, surprise costs, project management, transparency, or coordination across trades.",
      "",
      "It's distinct from Type 1 Pain (why build an ADU at all).",
    ].join("\n");
  }
  return null;
}
