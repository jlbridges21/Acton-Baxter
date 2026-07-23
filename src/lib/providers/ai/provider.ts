import "server-only";

import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";
import { FIELD_KEYS } from "@/lib/research/constants";
import type { NormalizedResearchResult, PemPreparation } from "@/lib/research/schemas";
import { logServerError } from "@/lib/errors";
import { AnthropicReportProvider } from "./anthropic-provider";
import { DeterministicAiProvider, buildDeterministicAiContent } from "./deterministic-provider";
import { sanitizeAiErrorMessage } from "./errors";
import { OpenAiReportProvider } from "./openai-provider";
import { aiReportContentSchema, type AiReportContent } from "./schemas";
import {
  AI_PROMPT_VERSION,
  type AiReportGenerationResult,
  type AiReportGenerator,
  type AiProviderName,
  type SanitizedAiInput,
} from "./types";

const CRITICAL_FIELDS = [
  FIELD_KEYS.apn,
  FIELD_KEYS.lotSqFt,
  FIELD_KEYS.livingAreaSqFt,
  FIELD_KEYS.yearBuilt,
  FIELD_KEYS.zoning,
] as const;

function truthyText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sanitizeAiInput(result: NormalizedResearchResult): SanitizedAiInput {
  const availableFieldKeys = new Set<string>();
  for (const fact of result.facts) {
    if (
      fact.normalizedValueText ||
      fact.normalizedValueNumber != null ||
      fact.normalizedValueBoolean != null
    ) {
      availableFieldKeys.add(fact.fieldKey);
    }
  }
  for (const key of Object.values(FIELD_KEYS)) {
    // Keep known keys discoverable even when missing so grounding can reference them carefully.
    // Do not expose owner mailing fields to the model.
    if (key === FIELD_KEYS.ownerMailingAddress || key === FIELD_KEYS.ownerName) continue;
    availableFieldKeys.add(key);
  }
  if (result.planning.relevantOverlays.length > 0) {
    availableFieldKeys.add("relevant_overlays");
  }

  const missingCriticalFields = CRITICAL_FIELDS.filter((fieldKey) => {
    const fact = result.facts.find((item) => item.fieldKey === fieldKey);
    if (!fact) return true;
    return (
      !fact.normalizedValueText &&
      fact.normalizedValueNumber == null &&
      fact.normalizedValueBoolean == null
    );
  });

  const poolFact = result.facts.find(
    (fact) => /pool/i.test(fact.fieldKey) || /pool/i.test(fact.fieldLabel),
  );
  const poolIndicator =
    poolFact?.normalizedValueBoolean ??
    (poolFact?.normalizedValueText
      ? /yes|true|present|1/i.test(poolFact.normalizedValueText)
      : null);

  const officialSourceLinks = result.sources
    .filter((source) => source.sourceUrl && source.status === "active")
    .slice(0, 12)
    .map((source) => ({
      label: source.sourceName,
      url: source.sourceUrl!,
      sourceName: source.sourceName,
    }));

  return {
    standardizedAddress: result.identity.standardizedAddress,
    apn: truthyText(result.identity.apn),
    governingJurisdiction: truthyText(result.identity.jurisdiction),
    county: truthyText(result.identity.county),
    lotSquareFootage: result.characteristics.lotSquareFootage ?? null,
    livingAreaSquareFootage: result.characteristics.livingAreaSquareFootage ?? null,
    yearBuilt: result.characteristics.yearBuilt ?? null,
    bedrooms: result.characteristics.bedrooms ?? null,
    bathrooms: result.characteristics.bathrooms ?? null,
    stories: result.characteristics.stories ?? null,
    propertyType: truthyText(result.characteristics.propertyType),
    buildingCount: result.characteristics.buildingCount ?? null,
    poolIndicator,
    zoning: truthyText(result.planning.zoning),
    generalPlanDesignation: truthyText(result.planning.generalPlanDesignation),
    historicDesignation: truthyText(result.planning.historicDesignation),
    floodZone: truthyText(result.planning.floodZone),
    fireZone: truthyText(result.planning.fireZone),
    relevantOverlays: result.planning.relevantOverlays.slice(0, 12),
    permits: result.permits.slice(0, 8).map((permit) => ({
      permitNumber: permit.permitNumber,
      description: permit.description.slice(0, 240),
      status: permit.status,
    })),
    conflicts: result.conflicts.slice(0, 10).map((conflict) => ({
      fieldKey: conflict.fieldKey,
      fieldLabel: conflict.fieldLabel,
      severity: conflict.severity,
      description: conflict.description.slice(0, 400),
    })),
    missingCriticalFields: [...missingCriticalFields],
    officialSourceLinks,
    siteObservations: result.siteObservations.slice(0, 8).map((observation) => ({
      title: observation.title,
      description: observation.description.slice(0, 400),
      confidence: observation.confidence,
    })),
    availableFieldKeys: [...availableFieldKeys].sort(),
  };
}

