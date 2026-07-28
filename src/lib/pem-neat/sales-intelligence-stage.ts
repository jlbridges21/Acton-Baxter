/**
 * Stage B — Sales Intelligence synthesis contract.
 * Simple business synthesis (Fact Ledger owns provenance).
 * Mapped into canonical PemNeatStructuredResult.salesIntelligence in code.
 */
import { z } from "zod";
import {
  MEETING_OUTCOMES,
  QUALIFICATION_LEVELS,
  type MeetingOutcome,
  type QualificationLevel,
} from "./constants";
import type { PemNeatStructuredResult } from "./schemas";

/** Generation contract version (SI synthesis shape, structured outputs). */
export const PEM_NEAT_GENERATION_SCHEMA_VERSION = 2;
/** Fact Ledger evidence shape version — bump only when FL contract breaks resume. */
export const PEM_NEAT_FACT_LEDGER_SCHEMA_VERSION = 1;

const nullableNumber = z.preprocess((value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}, z.number().nullable());

const stringList = z.preprocess((value) => {
  if (value == null) return [];
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const v = o.summary ?? o.value ?? o.text ?? o.statement ?? o.name;
        return typeof v === "string" ? v.trim() : v != null ? String(v) : "";
      }
      return "";
    })
    .filter(Boolean);
}, z.array(z.string()));

const fitSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return "not_enough_information";
    const v = value.trim().toLowerCase().replace(/\s+/g, "_");
    if (
      v === "strong_fit" ||
      v === "potential_fit" ||
      v === "weak_fit" ||
      v === "not_enough_information"
    ) {
      return v;
    }
    if (v.includes("strong")) return "strong_fit";
    if (v.includes("weak") || v.includes("poor")) return "weak_fit";
    if (v.includes("potential") || v.includes("good") || v.includes("fit")) return "potential_fit";
    return "not_enough_information";
  },
  z.enum(["strong_fit", "potential_fit", "weak_fit", "not_enough_information"]),
);

const outcomeSchema = z.preprocess((value) => {
  if (typeof value !== "string") return "DECISION_DATE_NOT_SECURED";
  const v = value.trim().toUpperCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if ((MEETING_OUTCOMES as readonly string[]).includes(v)) return v;
  if (v.includes("NOT") && v.includes("SECURE")) return "DECISION_DATE_NOT_SECURED";
  if (v.includes("DECISION")) return "DECISION_DATE";
  if (v.includes("NO")) return "NO";
  if (v.includes("YES")) return "YES";
  if (v.includes("INCOMPLETE") || v.includes("UNKNOWN")) return "DECISION_DATE_NOT_SECURED";
  return "DECISION_DATE_NOT_SECURED";
}, z.enum(MEETING_OUTCOMES));

const qualificationSchema = z.preprocess((value) => {
  if (typeof value !== "string") return "EARLY_EXPLORATORY";
  const v = value.trim().toUpperCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if ((QUALIFICATION_LEVELS as readonly string[]).includes(v)) return v;
  if (v.includes("DISQUAL")) return "DISQUALIFIED";
  if (v.includes("STRONG")) return "STRONGLY_QUALIFIED";
  if (v.includes("WEAK")) return "WEAKLY_QUALIFIED";
  if (v.includes("RISK")) return "QUALIFIED_WITH_RISKS";
  return "EARLY_EXPLORATORY";
}, z.enum(QUALIFICATION_LEVELS));

/** Simple stage output — what GPT-5.4 must return. */
export const salesIntelligenceStageSchema = z.object({
  customerStory: z.string().min(1),
  customerPain: z.string().min(1),
  type1Pain: z.object({
    summary: z.string().min(1),
    drivers: stringList.default([]),
  }),
  type2Pain: z.object({
    summary: z.string().min(1),
    drivers: stringList.default([]),
  }),
  budget: z.object({
    summary: z.string().min(1),
    statedTarget: nullableNumber.default(null),
    availableFunds: nullableNumber.default(null),
    potentialCeiling: nullableNumber.default(null),
    aduAllocation: nullableNumber.default(null),
    poolAllocation: nullableNumber.default(null),
    fundingSummary: z.string().nullable().default(null),
    flexibility: z.string().nullable().default(null),
    risks: stringList.default([]),
  }),
  decisionProcess: z.object({
    summary: z.string().min(1),
    primaryDecisionMaker: z.string().nullable().default(null),
    otherParticipants: stringList.default([]),
    gatingFactors: stringList.default([]),
    alternatives: stringList.default([]),
    criteria: stringList.default([]),
    timing: z.string().nullable().default(null),
  }),
  schedule: z.object({
    summary: z.string().min(1),
    urgency: z.string().nullable().default(null),
    dates: stringList.default([]),
    drivers: stringList.default([]),
  }),
  competitionAlternatives: stringList.default([]),
  actonRecommendation: z.object({
    fit: fitSchema,
    summary: z.string().min(1),
    reasons: stringList.default([]),
  }),
  nextSteps: z.object({
    prospect: stringList.default([]),
    acton: stringList.default([]),
  }),
  meetingOutcome: z.object({
    classification: outcomeSchema,
    explanation: z.string().min(1),
    transcriptIncomplete: z.boolean().optional().default(false),
  }),
  qualification: z.object({
    classification: qualificationSchema,
    explanation: z.string().min(1),
    risks: stringList.default([]),
  }),
});

