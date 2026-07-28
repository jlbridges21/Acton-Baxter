import "server-only";

import { ZodError } from "zod";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { ASSESSMENT_CATEGORY_LABELS, PEM_NEAT_STANDARD_VERSION } from "./constants";
import {
  emptyPemNeatShell,
  mergeAssessmentCategories,
  mergeBuildertrendFields,
  clampInternalNotes,
} from "./defaults";
import { getPemNeatProviderTimeoutMs, isAbortError } from "./errors";
import { buildMockPemNeatResult } from "./mock-result";
import { buildPemNeatSystemPrompt, buildPemNeatUserPrompt } from "./prompts";
import {
  parsePemNeatStructuredResult,
  salesIntelligenceSchema,
  assessmentSchema,
  followUpEmailSchema,
  buildertrendFieldsSchema,
  projectIntelligenceSchema,
  type PemNeatStructuredResult,
} from "./schemas";
import { chunkTranscript, stage0ValidateTranscript } from "./transcript";
import { runDeterministicNeatChecks } from "./validate";
import { z } from "zod";

export type GeneratePemNeatInput = {
  prospectName: string;
  advisorName: string;
  meetingDate?: string | null;
  transcript: string;
};

export type GeneratePemNeatOutput = {
  result: PemNeatStructuredResult;
  modelProvider: string;
  modelName: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usedMock: boolean;
  stage0Notes: string[];
  transcriptStrategy: "full" | "chunked";
  diagnostics: {
    stages: string[];
    finishReasons: string[];
    validationIssues: string[];
  };
};

const PEM_MAX_OUTPUT_TOKENS = 12_000;

function shouldUseMock(): boolean {
  const env = getEnv();
  return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
}

function zodIssueSummary(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
  }
  if (error instanceof Error) return error.message.slice(0, 500);
  return "schema validation failed";
}

function normalizeCategoryLabels(result: PemNeatStructuredResult): PemNeatStructuredResult {
  return {
    ...result,
    assessment: {
      ...result.assessment,
      categories: mergeAssessmentCategories(result.assessment.categories).map((c) => ({
        ...c,
        label: ASSESSMENT_CATEGORY_LABELS[c.key] ?? c.label,
      })),
    },
    buildertrendFields: mergeBuildertrendFields(result.buildertrendFields),
    internalOpportunityNotes: clampInternalNotes(result.internalOpportunityNotes),
  };
}

type ProviderJsonResult = {
  content: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
};

