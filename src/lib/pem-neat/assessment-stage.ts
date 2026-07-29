/**
 * Stage C — Sales Assessment contract.
 * Code owns the 12 categories + PALO structure; model fills scores/evidence.
 * Mapped into canonical PemNeatStructuredResult.assessment in code.
 */
import { z } from "zod";
import {
  ASSESSMENT_CATEGORY_KEYS,
  ASSESSMENT_CATEGORY_LABELS,
  ASSESSMENT_STATUSES,
  MEETING_OUTCOMES,
  QUALIFICATION_LEVELS,
  type AssessmentCategoryKey,
  type AssessmentStatus,
  type MeetingOutcome,
  type QualificationLevel,
} from "./constants";
import type { PemNeatStructuredResult } from "./schemas";

export const PEM_NEAT_ASSESSMENT_SCHEMA_VERSION = 1;

/** Score 1–10 or null. Accepts "8", "8/10", NOT DETERMINABLE → null. */
const scoreSchema = z.preprocess((value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(Math.min(10, Math.max(1, value)));
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    if (/not[\s_-]*determinable|n\/?a|unknown|insufficient/i.test(t)) return null;
    const slash = t.match(/^(\d{1,2})\s*\/\s*10$/i);
    if (slash) {
      const n = Number(slash[1]);
      return Number.isFinite(n) ? Math.round(Math.min(10, Math.max(1, n))) : null;
    }
    const cleaned = t.replace(/[^0-9.-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(Math.min(10, Math.max(1, n))) : null;
  }
  return null;
}, z.number().int().min(1).max(10).nullable());

const statusSchema = z.preprocess((value) => {
  if (typeof value !== "string") return "NOT_DETERMINABLE";
  const v = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if ((ASSESSMENT_STATUSES as readonly string[]).includes(v)) return v;
  if (v.includes("NOT") && v.includes("DETERM")) return "NOT_DETERMINABLE";
  if (v === "N_A" || v === "NA" || v === "N/A") return "N_A";
  if (v.includes("MISS") || v.includes("WEAK") || v.includes("POOR")) return "MISSED";
  if (v.includes("PARTIAL") || v.includes("ACCEPTABLE")) return "PARTIAL";
  if (
    v.includes("COMPLETE") ||
    v.includes("STRONG") ||
    v.includes("GOOD") ||
    v.includes("EXCELLENT")
  ) {
    return "COMPLETED";
  }
  return "NOT_DETERMINABLE";
}, z.enum(ASSESSMENT_STATUSES));

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
        const v = o.text ?? o.value ?? o.summary ?? o.statement ?? o.explanation;
        return typeof v === "string" ? v.trim() : v != null ? String(v) : "";
      }
      return "";
    })
    .filter(Boolean);
}, z.array(z.string()));

const explanationSchema = z.preprocess((value) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v : String(v)))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const v = o.text ?? o.value ?? o.summary;
    return typeof v === "string" ? v : v != null ? String(v) : "";
  }
  return String(value);
}, z.string());

const categoryStageSchema = z.object({
  score: scoreSchema.default(null),
  status: statusSchema.default("NOT_DETERMINABLE"),
  explanation: explanationSchema.default(""),
  evidence: stringList.default([]),
  whatWorked: stringList.default([]),
  coachingOpportunities: stringList.default([]),
});

const paloElementSchema = z.object({
  score: scoreSchema.default(null),
  status: statusSchema.default("NOT_DETERMINABLE"),
  explanation: explanationSchema.default(""),
  evidence: stringList.default([]),
});

const categoriesObjectSchema = z.object({
  bonding_rapport: categoryStageSchema,
  palo_upfront_contract: categoryStageSchema,
  type1_pain: categoryStageSchema,
  type2_pain: categoryStageSchema,
  budget: categoryStageSchema,
  decision_making_process: categoryStageSchema,
  schedule: categoryStageSchema,
  summary: categoryStageSchema,
  fulfillment_solution_positioning: categoryStageSchema,
  outcome_close: categoryStageSchema,
  post_sell: categoryStageSchema,
  overall_process_control: categoryStageSchema,
});

const outcomeSchema = z.preprocess((value) => {
  if (typeof value !== "string") return "DECISION_DATE_NOT_SECURED";
  const v = value.trim().toUpperCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if ((MEETING_OUTCOMES as readonly string[]).includes(v)) return v;
  return "DECISION_DATE_NOT_SECURED";
}, z.enum(MEETING_OUTCOMES));

