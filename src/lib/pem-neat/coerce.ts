/**
 * Coerce LLM-shaped values into PEM schema shapes.
 * Models often return strings where evidenced objects are required —
 * that previously poisoned the shell and caused PEM_NEAT_SCHEMA_INVALID.
 */
import { EVIDENCE_TYPES, type EvidenceType } from "./constants";

export type EvidencedValue = {
  value: string | null;
  evidenceType: EvidenceType;
  evidence?: string | null;
  timestamp?: string | null;
  confidence?: "high" | "medium" | "low" | "unknown";
};

function asEvidenceType(raw: unknown): EvidenceType {
  if (typeof raw === "string" && (EVIDENCE_TYPES as readonly string[]).includes(raw)) {
    return raw as EvidenceType;
  }
  return "unknown";
}

function asConfidence(raw: unknown): "high" | "medium" | "low" | "unknown" {
  if (raw === "high" || raw === "medium" || raw === "low" || raw === "unknown") return raw;
  return "medium";
}

/** Convert string | object | null into evidenced value (or null). */
export function coerceEvidencedValue(raw: unknown): EvidencedValue | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return null;
    return {
      value,
      evidenceType: "unknown",
      confidence: "medium",
    };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const valueRaw = o.value ?? o.text ?? o.name ?? o.label;
    const value =
      valueRaw == null
        ? null
        : typeof valueRaw === "string"
          ? valueRaw.trim() || null
          : String(valueRaw);
    if (!value && !o.evidence) return null;
    return {
      value,
      evidenceType: asEvidenceType(o.evidenceType),
      evidence: typeof o.evidence === "string" ? o.evidence : null,
      timestamp: typeof o.timestamp === "string" ? o.timestamp : null,
      confidence: asConfidence(o.confidence),
    };
  }
  return {
    value: String(raw),
    evidenceType: "unknown",
    confidence: "low",
  };
}

export function coerceEvidencedValueList(raw: unknown): EvidencedValue[] {
  if (!Array.isArray(raw)) {
    const one = coerceEvidencedValue(raw);
    return one ? [one] : [];
  }
  return raw.map(coerceEvidencedValue).filter((v): v is EvidencedValue => v != null);
}

export type PainItemCoerced = {
  statement: string;
  surfaceReason?: string | null;
  deeperConsequence?: string | null;
  whyNow?: string | null;
  presentConsequence?: string | null;
  futureConsequence?: string | null;
  importance?: string | null;
  evidence?: string | null;
  evidenceType?: EvidenceType;
  confidence?: "high" | "medium" | "low" | "unknown";
};

export function coercePainItem(raw: unknown): PainItemCoerced | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const statement = raw.trim();
    if (!statement) return null;
    return {
      statement,
      evidenceType: "prospect_fact",
      confidence: "medium",
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const statementRaw = o.statement ?? o.text ?? o.pain ?? o.value;
  const statement =
    typeof statementRaw === "string"
      ? statementRaw.trim()
      : statementRaw != null
        ? String(statementRaw)
        : "";
  if (!statement) return null;
  return {
    statement,
    surfaceReason: typeof o.surfaceReason === "string" ? o.surfaceReason : null,
    deeperConsequence: typeof o.deeperConsequence === "string" ? o.deeperConsequence : null,
    whyNow: typeof o.whyNow === "string" ? o.whyNow : null,
    presentConsequence: typeof o.presentConsequence === "string" ? o.presentConsequence : null,
    futureConsequence: typeof o.futureConsequence === "string" ? o.futureConsequence : null,
    importance: typeof o.importance === "string" ? o.importance : null,
    evidence: typeof o.evidence === "string" ? o.evidence : null,
    evidenceType: asEvidenceType(o.evidenceType ?? "prospect_fact"),
    confidence: asConfidence(o.confidence),
  };
}

export function coercePainList(raw: unknown): PainItemCoerced[] {
  if (!Array.isArray(raw)) {
    const one = coercePainItem(raw);
    return one ? [one] : [];
  }
  return raw.map(coercePainItem).filter((v): v is PainItemCoerced => v != null);
}

export function coerceStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    if (typeof raw === "string" && raw.trim()) return [raw.trim()];
    return [];
  }
  return raw
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const v = o.value ?? o.text ?? o.statement ?? o.name;
        return typeof v === "string" ? v.trim() : v != null ? String(v) : "";
      }
      return "";
    })
    .filter(Boolean);
}

