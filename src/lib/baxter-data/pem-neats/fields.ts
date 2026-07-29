/**
 * Canonical PEM NEAT field registry + structured accessors.
 * Code decides which field was requested; the LLM must not guess Type 1 vs Type 2.
 */
import { ASSESSMENT_CATEGORY_LABELS } from "@/lib/pem-neat/constants";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";

export type PemFieldKey =
  | "customer_story"
  | "customer_pain"
  | "type_1_pain"
  | "type_2_pain"
  | "budget"
  | "decision_process"
  | "schedule"
  | "competition"
  | "fit"
  | "next_steps"
  | "outcome"
  | "qualification"
  | "assessment"
  | "coaching"
  | "buildertrend"
  | "project"
  | "salesperson"
  | "summary";

export type PemFieldValue = {
  key: PemFieldKey;
  label: string;
  /** Human-readable lines; empty means not determinable. */
  lines: string[];
  determinable: boolean;
};

/** Map legacy PemFieldFocus aliases used elsewhere. */
export const LEGACY_FIELD_TO_CANONICAL: Record<string, PemFieldKey> = {
  type1_pain: "type_1_pain",
  type2_pain: "type_2_pain",
  customer_story: "customer_story",
  customer_pain: "customer_pain",
  budget: "budget",
  decision: "decision_process",
  schedule: "schedule",
  alternatives: "competition",
  recommendation: "fit",
  next_steps: "next_steps",
  commitments: "next_steps",
  outcome: "outcome",
  qualification: "qualification",
  assessment: "assessment",
  coaching: "coaching",
  handoff: "buildertrend",
  buildertrend: "buildertrend",
  project: "project",
  salesperson: "salesperson",
  identity: "summary",
  summary: "summary",
};

export function toCanonicalField(key: string): PemFieldKey {
  return LEGACY_FIELD_TO_CANONICAL[key] ?? (key as PemFieldKey);
}

/**
 * Detect requested PEM field(s) from natural language.
 * Type 1 and Type 2 are mutually exclusive when the user asks for one specifically.
 */
export function detectRequestedPemFields(question: string): PemFieldKey[] {
  const q = question.trim();
  if (!q) return [];

  // Prefer the field being asked now (ignore "that was type 2" corrections).
  const askType1 =
    /\b(?:what (?:is|was|about)|tell me|give me|show me)\b[\s\S]{0,80}\b(?:type\s*1|type one)\b/i.test(
      q,
    ) || /\b(?:type\s*1|type one)\s*pain\b/i.test(q);
  const askType2 =
    /\b(?:what (?:is|was|about)|tell me|give me|show me)\b[\s\S]{0,80}\b(?:type\s*2|type two)\b/i.test(
      q,
    ) ||
    (/\b(?:type\s*2|type two)\s*pain\b/i.test(q) &&
      !/\b(?:that (?:is|was)|not)\s+type\s*2\b/i.test(q));

  // Correction patterns: "That is type 2. What is his type 1?"
  if (/\bthat (?:is|was) type\s*2\b/i.test(q) && /\btype\s*1\b/i.test(q)) {
    return ["type_1_pain"];
  }
  if (/\bthat (?:is|was) type\s*1\b/i.test(q) && /\btype\s*2\b/i.test(q)) {
    return ["type_2_pain"];
  }

  if (askType1 && !askType2) return ["type_1_pain"];
  if (askType2 && !askType1) return ["type_2_pain"];
  if (askType1 && askType2) {
    // Both mentioned — use the last occurrence in the question.
    const last1 = Math.max(
      q.toLowerCase().lastIndexOf("type 1"),
      q.toLowerCase().lastIndexOf("type one"),
    );
    const last2 = Math.max(
      q.toLowerCase().lastIndexOf("type 2"),
      q.toLowerCase().lastIndexOf("type two"),
    );
    return last2 > last1 ? ["type_2_pain"] : ["type_1_pain"];
  }

  // Alias maps — never cross-wire Type 1 ↔ Type 2.
  const patterns: Array<{ key: PemFieldKey; re: RegExp }> = [
    {
      key: "type_1_pain",
      re: /\bwhy (?:do they|does (?:he|she|the prospect)|build)|why (?:an )?adu|reason for building|underlying reason\b/i,
    },
    {
      key: "type_2_pain",
      re: /\bwhy (?:acton|choose acton|the right (?:builder|partner|contractor))|builder pain|contractor concerns?|partner(?:ship)? concerns?\b/i,
    },
    { key: "customer_story", re: /\bcustomer story\b/i },
    { key: "customer_pain", re: /\bcustomer pain\b(?!.*type)/i },
    {
      key: "budget",
      re: /\bbudget\b|\bhow much\b|\bprice range\b|\bfinancial (?:situation|picture)\b|\bfunding\b|\bceiling\b/i,
    },
    {
      key: "decision_process",
      re: /\bdecision(?:[- ]making)?(?: process)?\b|\bwho decides\b|\bdecision makers?\b|\bhow are they deciding\b|\bgating\b/i,
    },
    {
      key: "schedule",
      re: /\bschedule\b|\btiming\b|\burgency\b|\bwhen (?:do|did) they (?:want|need)\b/i,
    },
    {
      key: "competition",
      re: /\balternatives?\b|\bcompetition\b|\bother (?:builders?|options?)\b/i,
    },
    {
      key: "fit",
      re: /\b(?:acton )?(?:fit|recommendation)\b|\brecommendation\b/i,
    },
    { key: "next_steps", re: /\bnext steps?\b|\bwhat did .+ commit\b|\bcommitments?\b/i },
    { key: "outcome", re: /\b(?:meeting )?outcome\b/i },
    { key: "qualification", re: /\bqualif/i },
    {
      key: "coaching",
      re: /\bcoaching\b|\bone thing\b|\bwhat did .+ miss\b|\bimprovements?\b|\bhow did .+ do\b|\bsalesperson do\b|\badvisor do\b/i,
    },
    { key: "assessment", re: /\bassessment\b|\bgrading\b|\bsales execution\b|\bpalo\b/i },
    {
      key: "buildertrend",
      re: /\bbuildertrend\b|\bbt fields?\b|\bcustom fields?\b|\bhandoff notes?\b|\bhandoff\b/i,
    },
    { key: "project", re: /\bproject (?:facts?|intelligence|notes?)\b/i },
    { key: "salesperson", re: /\bwho (?:conducted|ran|led)\b|\bsalesperson\b|\badvisor\b/i },
  ];

  const hits: PemFieldKey[] = [];
  for (const { key, re } of patterns) {
    if (re.test(q) && !hits.includes(key)) hits.push(key);
  }

  if (/\bfull (?:summary|neat|pem)\b|\beverything about\b|\bsummary of\b/i.test(q)) {
    return ["summary"];
  }

  return hits.length ? hits : ["summary"];
}