const qualificationSchema = z.preprocess((value) => {
  if (typeof value !== "string") return "EARLY_EXPLORATORY";
  const v = value.trim().toUpperCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if ((QUALIFICATION_LEVELS as readonly string[]).includes(v)) return v;
  return "EARLY_EXPLORATORY";
}, z.enum(QUALIFICATION_LEVELS));

export const assessmentStageSchema = z.object({
  categories: categoriesObjectSchema,
  palo: z.object({
    purpose: paloElementSchema,
    agenda: paloElementSchema,
    logistics: paloElementSchema,
    outcome: paloElementSchema,
  }),
  topStrengths: stringList.default([]),
  topImprovements: stringList.default([]),
  oneThing: z.string().min(1),
  meetingOutcome: z
    .object({
      classification: outcomeSchema,
      explanation: z.string().min(1),
      transcriptIncomplete: z.boolean().optional().default(false),
    })
    .optional(),
  qualification: z
    .object({
      classification: qualificationSchema,
      explanation: z.string().min(1),
      risks: stringList.default([]),
    })
    .optional(),
});

export type AssessmentStageOutput = z.infer<typeof assessmentStageSchema>;
export type AssessmentStageCategory = z.infer<typeof categoryStageSchema>;

const categoryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "status", "explanation", "evidence", "whatWorked", "coachingOpportunities"],
  properties: {
    score: { type: ["number", "null"], minimum: 1, maximum: 10 },
    status: { type: "string", enum: [...ASSESSMENT_STATUSES] },
    explanation: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    whatWorked: { type: "array", items: { type: "string" } },
    coachingOpportunities: { type: "array", items: { type: "string" } },
  },
} as const;

const paloElementJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "status", "explanation", "evidence"],
  properties: {
    score: { type: ["number", "null"], minimum: 1, maximum: 10 },
    status: { type: "string", enum: [...ASSESSMENT_STATUSES] },
    explanation: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
  },
} as const;

/** JSON Schema for Responses API structured outputs (strict). */
export const ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["categories", "palo", "topStrengths", "topImprovements", "oneThing"],
  properties: {
    categories: {
      type: "object",
      additionalProperties: false,
      required: [...ASSESSMENT_CATEGORY_KEYS],
      properties: Object.fromEntries(ASSESSMENT_CATEGORY_KEYS.map((k) => [k, categoryJsonSchema])),
    },
    palo: {
      type: "object",
      additionalProperties: false,
      required: ["purpose", "agenda", "logistics", "outcome"],
      properties: {
        purpose: paloElementJsonSchema,
        agenda: paloElementJsonSchema,
        logistics: paloElementJsonSchema,
        outcome: paloElementJsonSchema,
      },
    },
    topStrengths: { type: "array", items: { type: "string" } },
    topImprovements: { type: "array", items: { type: "string" } },
    oneThing: { type: "string" },
  },
} as const;

function joinList(items: string[]): string | null {
  const cleaned = items.map((s) => s.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(" ") : null;
}

function normalizeCategoryKey(raw: string): AssessmentCategoryKey | null {
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/[\s/&]+/g, "_")
    .replace(/_+/g, "_");
  if ((ASSESSMENT_CATEGORY_KEYS as readonly string[]).includes(v)) {
    return v as AssessmentCategoryKey;
  }
  const aliases: Record<string, AssessmentCategoryKey> = {
    bonding: "bonding_rapport",
    rapport: "bonding_rapport",
    bonding_and_rapport: "bonding_rapport",
    palo: "palo_upfront_contract",
    upfront_contract: "palo_upfront_contract",
    up_front_contract: "palo_upfront_contract",
    type_1_pain: "type1_pain",
    type_1: "type1_pain",
    type_2_pain: "type2_pain",
    type_2: "type2_pain",
    decision: "decision_making_process",
    decision_process: "decision_making_process",
    decision_making: "decision_making_process",
    fulfillment: "fulfillment_solution_positioning",
    solution_positioning: "fulfillment_solution_positioning",
    outcome: "outcome_close",
    close: "outcome_close",
    postsell: "post_sell",
    process_control: "overall_process_control",
    overall_process: "overall_process_control",
  };
  return aliases[v] ?? null;
}

