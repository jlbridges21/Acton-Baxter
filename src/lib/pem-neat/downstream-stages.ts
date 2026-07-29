/**
 * Downstream stage contracts: Email, Handoff (incl. BuilderTrend), Quality Review.
 * Code owns keys; model fills values. Structured Outputs + Zod.
 */
import { z } from "zod";
import {
  BED_BATH_COUNTS,
  CUSTOMER_PRIORITIES,
  PREFERRED_CONTACT_METHODS,
  PROJECT_FACT_STATUSES,
  PROJECT_TYPES,
} from "./constants";
import { mergeBuildertrendFields } from "./defaults";
import type { PemNeatStructuredResult } from "./schemas";
import { buildertrendFieldsSchema, projectIntelligenceSchema } from "./schemas";

export const PEM_NEAT_EMAIL_SCHEMA_VERSION = 1;
export const PEM_NEAT_HANDOFF_SCHEMA_VERSION = 1;
export const PEM_NEAT_QUALITY_REVIEW_SCHEMA_VERSION = 1;

const nullableString = z.preprocess((value) => {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t.length ? t : null;
  }
  return String(value);
}, z.string().nullable());

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
  return value.map((v) => (typeof v === "string" ? v.trim() : String(v))).filter(Boolean);
}, z.array(z.string()));

// -------- Email --------

export const emailStageSchema = z.object({
  subject: nullableString.default(null),
  body: z.string().min(1),
});

export type EmailStageOutput = z.infer<typeof emailStageSchema>;

export const EMAIL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: ["string", "null"] },
    body: { type: "string" },
  },
} as const;

export function parseEmailStage(
  raw: unknown,
): { ok: true; data: EmailStageOutput } | { ok: false; issues: string[] } {
  let value = raw;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (o.followUpEmail && typeof o.followUpEmail === "object") {
      value = o.followUpEmail;
    }
  }
  const parsed = emailStageSchema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues
      .slice(0, 15)
      .map((i) => `${i.path.join(".") || "root"} — ${i.message}`),
  };
}

// -------- Handoff / BuilderTrend --------

const prioritySchema = z.preprocess(
  (value) => {
    if (!Array.isArray(value)) {
      if (typeof value === "string" && value.trim()) return [value.trim()];
      return [];
    }
    return value
      .map((v) => String(v).trim())
      .filter((v) => (CUSTOMER_PRIORITIES as readonly string[]).includes(v));
  },
  z.array(z.enum(CUSTOMER_PRIORITIES)).default([]),
);

const contactSchema = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if ((PREFERRED_CONTACT_METHODS as readonly string[]).includes(s)) return s;
  // Do not invent multi-method combos
  return null;
}, z.enum(PREFERRED_CONTACT_METHODS).nullable());

const bedBathSchema = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if ((BED_BATH_COUNTS as readonly string[]).includes(s)) return s;
  return null;
}, z.enum(BED_BATH_COUNTS).nullable());

const projectTypeSchema = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if ((PROJECT_TYPES as readonly string[]).includes(s)) return s;
  return null;
}, z.enum(PROJECT_TYPES).nullable());

export const buildertrendStageSchema = z.object({
  notesForInternalUsers: nullableString.default(null),
  squareFeet: nullableNumber.default(null),
  customerBudget: nullableNumber.default(null),
  customerStory: nullableString.default(null),
  customerPain1: nullableString.default(null),
  customerPain: nullableString.default(null),
  customerPriorities: prioritySchema,
  customerPrioritiesOther: nullableString.default(null),
  designHandoff: nullableString.default(null),
  decisionMakingProcess: nullableString.default(null),
  decisionDynamics: nullableString.default(null),
  knownConcernsOrFears: nullableString.default(null),
  mustHaveFeatures: nullableString.default(null),
  siteConstraints: nullableString.default(null),
  soilUtilityNotes: nullableString.default(null),
  levelOfInvolvement: nullableString.default(null),
  internalStrategyNotes: nullableString.default(null),
  projectIntelligence: nullableString.default(null),
  scheduleGoals: nullableString.default(null),
  preferredContactMethod: contactSchema.default(null),
  salesCommitments: nullableString.default(null),
  personalityTraits: nullableString.default(null),
  assumptionsDuringSales: nullableString.default(null),
  scopeClarifications: nullableString.default(null),
  bedBathCount: bedBathSchema.default(null),
  accessibilityRequirement: nullableString.default(null),
  cityZoningFeedback: nullableString.default(null),
  accessConstructionIssue: nullableString.default(null),
  responsivenessExpected: nullableString.default(null),
  nextSteps: nullableString.default(null),
  recommendedBrModels: nullableString.default(null),
  projectType: projectTypeSchema.default(null),
  projectTypeOther: nullableString.default(null),
});