/** Deep-coerce salesIntelligence-shaped objects from models into schema-safe shapes. */
export function coerceSalesIntelligencePartial(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const si = raw as Record<string, unknown>;
  const budgetRaw =
    si.budget && typeof si.budget === "object" && !Array.isArray(si.budget)
      ? (si.budget as Record<string, unknown>)
      : {};
  const decisionRaw =
    si.decisionProcess &&
    typeof si.decisionProcess === "object" &&
    !Array.isArray(si.decisionProcess)
      ? (si.decisionProcess as Record<string, unknown>)
      : {};
  const scheduleRaw =
    si.schedule && typeof si.schedule === "object" && !Array.isArray(si.schedule)
      ? (si.schedule as Record<string, unknown>)
      : {};
  const nextRaw =
    si.nextSteps && typeof si.nextSteps === "object" && !Array.isArray(si.nextSteps)
      ? (si.nextSteps as Record<string, unknown>)
      : {};
  const recRaw =
    si.actonRecommendation &&
    typeof si.actonRecommendation === "object" &&
    !Array.isArray(si.actonRecommendation)
      ? (si.actonRecommendation as Record<string, unknown>)
      : {};

  return {
    ...si,
    customerStory:
      typeof si.customerStory === "string" ? si.customerStory : (si.customerStory ?? null),
    customerPain: typeof si.customerPain === "string" ? si.customerPain : (si.customerPain ?? null),
    type1Pain: coercePainList(si.type1Pain),
    type2Pain: coercePainList(si.type2Pain),
    budget: {
      ...budgetRaw,
      statedBudget: coerceEvidencedValue(budgetRaw.statedBudget),
      target: coerceEvidencedValue(budgetRaw.target),
      hardCeiling: coerceEvidencedValue(budgetRaw.hardCeiling),
      range: typeof budgetRaw.range === "string" ? budgetRaw.range : (budgetRaw.range ?? null),
      scope: typeof budgetRaw.scope === "string" ? budgetRaw.scope : (budgetRaw.scope ?? null),
      fundingSource:
        typeof budgetRaw.fundingSource === "string"
          ? budgetRaw.fundingSource
          : (budgetRaw.fundingSource ?? null),
      firmness:
        typeof budgetRaw.firmness === "string" ? budgetRaw.firmness : (budgetRaw.firmness ?? null),
      summary:
        typeof budgetRaw.summary === "string" ? budgetRaw.summary : (budgetRaw.summary ?? null),
      competitorAnchors: Array.isArray(budgetRaw.competitorAnchors)
        ? budgetRaw.competitorAnchors
        : [],
      advisorEstimates: Array.isArray(budgetRaw.advisorEstimates) ? budgetRaw.advisorEstimates : [],
      risks: coerceStringList(budgetRaw.risks),
      unknowns: coerceStringList(budgetRaw.unknowns),
    },
    decisionProcess: {
      ...decisionRaw,
      decisionMakers: coerceEvidencedValueList(decisionRaw.decisionMakers),
      financialApprovers: coerceEvidencedValueList(decisionRaw.financialApprovers),
      designDecisionMakers: coerceEvidencedValueList(decisionRaw.designDecisionMakers),
      absentStakeholders: coerceStringList(decisionRaw.absentStakeholders),
      criteria: coerceStringList(decisionRaw.criteria),
      alternatives: coerceStringList(decisionRaw.alternatives),
      missingInformation: coerceStringList(decisionRaw.missingInformation),
      process:
        typeof decisionRaw.process === "string"
          ? decisionRaw.process
          : (decisionRaw.process ?? null),
      summary:
        typeof decisionRaw.summary === "string"
          ? decisionRaw.summary
          : (decisionRaw.summary ?? null),
      timing: coerceEvidencedValue(decisionRaw.timing),
    },
    schedule: {
      ...scheduleRaw,
      decisionTiming: coerceEvidencedValue(scheduleRaw.decisionTiming),
      desiredStart: coerceEvidencedValue(scheduleRaw.desiredStart),
      desiredCompletion: coerceEvidencedValue(scheduleRaw.desiredCompletion),
      drivers: coerceStringList(scheduleRaw.drivers),
      dependencies: coerceStringList(scheduleRaw.dependencies),
      flexibility:
        typeof scheduleRaw.flexibility === "string"
          ? scheduleRaw.flexibility
          : (scheduleRaw.flexibility ?? null),
      summary:
        typeof scheduleRaw.summary === "string"
          ? scheduleRaw.summary
          : (scheduleRaw.summary ?? null),
    },
    nextSteps: {
      prospect: coerceStringList(nextRaw.prospect),
      acton: coerceStringList(nextRaw.acton),
    },
    actonRecommendation: {
      fit:
        typeof recRaw.fit === "string"
          ? recRaw.fit
          : typeof recRaw.summary === "string"
            ? recRaw.summary
            : typeof si.actonRecommendation === "string"
              ? si.actonRecommendation
              : (recRaw.fit ?? null),
      reasoning:
        typeof recRaw.reasoning === "string"
          ? recRaw.reasoning
          : typeof recRaw.rationale === "string"
            ? recRaw.rationale
            : (recRaw.reasoning ?? null),
    },
    competitionAlternatives: coerceStringList(si.competitionAlternatives),
  };
}