export type SalesIntelligenceStageOutput = z.infer<typeof salesIntelligenceStageSchema>;

/** JSON Schema for Responses API structured outputs (strict). */
export const SALES_INTELLIGENCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "customerStory",
    "customerPain",
    "type1Pain",
    "type2Pain",
    "budget",
    "decisionProcess",
    "schedule",
    "competitionAlternatives",
    "actonRecommendation",
    "nextSteps",
    "meetingOutcome",
    "qualification",
  ],
  properties: {
    customerStory: { type: "string" },
    customerPain: { type: "string" },
    type1Pain: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "drivers"],
      properties: {
        summary: { type: "string" },
        drivers: { type: "array", items: { type: "string" } },
      },
    },
    type2Pain: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "drivers"],
      properties: {
        summary: { type: "string" },
        drivers: { type: "array", items: { type: "string" } },
      },
    },
    budget: {
      type: "object",
      additionalProperties: false,
      required: [
        "summary",
        "statedTarget",
        "availableFunds",
        "potentialCeiling",
        "aduAllocation",
        "poolAllocation",
        "fundingSummary",
        "flexibility",
        "risks",
      ],
      properties: {
        summary: { type: "string" },
        statedTarget: { type: ["number", "null"] },
        availableFunds: { type: ["number", "null"] },
        potentialCeiling: { type: ["number", "null"] },
        aduAllocation: { type: ["number", "null"] },
        poolAllocation: { type: ["number", "null"] },
        fundingSummary: { type: ["string", "null"] },
        flexibility: { type: ["string", "null"] },
        risks: { type: "array", items: { type: "string" } },
      },
    },
    decisionProcess: {
      type: "object",
      additionalProperties: false,
      required: [
        "summary",
        "primaryDecisionMaker",
        "otherParticipants",
        "gatingFactors",
        "alternatives",
        "criteria",
        "timing",
      ],
      properties: {
        summary: { type: "string" },
        primaryDecisionMaker: { type: ["string", "null"] },
        otherParticipants: { type: "array", items: { type: "string" } },
        gatingFactors: { type: "array", items: { type: "string" } },
        alternatives: { type: "array", items: { type: "string" } },
        criteria: { type: "array", items: { type: "string" } },
        timing: { type: ["string", "null"] },
      },
    },
    schedule: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "urgency", "dates", "drivers"],
      properties: {
        summary: { type: "string" },
        urgency: { type: ["string", "null"] },
        dates: { type: "array", items: { type: "string" } },
        drivers: { type: "array", items: { type: "string" } },
      },
    },
    competitionAlternatives: { type: "array", items: { type: "string" } },
    actonRecommendation: {
      type: "object",
      additionalProperties: false,
      required: ["fit", "summary", "reasons"],
      properties: {
        fit: {
          type: "string",
          enum: ["strong_fit", "potential_fit", "weak_fit", "not_enough_information"],
        },
        summary: { type: "string" },
        reasons: { type: "array", items: { type: "string" } },
      },
    },
    nextSteps: {
      type: "object",
      additionalProperties: false,
      required: ["prospect", "acton"],
      properties: {
        prospect: { type: "array", items: { type: "string" } },
        acton: { type: "array", items: { type: "string" } },
      },
    },
    meetingOutcome: {
      type: "object",
      additionalProperties: false,
      required: ["classification", "explanation", "transcriptIncomplete"],
      properties: {
        classification: {
          type: "string",
          enum: [...MEETING_OUTCOMES],
        },
        explanation: { type: "string" },
        transcriptIncomplete: { type: "boolean" },
      },
    },
    qualification: {
      type: "object",
      additionalProperties: false,
      required: ["classification", "explanation", "risks"],
      properties: {
        classification: {
          type: "string",
          enum: [...QUALIFICATION_LEVELS],
        },
        explanation: { type: "string" },
        risks: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

function moneyLabel(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function toPainItems(summary: string, drivers: string[]) {
  if (drivers.length === 0) {
    return [
      {
        statement: summary,
        evidenceType: "prospect_fact" as const,
        confidence: "medium" as const,
      },
    ];
  }
  return drivers.map((d) => ({
    statement: d,
    deeperConsequence: summary,
    evidenceType: "prospect_fact" as const,
    confidence: "medium" as const,
  }));
}

/** Format-only unwrap: accept { salesIntelligence: {...} } or bare object. */
export function unwrapSalesIntelligenceRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  if (o.salesIntelligence && typeof o.salesIntelligence === "object") {
    return o.salesIntelligence;
  }
  return raw;
}

/** Safe shape diagnostics — paths + JS types only, no values/PII. */
export function describeSalesIntelligenceShape(raw: unknown): string[] {
  const root = unwrapSalesIntelligenceRaw(raw);
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return [`root: ${raw == null ? "null" : Array.isArray(raw) ? "array" : typeof raw}`];
  }
  const lines: string[] = [];
  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 4) return;
    const t = value == null ? "null" : Array.isArray(value) ? "array" : typeof value;
    lines.push(`${path} — ${t}`);
    if (value && typeof value === "object" && !Array.isArray(value) && depth < 3) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
        walk(v, `${path}.${k}`, depth + 1);
      }
    } else if (Array.isArray(value) && value.length > 0) {
      walk(value[0], `${path}[0]`, depth + 1);
    }
  };
  walk(root, "salesIntelligence", 0);
  return lines.slice(0, 40);
}