const projectFactStageSchema = z.object({
  topic: z.string().min(1),
  value: nullableString.default(null),
  status: z.preprocess((value) => {
    if (typeof value !== "string") return "UNKNOWN_NEEDS_VERIFICATION";
    const v = value.trim().toUpperCase().replace(/\s+/g, "_");
    if ((PROJECT_FACT_STATUSES as readonly string[]).includes(v)) return v;
    return "UNKNOWN_NEEDS_VERIFICATION";
  }, z.enum(PROJECT_FACT_STATUSES)),
  evidence: nullableString.optional(),
});

export const handoffStageSchema = z.object({
  projectIntelligence: z
    .object({
      facts: z.array(projectFactStageSchema).default([]),
      summary: nullableString.optional(),
    })
    .default(() => ({ facts: [] })),
  buildertrendFields: buildertrendStageSchema,
  internalOpportunityNotes: z.string().default(""),
  productionNotes: stringList.default([]),
});

export type HandoffStageOutput = z.infer<typeof handoffStageSchema>;

const btProps: Record<string, unknown> = {
  notesForInternalUsers: { type: ["string", "null"] },
  squareFeet: { type: ["number", "null"] },
  customerBudget: { type: ["number", "null"] },
  customerStory: { type: ["string", "null"] },
  customerPain1: { type: ["string", "null"] },
  customerPain: { type: ["string", "null"] },
  customerPriorities: {
    type: "array",
    items: { type: "string", enum: [...CUSTOMER_PRIORITIES] },
  },
  customerPrioritiesOther: { type: ["string", "null"] },
  designHandoff: { type: ["string", "null"] },
  decisionMakingProcess: { type: ["string", "null"] },
  decisionDynamics: { type: ["string", "null"] },
  knownConcernsOrFears: { type: ["string", "null"] },
  mustHaveFeatures: { type: ["string", "null"] },
  siteConstraints: { type: ["string", "null"] },
  soilUtilityNotes: { type: ["string", "null"] },
  levelOfInvolvement: { type: ["string", "null"] },
  internalStrategyNotes: { type: ["string", "null"] },
  projectIntelligence: { type: ["string", "null"] },
  scheduleGoals: { type: ["string", "null"] },
  preferredContactMethod: {
    type: ["string", "null"],
  },
  salesCommitments: { type: ["string", "null"] },
  personalityTraits: { type: ["string", "null"] },
  assumptionsDuringSales: { type: ["string", "null"] },
  scopeClarifications: { type: ["string", "null"] },
  bedBathCount: { type: ["string", "null"] },
  accessibilityRequirement: { type: ["string", "null"] },
  cityZoningFeedback: { type: ["string", "null"] },
  accessConstructionIssue: { type: ["string", "null"] },
  responsivenessExpected: { type: ["string", "null"] },
  nextSteps: { type: ["string", "null"] },
  recommendedBrModels: { type: ["string", "null"] },
  projectType: { type: ["string", "null"] },
  projectTypeOther: { type: ["string", "null"] },
};