function evidencedText(
  value: { value?: string | number | null } | string | null | undefined,
): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (value.value == null || value.value === "") return "";
  return String(value.value).trim();
}

function painLines(
  items: Array<{ statement?: string | null; surfaceReason?: string | null }> | unknown,
): string[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const o = item as { statement?: string | null; surfaceReason?: string | null };
      return (o.statement || o.surfaceReason || "").trim();
    })
    .filter(Boolean);
}

/**
 * Extract one canonical field from structured_result (tolerates known shapes).
 * Never substitutes Type 1 ↔ Type 2.
 */
export function getPemField(
  structured: PemNeatStructuredResult | Record<string, unknown> | null | undefined,
  key: PemFieldKey,
  extras?: { salespersonName?: string | null; buildertrendFallback?: Record<string, unknown> },
): PemFieldValue {
  const labelFor: Record<PemFieldKey, string> = {
    customer_story: "Customer Story",
    customer_pain: "Customer Pain",
    type_1_pain: "Type 1 Pain",
    type_2_pain: "Type 2 Pain",
    budget: "Budget",
    decision_process: "Decision Process",
    schedule: "Schedule",
    competition: "Competition / Alternatives",
    fit: "Acton Recommendation",
    next_steps: "Next Steps",
    outcome: "Meeting Outcome",
    qualification: "Qualification",
    assessment: "Sales Assessment",
    coaching: "Coaching",
    buildertrend: "BuilderTrend Handoff",
    project: "Project Intelligence",
    salesperson: "Salesperson",
    summary: "PEM Summary",
  };

  const empty = (k: PemFieldKey): PemFieldValue => ({
    key: k,
    label: labelFor[k],
    lines: [],
    determinable: false,
  });

  if (!structured || typeof structured !== "object") return empty(key);

  const si = (structured as PemNeatStructuredResult).salesIntelligence as
    PemNeatStructuredResult["salesIntelligence"] | undefined;
  const assessment = (structured as PemNeatStructuredResult).assessment;
  const projectIntelligence = (structured as PemNeatStructuredResult).projectIntelligence;
  const buildertrendFields =
    ((structured as PemNeatStructuredResult).buildertrendFields as
      Record<string, unknown> | undefined) ??
    extras?.buildertrendFallback ??
    {};

  // Tolerate alternate key casings from older generations.
  const siAny = (si ?? {}) as Record<string, unknown>;
  const type1 =
    (si?.type1Pain as unknown) ?? siAny.type_1_pain ?? siAny.type1_pain ?? siAny.Type1Pain;
  const type2 =
    (si?.type2Pain as unknown) ?? siAny.type_2_pain ?? siAny.type2_pain ?? siAny.Type2Pain;

  switch (key) {
    case "type_1_pain": {
      const lines = painLines(type1);
      return { key, label: labelFor[key], lines, determinable: lines.length > 0 };
    }
    case "type_2_pain": {
      const lines = painLines(type2);
      return { key, label: labelFor[key], lines, determinable: lines.length > 0 };
    }
    case "customer_story": {
      const text = (si?.customerStory || "").trim();
      return { key, label: labelFor[key], lines: text ? [text] : [], determinable: Boolean(text) };
    }
    case "customer_pain": {
      const text = (si?.customerPain || "").trim();
      return { key, label: labelFor[key], lines: text ? [text] : [], determinable: Boolean(text) };
    }
    case "budget": {
      const b = si?.budget;
      const lines: string[] = [];
      if (b?.summary?.trim()) lines.push(b.summary.trim());
      const stated = evidencedText(b?.statedBudget);
      if (stated) lines.push(`Stated/available: ${stated}`);
      const target = evidencedText(b?.target);
      if (target) lines.push(`Target: ${target}`);
      const ceiling = evidencedText(b?.hardCeiling);
      if (ceiling) lines.push(`Upper threshold: ${ceiling}`);
      if (b?.scope?.trim()) lines.push(`Scope: ${b.scope.trim()}`);
      if (b?.fundingSource?.trim()) lines.push(`Funding: ${b.fundingSource.trim()}`);
      if (b?.range?.trim() && !lines.some((l) => l.includes(b.range!))) {
        lines.push(`Range: ${b.range.trim()}`);
      }
      return { key, label: labelFor[key], lines, determinable: lines.length > 0 };
    }
    case "decision_process": {
      const d = si?.decisionProcess;
      const lines: string[] = [];
      const summary = (d?.summary || d?.process || "").trim();
      if (summary) lines.push(summary);
      if (d?.decisionMakers?.length) {
        const makers = d.decisionMakers.map((m) => evidencedText(m)).filter(Boolean);
        if (makers.length) lines.push(`Decision makers: ${makers.join("; ")}`);
      }
      if (d?.alternatives?.length) lines.push(`Alternatives: ${d.alternatives.join("; ")}`);
      const timing = evidencedText(d?.timing);
      if (timing) lines.push(`Timing: ${timing}`);
      return { key, label: labelFor[key], lines, determinable: lines.length > 0 };
    }
    case "schedule": {
      const s = si?.schedule;
      const lines: string[] = [];
      if (s?.summary?.trim()) lines.push(s.summary.trim());
      if (s?.flexibility?.trim()) lines.push(`Flexibility/urgency: ${s.flexibility.trim()}`);
      return { key, label: labelFor[key], lines, determinable: lines.length > 0 };
    }
    case "competition": {
      const alts =
        (si?.competitionAlternatives ?? []).filter(Boolean).length > 0
          ? (si?.competitionAlternatives ?? []).filter(Boolean)
          : (si?.decisionProcess?.alternatives ?? []).filter(Boolean);
      return {
        key,
        label: labelFor[key],
        lines: alts,
        determinable: alts.length > 0,
      };
    }
    case "fit": {
      const fit = (si?.actonRecommendation?.fit || "").trim();
      const reasoning = (si?.actonRecommendation?.reasoning || "").trim();
      const lines = [fit, reasoning].filter(Boolean);
      return { key, label: labelFor[key], lines, determinable: lines.length > 0 };
    }
    case "next_steps": {
      const prospect = (si?.nextSteps?.prospect ?? []).filter(Boolean);
      const acton = (si?.nextSteps?.acton ?? []).filter(Boolean);
      const lines: string[] = [];
      if (prospect.length) lines.push(`Prospect: ${prospect.join("; ")}`);
      if (acton.length) lines.push(`Acton: ${acton.join("; ")}`);
      return { key, label: labelFor[key], lines, determinable: lines.length > 0 };
    }
    case "outcome": {
      const classification = si?.meetingOutcome?.classification;
      const explanation = (si?.meetingOutcome?.explanation || "").trim();
      const lines = [classification ? String(classification) : "", explanation].filter(Boolean);
      return { key, label: labelFor[key], lines, determinable: lines.length > 0 };
    }
    case "qualification": {
      const classification = si?.qualification?.classification;
      const reasoning = (si?.qualification?.reasoning || "").trim();
      const lines = [classification ? String(classification) : "", reasoning].filter(Boolean);
      return { key, label: labelFor[key], lines, determinable: lines.length > 0 };
    }
    case "assessment":
    case "coaching": {
      const a = assessment;
      if (!a) return empty(key);
      const lines: string[] = [];
      if (a.topStrengths?.length) lines.push(`Top strengths: ${a.topStrengths.join("; ")}`);
      if (a.topImprovements?.length)
        lines.push(`Top improvements: ${a.topImprovements.join("; ")}`);
      if (a.oneThing?.trim()) lines.push(`The One Thing: ${a.oneThing.trim()}`);
      for (const cat of a.categories ?? []) {
        if (key === "coaching" && !cat.coachingOpportunity && !cat.whatWorked) continue;
        const label =
          ASSESSMENT_CATEGORY_LABELS[cat.key as keyof typeof ASSESSMENT_CATEGORY_LABELS] ??
          cat.label;
        lines.push(
          `${label}: score ${cat.score ?? "N/A"} (${cat.status})`,
          cat.evidence ? `  Evidence: ${cat.evidence}` : "",
          cat.whatWorked ? `  What worked: ${cat.whatWorked}` : "",
          cat.coachingOpportunity ? `  Coaching: ${cat.coachingOpportunity}` : "",
        );
      }
      const cleaned = lines.filter(Boolean);
      return { key, label: labelFor[key], lines: cleaned, determinable: cleaned.length > 0 };
    }
    case "buildertrend": {
      const interesting = Object.entries(buildertrendFields)
        .filter(([, v]) => {
          if (v == null || v === "") return false;
          if (Array.isArray(v) && v.length === 0) return false;
          return true;
        })
        .slice(0, 20)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
      return {
        key,
        label: labelFor[key],
        lines: interesting,
        determinable: interesting.length > 0,
      };
    }
    case "project": {
      const facts = projectIntelligence?.facts ?? [];
      const lines = facts
        .slice(0, 12)
        .map((f) => `${f.topic}: ${f.value ?? "unknown"} (${f.status})`);
      const notes = ((structured as PemNeatStructuredResult).internalOpportunityNotes || "").trim();
      if (notes) lines.push(`Internal opportunity notes: ${notes}`);
      return { key, label: labelFor[key], lines, determinable: lines.length > 0 };
    }
    case "salesperson": {
      const name = (extras?.salespersonName || "").trim();
      return {
        key,
        label: labelFor[key],
        lines: name ? [name] : [],
        determinable: Boolean(name),
      };
    }
    case "summary": {
      const parts: string[] = [];
      const story = getPemField(structured, "customer_story", extras);
      const t1 = getPemField(structured, "type_1_pain", extras);
      const t2 = getPemField(structured, "type_2_pain", extras);
      const budget = getPemField(structured, "budget", extras);
      const decision = getPemField(structured, "decision_process", extras);
      const outcome = getPemField(structured, "outcome", extras);
      if (story.determinable) parts.push(`Customer Story: ${story.lines.join(" ")}`);
      if (t1.determinable) parts.push(`Type 1 Pain: ${t1.lines.map((l) => `• ${l}`).join(" ")}`);
      if (t2.determinable) parts.push(`Type 2 Pain: ${t2.lines.map((l) => `• ${l}`).join(" ")}`);
      if (budget.determinable) parts.push(`Budget: ${budget.lines.join("; ")}`);
      if (decision.determinable) parts.push(`Decision: ${decision.lines.join("; ")}`);
      if (outcome.determinable) parts.push(`Outcome: ${outcome.lines.join("; ")}`);
      return { key, label: labelFor[key], lines: parts, determinable: parts.length > 0 };
    }
    default:
      return empty(key);
  }
}

export function formatDeterministicPemAnswer(input: {
  prospectName: string;
  field: PemFieldValue;
  citationLabel: string;
}): string {
  const { prospectName, field, citationLabel } = input;
  if (!field.determinable) {
    return [
      `${prospectName} does not contain a determinable ${field.label}.`,
      "",
      `Source: ${citationLabel}`,
    ].join("\n");
  }

  const body =
    field.lines.length === 1
      ? field.lines[0]!
      : field.lines
          .map((line) => (line.startsWith("•") || line.startsWith("  ") ? line : `• ${line}`))
          .join("\n");

  return [`${prospectName}'s ${field.label} was:`, body, "", `Source: ${citationLabel}`].join("\n");
}