export function zodIssuesToSafePaths(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((i) => {
    const path = i.path.length ? i.path.join(".") : "root";
    return `${path} — ${i.message}`;
  });
}

export function parseSalesIntelligenceStage(raw: unknown):
  | {
      ok: true;
      data: SalesIntelligenceStageOutput;
    }
  | {
      ok: false;
      issues: string[];
      shape: string[];
    } {
  const unwrapped = unwrapSalesIntelligenceRaw(raw);
  const parsed = salesIntelligenceStageSchema.safeParse(unwrapped);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: zodIssuesToSafePaths(parsed.error),
    shape: describeSalesIntelligenceShape(raw),
  };
}

/** Map simple stage output → canonical NEAT salesIntelligence. */
export function mapSalesIntelligenceStageToCanonical(
  stage: SalesIntelligenceStageOutput,
): PemNeatStructuredResult["salesIntelligence"] {
  const available = moneyLabel(stage.budget.availableFunds);
  const target = moneyLabel(stage.budget.statedTarget);
  const ceiling = moneyLabel(stage.budget.potentialCeiling);
  const adu = moneyLabel(stage.budget.aduAllocation);
  const pool = moneyLabel(stage.budget.poolAllocation);

  const rangeParts = [adu && `ADU ~${adu}`, pool && `pool ~${pool}`].filter(Boolean);
  const decisionMakers = [
    stage.decisionProcess.primaryDecisionMaker
      ? {
          value: stage.decisionProcess.primaryDecisionMaker,
          evidenceType: "prospect_fact" as const,
          confidence: "high" as const,
        }
      : null,
    ...stage.decisionProcess.otherParticipants.map((p) => ({
      value: p,
      evidenceType: "prospect_fact" as const,
      confidence: "medium" as const,
    })),
  ].filter(
    Boolean,
  ) as PemNeatStructuredResult["salesIntelligence"]["decisionProcess"]["decisionMakers"];

  return {
    customerStory: stage.customerStory,
    customerPain: stage.customerPain,
    type1Pain: toPainItems(stage.type1Pain.summary, stage.type1Pain.drivers),
    type2Pain: toPainItems(stage.type2Pain.summary, stage.type2Pain.drivers),
    budget: {
      summary: stage.budget.summary,
      range: rangeParts.length ? rangeParts.join("; ") : null,
      statedBudget: available
        ? { value: available, evidenceType: "prospect_fact", confidence: "high" }
        : null,
      target: target
        ? { value: target, evidenceType: "prospect_fact", confidence: "medium" }
        : null,
      hardCeiling: ceiling
        ? {
            value: ceiling,
            evidenceType: "prospect_fact",
            evidence: "Psychological / discomfort threshold — not necessarily a hard stop.",
            confidence: "medium",
          }
        : null,
      scope:
        [adu && `ADU allocation ${adu}`, pool && `Pool allocation ${pool}`]
          .filter(Boolean)
          .join(". ") || null,
      fundingSource: stage.budget.fundingSummary,
      firmness: stage.budget.flexibility,
      competitorAnchors: [],
      advisorEstimates: [],
      risks: stage.budget.risks,
      unknowns: [],
    },
    decisionProcess: {
      summary: stage.decisionProcess.summary,
      process: stage.decisionProcess.summary,
      decisionMakers,
      absentStakeholders: [],
      financialApprovers: [],
      designDecisionMakers: [],
      criteria: stage.decisionProcess.criteria,
      alternatives: [
        ...stage.decisionProcess.alternatives,
        ...stage.competitionAlternatives,
      ].filter((v, i, a) => a.indexOf(v) === i),
      timing: stage.decisionProcess.timing
        ? {
            value: stage.decisionProcess.timing,
            evidenceType: "prospect_fact",
            confidence: "medium",
          }
        : null,
      missingInformation: stage.decisionProcess.gatingFactors,
    },
    schedule: {
      summary: stage.schedule.summary,
      drivers: stage.schedule.drivers,
      dependencies: stage.schedule.dates,
      desiredStart: stage.schedule.dates[0]
        ? {
            value: stage.schedule.dates[0]!,
            evidenceType: "prospect_fact" as const,
            confidence: "medium" as const,
          }
        : null,
      desiredCompletion: null,
      decisionTiming: stage.decisionProcess.timing
        ? {
            value: stage.decisionProcess.timing,
            evidenceType: "prospect_fact" as const,
            confidence: "medium" as const,
          }
        : null,
      flexibility: stage.schedule.urgency ?? stage.schedule.summary,
    },
    competitionAlternatives: stage.competitionAlternatives,
    actonRecommendation: {
      fit: `${stage.actonRecommendation.fit}: ${stage.actonRecommendation.summary}`,
      reasoning: stage.actonRecommendation.reasons.join("; ") || stage.actonRecommendation.summary,
    },
    nextSteps: {
      prospect: stage.nextSteps.prospect,
      acton: stage.nextSteps.acton,
    },
    meetingOutcome: {
      classification: stage.meetingOutcome.classification as MeetingOutcome,
      explanation: stage.meetingOutcome.transcriptIncomplete
        ? `${stage.meetingOutcome.explanation} (Transcript appears incomplete — ending not fully observed.)`
        : stage.meetingOutcome.explanation,
    },
    qualification: {
      classification: stage.qualification.classification as QualificationLevel,
      reasoning: stage.qualification.explanation,
      risks: stage.qualification.risks,
    },
  };
}