export function hashSanitizedAiInput(input: SanitizedAiInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function validateAndGroundAiContent(
  content: AiReportContent,
  input: SanitizedAiInput,
): AiReportContent {
  const parsed = aiReportContentSchema.parse(content);
  const allowed = new Set(input.availableFieldKeys);
  const groundedFindings = parsed.importantPropertyFindings
    .map((finding) => ({
      ...finding,
      sourceFieldKeys: finding.sourceFieldKeys.filter((key) => allowed.has(key)),
    }))
    .filter((finding) => finding.sourceFieldKeys.length > 0);

  if (groundedFindings.length === 0) {
    throw new Error("AI findings could not be grounded to known field keys");
  }

  return {
    ...parsed,
    importantPropertyFindings: groundedFindings.slice(0, 3),
  };
}

export function aiContentToPemPreparation(content: AiReportContent): PemPreparation {
  return {
    overview: content.researchSummary,
    propertyFindings: content.importantPropertyFindings.map(
      (finding) => `${finding.title}: ${finding.description}`,
    ),
    propertyQuestions: content.propertySpecificQuestions,
    verifyDuringPem: content.verifyDuringPem,
    verifyDuringFeasibility: content.verifyDuringFeasibility,
    verifyThroughTitleOrSurvey: content.verifyThroughTitleOrSurvey,
    verifyWithPlanning: content.verifyWithPlanning,
  };
}

export function getAiReportGenerator(providerName?: AiProviderName): AiReportGenerator {
  const env = getEnv();
  const selected = providerName ?? env.AI_PROVIDER;
  if (selected === "openai") {
    return new OpenAiReportProvider();
  }
  if (selected === "anthropic") {
    return new AnthropicReportProvider();
  }
  return new DeterministicAiProvider();
}

export async function generateAiReportContent(
  result: NormalizedResearchResult,
  options?: { provider?: AiProviderName },
): Promise<AiReportGenerationResult> {
  const input = sanitizeAiInput(result);
  const inputHash = hashSanitizedAiInput(input);
  const generatedAt = new Date().toISOString();
  const env = getEnv();
  const requested = options?.provider ?? env.AI_PROVIDER;
  const fallback = buildDeterministicAiContent(input);

  if (requested === "deterministic") {
    return {
      provider: "deterministic",
      model: "deterministic-v1",
      status: "success",
      promptVersion: AI_PROMPT_VERSION,
      generatedAt,
      inputHash,
      content: fallback,
      errorMessage: null,
    };
  }

  try {
    const generator = getAiReportGenerator(requested);
    const raw = await generator.generate(input);
    const grounded = validateAndGroundAiContent(raw, input);
    return {
      provider: generator.key,
      model: generator.model,
      status: "success",
      promptVersion: AI_PROMPT_VERSION,
      generatedAt,
      inputHash,
      content: grounded,
      errorMessage: null,
    };
  } catch (error) {
    const message = sanitizeAiErrorMessage(
      error instanceof Error ? error.message : "AI generation failed",
    );
    logServerError("generateAiReportContent", message);
    return {
      provider: "deterministic",
      model: "deterministic-v1",
      status: "fallback",
      promptVersion: AI_PROMPT_VERSION,
      generatedAt,
      inputHash,
      content: fallback,
      errorMessage: message,
    };
  }
}