/** Normalize common GPT shape drift before Zod (array categories → object, etc.). */
export function normalizeAssessmentRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const root = { ...(raw as Record<string, unknown>) };

  if (root.assessment && typeof root.assessment === "object" && !Array.isArray(root.assessment)) {
    Object.assign(root, root.assessment as Record<string, unknown>);
  }

  if (Array.isArray(root.categories)) {
    const keyed: Record<string, unknown> = {};
    for (const item of root.categories) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      const keyRaw = String(o.key ?? o.id ?? o.name ?? o.label ?? "").trim();
      const key = normalizeCategoryKey(keyRaw);
      if (!key) continue;
      keyed[key] = {
        score: o.score ?? null,
        status: o.status ?? "NOT_DETERMINABLE",
        explanation:
          typeof o.explanation === "string"
            ? o.explanation
            : typeof o.evidence === "string"
              ? o.evidence
              : "",
        evidence: o.evidence ?? [],
        whatWorked: o.whatWorked ?? [],
        coachingOpportunities: o.coachingOpportunities ?? o.coachingOpportunity ?? o.coaching ?? [],
      };
    }
    for (const k of ASSESSMENT_CATEGORY_KEYS) {
      if (!keyed[k]) {
        keyed[k] = {
          score: null,
          status: "NOT_DETERMINABLE",
          explanation: "Not enough observable transcript evidence for this category.",
          evidence: [],
          whatWorked: [],
          coachingOpportunities: [],
        };
      }
    }
    root.categories = keyed;
  }

  if (root.categories && typeof root.categories === "object" && !Array.isArray(root.categories)) {
    const cats = { ...(root.categories as Record<string, unknown>) };
    for (const k of ASSESSMENT_CATEGORY_KEYS) {
      if (!cats[k] || typeof cats[k] !== "object") {
        cats[k] = {
          score: null,
          status: "NOT_DETERMINABLE",
          explanation: "Not enough observable transcript evidence for this category.",
          evidence: [],
          whatWorked: [],
          coachingOpportunities: [],
        };
      }
    }
    root.categories = cats;
  }

  if (!root.palo || typeof root.palo !== "object") {
    const emptyPalo = {
      score: null,
      status: "NOT_DETERMINABLE",
      explanation: "",
      evidence: [],
    };
    root.palo = {
      purpose: emptyPalo,
      agenda: emptyPalo,
      logistics: emptyPalo,
      outcome: emptyPalo,
    };
  }

  if (typeof root.oneThing !== "string" || !root.oneThing.trim()) {
    root.oneThing =
      typeof root.oneThing === "object" && root.oneThing
        ? String(
            (root.oneThing as { text?: string; value?: string }).text ??
              (root.oneThing as { value?: string }).value ??
              "Tighten discovery follow-through on the next PEM.",
          )
        : "Tighten discovery follow-through on the next PEM.";
  }

  return root;
}

export function describeAssessmentShape(raw: unknown): string[] {
  const root = normalizeAssessmentRaw(raw);
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return [`root: ${raw == null ? "null" : Array.isArray(raw) ? "array" : typeof raw}`];
  }
  const lines: string[] = [];
  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 4) return;
    const t = value == null ? "null" : Array.isArray(value) ? "array" : typeof value;
    lines.push(`${path} — ${t}`);
    if (value && typeof value === "object" && !Array.isArray(value) && depth < 3) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 24)) {
        walk(v, `${path}.${k}`, depth + 1);
      }
    } else if (Array.isArray(value) && value.length > 0) {
      walk(value[0], `${path}[0]`, depth + 1);
    }
  };
  walk(root, "assessment", 0);
  return lines.slice(0, 50);
}

export function assessmentZodIssuesToSafePaths(error: z.ZodError): string[] {
  return error.issues.slice(0, 25).map((i) => {
    const path = i.path.length ? i.path.join(".") : "root";
    return `${path} — ${i.message}`;
  });
}

export function parseAssessmentStage(
  raw: unknown,
): { ok: true; data: AssessmentStageOutput } | { ok: false; issues: string[]; shape: string[] } {
  const normalized = normalizeAssessmentRaw(raw);
  const parsed = assessmentStageSchema.safeParse(normalized);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: assessmentZodIssuesToSafePaths(parsed.error),
    shape: describeAssessmentShape(raw),
  };
}

function mapCategory(
  key: AssessmentCategoryKey,
  cat: AssessmentStageCategory,
): PemNeatStructuredResult["assessment"]["categories"][number] {
  let score = cat.score;
  let status = cat.status as AssessmentStatus;
  if (status === "NOT_DETERMINABLE" || status === "N_A") {
    score = null;
  } else if (score == null) {
    status = "NOT_DETERMINABLE";
  }
  return {
    key,
    label: ASSESSMENT_CATEGORY_LABELS[key],
    score,
    status,
    evidence: joinList(cat.evidence) ?? (cat.explanation || null),
    whatWorked: joinList(cat.whatWorked),
    coachingOpportunity: joinList(cat.coachingOpportunities),
    timestamps: [],
  };
}