async function callOpenAiJson(
  messages: Array<{ role: string; content: string }>,
  maxTokens = PEM_MAX_OUTPUT_TOKENS,
): Promise<ProviderJsonResult> {
  const env = getEnv();
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new AppError("AI generation is not configured", {
      code: "AI_NOT_CONFIGURED",
      statusCode: 503,
    });
  }

  const model = (env.BAXTER_OPENAI_MODEL || env.OPENAI_MODEL || "gpt-4o").trim();
  const timeoutMs = getPemNeatProviderTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    type CompletionResponse = {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    let data: CompletionResponse | null = null;
    try {
      data = text ? (JSON.parse(text) as CompletionResponse) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.error("[pem-neat] provider HTTP error", {
        status: response.status,
        code: "PEM_NEAT_PROVIDER_ERROR",
      });
      throw new AppError(
        "Unable to generate PEM NEAT. Baxter couldn't complete the analysis with the AI provider.",
        { code: "PEM_NEAT_PROVIDER_ERROR", statusCode: 502 },
      );
    }

    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason ?? null;

    if (finishReason === "length") {
      console.error("[pem-neat] output truncated", {
        code: "PEM_NEAT_OUTPUT_TRUNCATED",
        model,
      });
      throw new AppError(
        "Baxter's analysis was truncated before it finished. Try regenerating — long meetings are processed in stages.",
        { code: "PEM_NEAT_OUTPUT_TRUNCATED", statusCode: 502 },
      );
    }

    if (!content || !data) {
      throw new AppError("PEM NEAT generation returned empty output", {
        code: "PEM_NEAT_EMPTY_OUTPUT",
        statusCode: 502,
      });
    }

    return {
      content,
      model: data.model ?? model,
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
      finishReason,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw new AppError(
        "Unable to generate PEM NEAT. Analysis timed out — your transcript has been saved. Try again.",
        { code: "PEM_NEAT_TIMEOUT", statusCode: 504, cause: error },
      );
    }
    if (error instanceof AppError) throw error;
    throw new AppError(
      "Unable to generate PEM NEAT. Baxter couldn't complete the analysis. Your transcript has been saved.",
      { code: "PEM_NEAT_PROVIDER_ERROR", statusCode: 502, cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonOrThrow(content: string, code: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new AppError(
      "Baxter generated an incomplete analysis and could not safely save it. Try again.",
      { code, statusCode: 502 },
    );
  }
}

const factsStageSchema = z.object({
  salesIntelligence: salesIntelligenceSchema.partial().optional(),
  projectIntelligence: projectIntelligenceSchema.optional(),
  productionNotes: z.array(z.string()).optional(),
  analysisMetadata: z
    .object({
      transcriptComplete: z.boolean().optional(),
      speakersLabeled: z.boolean().optional(),
      timestampsAvailable: z.boolean().optional(),
      appearsToBePem: z.boolean().optional(),
      attributionConfidence: z.enum(["high", "medium", "low", "unknown"]).optional(),
      limitations: z.array(z.string()).optional(),
    })
    .optional(),
  metadata: z
    .object({
      transcriptQuality: z.enum(["high", "medium", "low", "poor"]).optional(),
      limitations: z.array(z.string()).optional(),
    })
    .optional(),
});

const assessmentStageSchema = z.object({
  assessment: assessmentSchema.partial().optional(),
  meetingOutcome: z
    .object({
      classification: z.string(),
      explanation: z.string().optional(),
    })
    .optional(),
  qualification: z
    .object({
      classification: z.string(),
      reasoning: z.string().optional(),
      risks: z.array(z.string()).optional(),
    })
    .optional(),
});

const handoffStageSchema = z.object({
  followUpEmail: followUpEmailSchema.partial().optional(),
  buildertrendFields: buildertrendFieldsSchema.partial().optional(),
  internalOpportunityNotes: z.string().optional(),
  productionNotes: z.array(z.string()).optional(),
});

async function runStage(
  system: string,
  user: string,
  maxTokens: number,
): Promise<ProviderJsonResult> {
  return callOpenAiJson(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens,
  );
}

/**
 * Staged PEM NEAT generation:
 * 1) Fact extraction (full or chunked merge)
 * 2) Sales assessment
 * 3) Email + BuilderTrend handoff
 * Server owns structural defaults; unknown business facts are allowed.
 */
export async function generatePemNeat(input: GeneratePemNeatInput): Promise<GeneratePemNeatOutput> {
  const started = Date.now();
  const diagnostics = {
    stages: [] as string[],
    finishReasons: [] as string[],
    validationIssues: [] as string[],
  };

  const stage0 = stage0ValidateTranscript(input.transcript);
  if (!stage0.ok) {
    throw new AppError(stage0.error ?? "Invalid transcript", {
      code: "PEM_NEAT_TRANSCRIPT_INVALID",
      statusCode: 400,
    });
  }

  const chunks = chunkTranscript(input.transcript);
  const strategy = chunks.length === 1 ? ("full" as const) : ("chunked" as const);
  const stage0Notes = [
    ...stage0.notes,
    ...(strategy === "chunked"
      ? [`Transcript analyzed in ${chunks.length} overlapping chunks (beginning→end).`]
      : []),
  ];

  if (shouldUseMock()) {
    const result = normalizeCategoryLabels(
      parsePemNeatStructuredResult(
        buildMockPemNeatResult({
          prospectName: input.prospectName,
          advisorName: input.advisorName,
          meetingDate: input.meetingDate,
        }),
      ),
    );
    result.analysisMetadata = {
      ...result.analysisMetadata,
      stage0Notes,
      limitations: [...(result.analysisMetadata.limitations ?? []), ...stage0Notes],
    };
    return {
      result,
      modelProvider: "mock",
      modelName: "mock-pem-neat",
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      usedMock: true,
      stage0Notes,
      transcriptStrategy: strategy,
      diagnostics: { stages: ["mock"], finishReasons: [], validationIssues: [] },
    };
  }

  const baseSystem = buildPemNeatSystemPrompt();
  let modelName = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const shell = emptyPemNeatShell({
    prospectName: input.prospectName,
    advisorName: input.advisorName,
    meetingDate: input.meetingDate,
  });

  // -------- Stage 1: facts --------
  diagnostics.stages.push("facts");
  const factParts: unknown[] = [];
  for (const chunk of chunks) {
    const factPrompt = `${baseSystem}

STAGE: FACT EXTRACTION ONLY.
Return JSON with keys: salesIntelligence (customerStory, customerPain, type1Pain, type2Pain, budget, decisionProcess, schedule, competitionAlternatives, actonRecommendation, nextSteps), projectIntelligence, productionNotes, analysisMetadata, metadata.transcriptQuality/limitations.
Do NOT invent unknown facts. Prefer null / [] when not established.
Do NOT include assessment categories or BuilderTrend fields.
Chunk ${chunk.index + 1}/${chunk.total} (${chunk.label}).`;

    const user = buildPemNeatUserPrompt({
      prospectName: input.prospectName,
      advisorName: input.advisorName,
      meetingDate: input.meetingDate ?? null,
      transcript: chunk.text,
      transcriptNotes: stage0Notes,
    });

    const res = await runStage(factPrompt, user, 6_000);
    diagnostics.finishReasons.push(res.finishReason ?? "unknown");
    modelName = res.model;
    inputTokens += res.inputTokens ?? 0;
    outputTokens += res.outputTokens ?? 0;
    factParts.push(parseJsonOrThrow(res.content, "PEM_NEAT_INVALID_JSON"));
  }

  const mergedFacts = mergeFactStages(factParts);
  try {
    const parsedFacts = factsStageSchema.parse(mergedFacts);
    if (parsedFacts.salesIntelligence) {
      shell.salesIntelligence = {
        ...shell.salesIntelligence,
        ...parsedFacts.salesIntelligence,
        meetingOutcome: shell.salesIntelligence.meetingOutcome,
        qualification: shell.salesIntelligence.qualification,
      };
    }
    if (parsedFacts.projectIntelligence) {
      shell.projectIntelligence = {
        ...shell.projectIntelligence,
        ...parsedFacts.projectIntelligence,
      };
    }
    if (parsedFacts.productionNotes) {
      shell.productionNotes = parsedFacts.productionNotes;
    }
    if (parsedFacts.analysisMetadata) {
      shell.analysisMetadata = {
        ...shell.analysisMetadata,
        ...parsedFacts.analysisMetadata,
        limitations: [
          ...(shell.analysisMetadata.limitations ?? []),
          ...(parsedFacts.analysisMetadata.limitations ?? []),
        ],
      };
    }
    if (parsedFacts.metadata) {
      shell.metadata = {
        ...shell.metadata,
        transcriptQuality:
          parsedFacts.metadata.transcriptQuality ?? shell.metadata.transcriptQuality,
        limitations: [
          ...(shell.metadata.limitations ?? []),
          ...(parsedFacts.metadata.limitations ?? []),
        ],
      };
    }
  } catch (error) {
    diagnostics.validationIssues.push(`facts: ${zodIssueSummary(error)}`);
    console.error("[pem-neat] facts stage soft-fail", {
      code: "PEM_NEAT_FACTS_PARTIAL",
      issues: zodIssueSummary(error),
    });
  }

  // -------- Stage 2: assessment --------
  diagnostics.stages.push("assessment");
  const assessmentPrompt = `${baseSystem}

STAGE: SALES ASSESSMENT ONLY.
Given the established facts JSON and transcript evidence, return JSON with:
assessment { categories (keyed by bonding_rapport, palo_upfront_contract, type1_pain, type2_pain, budget, decision_making_process, schedule, summary, fulfillment_solution_positioning, outcome_close, post_sell, overall_process_control — include palo on palo_upfront_contract), topStrengths, topImprovements, oneThing },
meetingOutcome { classification, explanation },
qualification { classification, reasoning, risks }.
Use NOT_DETERMINABLE when evidence is insufficient — do not invent MISSED from incomplete evidence.
Unknown coaching fields may use short honest placeholders.`;

  const assessmentUser = `Prospect: ${input.prospectName}
Advisor: ${input.advisorName}

Established facts (JSON):
${JSON.stringify({
  salesIntelligence: shell.salesIntelligence,
  projectIntelligence: shell.projectIntelligence,
  analysisMetadata: shell.analysisMetadata,
}).slice(0, 40_000)}

Transcript evidence (may be abbreviated for length; facts above are authoritative for extraction):
<pem_transcript>
${input.transcript.slice(0, 60_000)}
</pem_transcript>`;

  try {
    const res = await runStage(assessmentPrompt, assessmentUser, 8_000);
    diagnostics.finishReasons.push(res.finishReason ?? "unknown");
    modelName = res.model;
    inputTokens += res.inputTokens ?? 0;
    outputTokens += res.outputTokens ?? 0;
    const raw = parseJsonOrThrow(res.content, "PEM_NEAT_INVALID_JSON");
    const parsed = assessmentStageSchema.parse(raw);
    if (parsed.assessment) {
      shell.assessment = {
        categories: mergeAssessmentCategories(
          (parsed.assessment.categories as PemNeatStructuredResult["assessment"]["categories"]) ??
            [],
        ),
        topStrengths: parsed.assessment.topStrengths ?? [],
        topImprovements: parsed.assessment.topImprovements ?? [],
        oneThing:
          parsed.assessment.oneThing?.trim() || "Not enough evidence to determine The One Thing.",
      };
    }
    if (parsed.meetingOutcome) {
      shell.salesIntelligence.meetingOutcome = {
        classification: parsed.meetingOutcome
          .classification as PemNeatStructuredResult["salesIntelligence"]["meetingOutcome"]["classification"],
        explanation:
          parsed.meetingOutcome.explanation?.trim() ||
          "Outcome not established from transcript evidence.",
      };
    }
    if (parsed.qualification) {
      shell.salesIntelligence.qualification = {
        classification: parsed.qualification
          .classification as PemNeatStructuredResult["salesIntelligence"]["qualification"]["classification"],
        reasoning:
          parsed.qualification.reasoning?.trim() ||
          "Qualification not established from transcript evidence.",
        risks: parsed.qualification.risks ?? [],
      };
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "PEM_NEAT_OUTPUT_TRUNCATED") throw error;
    diagnostics.validationIssues.push(`assessment: ${zodIssueSummary(error)}`);
    console.error("[pem-neat] assessment stage soft-fail", {
      code: "PEM_NEAT_ASSESSMENT_PARTIAL",
      issues: zodIssueSummary(error),
    });
    // Keep defaults — structurally complete shell remains valid.
  }

  // -------- Stage 3: handoff --------
  diagnostics.stages.push("handoff");
  const handoffPrompt = `${baseSystem}

STAGE: CUSTOMER EMAIL + BUILDERTrend HANDOFF ONLY.
Return JSON with: followUpEmail { subject, body }, buildertrendFields (only fill evidenced values; null when unknown), internalOpportunityNotes (max 2500 chars), productionNotes.
Email must be customer-facing — no Type 1/2, qualification, scores, coaching, or PALO language.
BuilderTrend fields are operational; no sales coaching.`;

  const handoffUser = `Prospect: ${input.prospectName}
Advisor: ${input.advisorName}

Validated sales intelligence:
${JSON.stringify(shell.salesIntelligence).slice(0, 30_000)}

Project intelligence:
${JSON.stringify(shell.projectIntelligence).slice(0, 10_000)}`;

  try {
    const res = await runStage(handoffPrompt, handoffUser, 5_000);
    diagnostics.finishReasons.push(res.finishReason ?? "unknown");
    modelName = res.model;
    inputTokens += res.inputTokens ?? 0;
    outputTokens += res.outputTokens ?? 0;
    const raw = parseJsonOrThrow(res.content, "PEM_NEAT_INVALID_JSON");
    const parsed = handoffStageSchema.parse(raw);
    if (parsed.followUpEmail?.body) {
      shell.followUpEmail = {
        subject: parsed.followUpEmail.subject ?? null,
        body: parsed.followUpEmail.body,
      };
    }
    if (parsed.buildertrendFields) {
      shell.buildertrendFields = mergeBuildertrendFields(parsed.buildertrendFields);
    }
    if (parsed.internalOpportunityNotes != null) {
      shell.internalOpportunityNotes = clampInternalNotes(parsed.internalOpportunityNotes);
    }
    if (parsed.productionNotes?.length) {
      shell.productionNotes = parsed.productionNotes;
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "PEM_NEAT_OUTPUT_TRUNCATED") throw error;
    diagnostics.validationIssues.push(`handoff: ${zodIssueSummary(error)}`);
    console.error("[pem-neat] handoff stage soft-fail", {
      code: "PEM_NEAT_HANDOFF_PARTIAL",
      issues: zodIssueSummary(error),
    });
  }

  // Final structural validation — shell is always mergeable to valid result
  let result: PemNeatStructuredResult;
  try {
    result = normalizeCategoryLabels(parsePemNeatStructuredResult(shell));
  } catch (error) {
    console.error("[pem-neat] final assemble failed", {
      code: "PEM_NEAT_SCHEMA_INVALID",
      issues: zodIssueSummary(error),
    });
    throw new AppError(
      "Baxter generated an incomplete analysis and could not safely save it. Try again.",
      { code: "PEM_NEAT_SCHEMA_INVALID", statusCode: 502 },
    );
  }

  const checkIssues = runDeterministicNeatChecks(result, input.transcript);
  diagnostics.validationIssues.push(...checkIssues);
  result = {
    ...result,
    analysisMetadata: {
      ...result.analysisMetadata,
      limitations: [
        ...(result.analysisMetadata.limitations ?? []),
        ...checkIssues.map((i) => `QC: ${i}`),
        ...diagnostics.validationIssues
          .filter((i) => i.includes("partial") || i.includes("soft"))
          .slice(0, 5),
      ],
      stage0Notes: [...(result.analysisMetadata.stage0Notes ?? []), ...stage0Notes],
    },
    metadata: {
      ...result.metadata,
      prospectName: input.prospectName,
      advisorName: input.advisorName,
      meetingDate: input.meetingDate ?? result.metadata.meetingDate ?? null,
    },
  };

  console.info("[pem-neat] generation complete", {
    stages: diagnostics.stages,
    finishReasons: diagnostics.finishReasons,
    validationIssueCount: diagnostics.validationIssues.length,
    model: modelName,
    latencyMs: Date.now() - started,
  });

  return {
    result,
    modelProvider: "openai",
    modelName,
    latencyMs: Date.now() - started,
    inputTokens: inputTokens || null,
    outputTokens: outputTokens || null,
    usedMock: false,
    stage0Notes,
    transcriptStrategy: strategy,
    diagnostics,
  };
}

function mergeFactStages(parts: unknown[]): unknown {
  if (parts.length === 1) return parts[0];
  const base: Record<string, unknown> = {};
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const obj = part as Record<string, unknown>;
    deepMergeFacts(base, obj);
  }
  return base;
}

function deepMergeFacts(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    const existing = target[key];
    if (Array.isArray(value)) {
      const prev = Array.isArray(existing) ? existing : [];
      target[key] = [...prev, ...value];
    } else if (typeof value === "object") {
      const prev =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};
      const next = { ...prev };
      deepMergeFacts(next, value as Record<string, unknown>);
      target[key] = next;
    } else if (existing == null || existing === "") {
      target[key] = value;
    } else if (typeof existing === "string" && typeof value === "string" && existing !== value) {
      // Prefer later (often updated) statement while keeping note of earlier
      target[key] = value;
    }
  }
}

export function getPemNeatStandardVersion() {
  return PEM_NEAT_STANDARD_VERSION;
}

export const PEM_NEAT_ROUTE_MAX_DURATION_SECONDS = 300;