export const HANDOFF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "projectIntelligence",
    "buildertrendFields",
    "internalOpportunityNotes",
    "productionNotes",
  ],
  properties: {
    projectIntelligence: {
      type: "object",
      additionalProperties: false,
      required: ["facts", "summary"],
      properties: {
        facts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["topic", "value", "status", "evidence"],
            properties: {
              topic: { type: "string" },
              value: { type: ["string", "null"] },
              status: { type: "string", enum: [...PROJECT_FACT_STATUSES] },
              evidence: { type: ["string", "null"] },
            },
          },
        },
        summary: { type: ["string", "null"] },
      },
    },
    buildertrendFields: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(btProps),
      properties: btProps,
    },
    internalOpportunityNotes: { type: "string" },
    productionNotes: { type: "array", items: { type: "string" } },
  },
} as const;

export function parseHandoffStage(
  raw: unknown,
): { ok: true; data: HandoffStageOutput } | { ok: false; issues: string[] } {
  const parsed = handoffStageSchema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, data: parsed.data };
  // Soft salvage: merge BT if present
  try {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const bt = mergeBuildertrendFields((o.buildertrendFields as Record<string, unknown>) ?? {});
    buildertrendFieldsSchema.parse(bt);
    const pi = projectIntelligenceSchema.safeParse(o.projectIntelligence ?? { facts: [] });
    return {
      ok: true,
      data: {
        projectIntelligence: pi.success ? pi.data : { facts: [] },
        buildertrendFields: bt,
        internalOpportunityNotes: String(o.internalOpportunityNotes ?? ""),
        productionNotes: Array.isArray(o.productionNotes) ? o.productionNotes.map(String) : [],
      },
    };
  } catch {
    return {
      ok: false,
      issues: parsed.error.issues
        .slice(0, 20)
        .map((i) => `${i.path.join(".") || "root"} — ${i.message}`),
    };
  }
}

export function applyHandoffStageToShell(
  shell: PemNeatStructuredResult,
  stage: HandoffStageOutput,
) {
  shell.projectIntelligence = {
    facts: stage.projectIntelligence.facts.map((f) => ({
      topic: f.topic,
      value: f.value,
      status: f.status,
      evidence: f.evidence ?? null,
      evidenceType: "unknown" as const,
    })),
    summary: stage.projectIntelligence.summary ?? null,
  };
  shell.buildertrendFields = mergeBuildertrendFields(stage.buildertrendFields);
  shell.internalOpportunityNotes = stage.internalOpportunityNotes.slice(0, 2500);
  shell.productionNotes = stage.productionNotes;
}

// -------- Quality Review --------

export const qualityReviewStageSchema = z.object({
  pass: z.boolean(),
  severity: z.preprocess(
    (value) => {
      if (typeof value !== "string") return "medium";
      const v = value.trim().toLowerCase();
      if (v === "none" || v === "low" || v === "medium" || v === "high") return v;
      return "medium";
    },
    z.enum(["none", "low", "medium", "high"]),
  ),
  issues: z
    .array(
      z.object({
        section: z.string().default("general"),
        type: z.string().default("other"),
        explanation: z.string().default(""),
        suggestedCorrection: z.string().nullable().optional().default(null),
      }),
    )
    .default([]),
});

export type QualityReviewStageOutput = z.infer<typeof qualityReviewStageSchema>;

export const QUALITY_REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pass", "severity", "issues"],
  properties: {
    pass: { type: "boolean" },
    severity: { type: "string", enum: ["none", "low", "medium", "high"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "type", "explanation", "suggestedCorrection"],
        properties: {
          section: { type: "string" },
          type: { type: "string" },
          explanation: { type: "string" },
          suggestedCorrection: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

export function parseQualityReviewStage(
  raw: unknown,
): { ok: true; data: QualityReviewStageOutput } | { ok: false; issues: string[] } {
  const parsed = qualityReviewStageSchema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, data: parsed.data };
  // Soft default — never discard a good NEAT for review shape alone
  return {
    ok: true,
    data: { pass: true, severity: "low", issues: [] },
  };
}