/** Map stage output → canonical NEAT assessment (+ optional outcome/qual updates). */
export function mapAssessmentStageToCanonical(stage: AssessmentStageOutput): {
  assessment: PemNeatStructuredResult["assessment"];
  meetingOutcome?: PemNeatStructuredResult["salesIntelligence"]["meetingOutcome"];
  qualification?: PemNeatStructuredResult["salesIntelligence"]["qualification"];
} {
  const categories = ASSESSMENT_CATEGORY_KEYS.map((key) => {
    const mapped = mapCategory(key, stage.categories[key]);
    if (key === "palo_upfront_contract") {
      mapped.palo = {
        purpose: {
          status: stage.palo.purpose.status as AssessmentStatus,
          evidence:
            joinList(stage.palo.purpose.evidence) ?? (stage.palo.purpose.explanation || null),
          notes: stage.palo.purpose.explanation || null,
        },
        agenda: {
          status: stage.palo.agenda.status as AssessmentStatus,
          evidence: joinList(stage.palo.agenda.evidence) ?? (stage.palo.agenda.explanation || null),
          notes: stage.palo.agenda.explanation || null,
        },
        logistics: {
          status: stage.palo.logistics.status as AssessmentStatus,
          evidence:
            joinList(stage.palo.logistics.evidence) ?? (stage.palo.logistics.explanation || null),
          notes: stage.palo.logistics.explanation || null,
        },
        outcome: {
          status: stage.palo.outcome.status as AssessmentStatus,
          evidence:
            joinList(stage.palo.outcome.evidence) ?? (stage.palo.outcome.explanation || null),
          notes: stage.palo.outcome.explanation || null,
        },
      };
    }
    return mapped;
  });

  return {
    assessment: {
      categories,
      topStrengths: stage.topStrengths.slice(0, 3),
      topImprovements: stage.topImprovements.slice(0, 3),
      oneThing: stage.oneThing.trim(),
    },
    meetingOutcome: stage.meetingOutcome
      ? {
          classification: stage.meetingOutcome.classification as MeetingOutcome,
          explanation: stage.meetingOutcome.transcriptIncomplete
            ? `${stage.meetingOutcome.explanation} (Transcript appears incomplete — ending not fully observed.)`
            : stage.meetingOutcome.explanation,
        }
      : undefined,
    qualification: stage.qualification
      ? {
          classification: stage.qualification.classification as QualificationLevel,
          reasoning: stage.qualification.explanation,
          risks: stage.qualification.risks,
        }
      : undefined,
  };
}

/** Diagnose legacy GPT assessment shapes that broke the old Zod array contract. */
export function diagnoseLegacyAssessmentShape(raw: unknown): string[] {
  const issues: string[] = [];
  if (!raw || typeof raw !== "object") {
    issues.push(`root — expected object, received ${raw == null ? "null" : typeof raw}`);
    return issues;
  }
  const o = raw as Record<string, unknown>;
  const assessment =
    o.assessment && typeof o.assessment === "object"
      ? (o.assessment as Record<string, unknown>)
      : o;
  const cats = assessment.categories;
  if (cats == null) issues.push("categories — missing");
  else if (Array.isArray(cats)) {
    issues.push("categories — Expected keyed object, received array");
    if (cats[0] && typeof cats[0] === "object") {
      const c0 = cats[0] as Record<string, unknown>;
      if (c0.key == null) issues.push("categories[0].key — Expected enum key, received undefined");
      if (typeof c0.score === "string") {
        issues.push("categories[0].score — Expected number|null, received string");
      }
      if (Array.isArray(c0.evidence)) {
        issues.push("categories[0].evidence — Expected string, received array");
      }
      if (typeof c0.coachingOpportunity === "object") {
        issues.push("categories[0].coachingOpportunity — Expected string, received object");
      }
    }
  } else if (typeof cats !== "object") {
    issues.push(`categories — Expected object|array, received ${typeof cats}`);
  }
  if (assessment.topStrengths && !Array.isArray(assessment.topStrengths)) {
    issues.push("topStrengths — Expected array, received object");
  }
  if (assessment.oneThing && typeof assessment.oneThing === "object") {
    issues.push("oneThing — Expected string, received object");
  }
  return issues;
}