/** Extract numeric budget candidates from Fact Ledger for the SI prompt. */
export function extractBudgetCandidatesFromLedger(ledger: {
  budget?: Array<{ summary?: string; amount?: string | null }>;
}): string[] {
  const out: string[] = [];
  for (const item of ledger.budget ?? []) {
    const amount = item.amount?.trim();
    const summary = item.summary?.trim();
    if (amount && summary) out.push(`${amount}: ${summary}`);
    else if (summary) out.push(summary);
    else if (amount) out.push(amount);
  }
  return out.slice(0, 20);
}

export function factLedgerSemanticCounts(ledger: {
  customerContext?: unknown[];
  motivation?: unknown[];
  partnerConcerns?: unknown[];
  budget?: unknown[];
  decision?: unknown[];
  project?: unknown[];
  commitments?: unknown[];
  nextSteps?: unknown[];
  schedule?: unknown[];
  pemProcessEvidence?: unknown[];
}) {
  return {
    customerContextCount: ledger.customerContext?.length ?? 0,
    motivationCount: ledger.motivation?.length ?? 0,
    partnerConcernCount: ledger.partnerConcerns?.length ?? 0,
    budgetMentionCount: ledger.budget?.length ?? 0,
    decisionFactCount: ledger.decision?.length ?? 0,
    projectFactCount: ledger.project?.length ?? 0,
    commitmentCount: ledger.commitments?.length ?? 0,
    nextStepCount: ledger.nextSteps?.length ?? 0,
    scheduleCount: ledger.schedule?.length ?? 0,
    pemProcessCount: ledger.pemProcessEvidence?.length ?? 0,
  };
}
