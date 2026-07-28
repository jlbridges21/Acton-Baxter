import "server-only";

import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { ASSESSMENT_CATEGORY_LABELS, PEM_NEAT_STANDARD_VERSION } from "./constants";
import { buildMockPemNeatResult } from "./mock-result";
import {
  buildPemNeatSchemaHint,
  buildPemNeatSystemPrompt,
  buildPemNeatUserPrompt,
} from "./prompts";
import { parsePemNeatStructuredResult, type PemNeatStructuredResult } from "./schemas";
import { prepareTranscriptForModel, stage0ValidateTranscript } from "./transcript";
import { runDeterministicNeatChecks } from "./validate";

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
  transcriptStrategy: "full" | "head_tail_preserved";
};

function shouldUseMock(): boolean {
  const env = getEnv();
  return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
}

function normalizeCategoryLabels(result: PemNeatStructuredResult): PemNeatStructuredResult {
  return {
    ...result,
    assessment: {
      ...result.assessment,
      categories: result.assessment.categories.map((c) => ({
        ...c,
        label: ASSESSMENT_CATEGORY_LABELS[c.key] ?? c.label,
      })),
    },
  };
}

async function callOpenAiJson(messages: Array<{ role: string; content: string }>): Promise<{
  content: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}> {
  const env = getEnv();
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new AppError("AI generation is not configured", {
      code: "AI_NOT_CONFIGURED",
      statusCode: 503,
    });
  }

  const model = (env.BAXTER_OPENAI_MODEL || env.OPENAI_MODEL || "gpt-4o").trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.EXTERNAL_API_TIMEOUT_MS);

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
        max_tokens: 8_000,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    type CompletionResponse = {
      choices?: Array<{ message?: { content?: string } }>;
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
      throw new AppError("PEM NEAT generation failed", {
        code: "PEM_NEAT_PROVIDER_ERROR",
        statusCode: 502,
      });
    }

    const content = data?.choices?.[0]?.message?.content;
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
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Purpose-built PEM NEAT generation. Does not route through Knowledge Q&A.
 */
export async function generatePemNeat(input: GeneratePemNeatInput): Promise<GeneratePemNeatOutput> {
  const started = Date.now();
  const stage0 = stage0ValidateTranscript(input.transcript);
  if (!stage0.ok) {
    throw new AppError(stage0.error ?? "Invalid transcript", {
      code: "PEM_NEAT_TRANSCRIPT_INVALID",
      statusCode: 400,
    });
  }

  const prepared = prepareTranscriptForModel(input.transcript);
  const stage0Notes = [...stage0.notes, ...prepared.notes];

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
      transcriptStrategy: prepared.strategy,
    };
  }

  const system = `${buildPemNeatSystemPrompt()}\n\n${buildPemNeatSchemaHint()}`;
  const user = buildPemNeatUserPrompt({
    prospectName: input.prospectName,
    advisorName: input.advisorName,
    meetingDate: input.meetingDate ?? null,
    transcript: prepared.text,
    transcriptNotes: stage0Notes,
  });

  const first = await callOpenAiJson([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const rawContent = first.content;
  let modelName = first.model;
  let inputTokens = first.inputTokens;
  let outputTokens = first.outputTokens;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch {
    throw new AppError("PEM NEAT generation returned invalid JSON", {
      code: "PEM_NEAT_INVALID_JSON",
      statusCode: 502,
    });
  }

  let result: PemNeatStructuredResult;
  try {
    result = normalizeCategoryLabels(parsePemNeatStructuredResult(parsedJson));
  } catch (parseError) {
    const repair = await callOpenAiJson([
      { role: "system", content: system },
      { role: "user", content: user },
      { role: "assistant", content: rawContent },
      {
        role: "user",
        content: `Your previous JSON failed schema validation. Return corrected JSON only. Error: ${
          parseError instanceof Error
            ? parseError.message.slice(0, 800)
            : "schema validation failed"
        }`,
      },
    ]);
    try {
      result = normalizeCategoryLabels(parsePemNeatStructuredResult(JSON.parse(repair.content)));
      modelName = repair.model;
      inputTokens =
        inputTokens != null && repair.inputTokens != null
          ? inputTokens + repair.inputTokens
          : (inputTokens ?? repair.inputTokens);
      outputTokens =
        outputTokens != null && repair.outputTokens != null
          ? outputTokens + repair.outputTokens
          : (outputTokens ?? repair.outputTokens);
    } catch {
      throw new AppError("PEM NEAT output failed validation", {
        code: "PEM_NEAT_SCHEMA_INVALID",
        statusCode: 502,
      });
    }
  }

  const checkIssues = runDeterministicNeatChecks(result, input.transcript);
  if (checkIssues.length) {
    result = {
      ...result,
      analysisMetadata: {
        ...result.analysisMetadata,
        limitations: [
          ...(result.analysisMetadata.limitations ?? []),
          ...checkIssues.map((i) => `QC: ${i}`),
        ],
        stage0Notes: [...(result.analysisMetadata.stage0Notes ?? []), ...stage0Notes],
      },
    };
    const hard = checkIssues.filter((i) => i.startsWith("HARD:"));
    if (hard.length) {
      throw new AppError("PEM NEAT failed quality checks", {
        code: "PEM_NEAT_QC_FAILED",
        statusCode: 502,
      });
    }
  } else {
    result = {
      ...result,
      analysisMetadata: {
        ...result.analysisMetadata,
        stage0Notes: [...(result.analysisMetadata.stage0Notes ?? []), ...stage0Notes],
      },
    };
  }

  result = {
    ...result,
    metadata: {
      ...result.metadata,
      prospectName: input.prospectName,
      advisorName: input.advisorName,
      meetingDate: input.meetingDate ?? result.metadata.meetingDate ?? null,
    },
  };

  return {
    result,
    modelProvider: "openai",
    modelName,
    latencyMs: Date.now() - started,
    inputTokens,
    outputTokens,
    usedMock: false,
    stage0Notes,
    transcriptStrategy: prepared.strategy,
  };
}

export function getPemNeatStandardVersion() {
  return PEM_NEAT_STANDARD_VERSION;
}
