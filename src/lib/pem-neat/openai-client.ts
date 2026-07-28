import "server-only";

import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  getOpenAiModelCapabilities,
  parseReasoningEffort,
  type OpenAiModelCapabilities,
  type OpenAiReasoningEffort,
} from "@/lib/openai/capabilities";
import { isAbortError } from "@/lib/pem-neat/errors";

export type PemOpenAiJsonRequest = {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant" | "developer"; content: string }>;
  maxOutputTokens: number;
  temperature?: number;
  reasoningEffort?: OpenAiReasoningEffort;
  timeoutMs: number;
  /** Optional override for tests. */
  fetchImpl?: typeof fetch;
};

export type PemOpenAiJsonResult = {
  content: string;
  model: string;
  api: "responses" | "chat_completions";
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  finishReason: string | null;
  status: string | null;
  usedFallback: boolean;
};

export type PemOpenAiErrorCode =
  | "PEM_NEAT_PROVIDER_ERROR"
  | "PEM_NEAT_PROVIDER_REQUEST_INVALID"
  | "PEM_NEAT_MODEL_NOT_AVAILABLE"
  | "PEM_NEAT_RATE_LIMITED"
  | "PEM_NEAT_QUOTA_EXCEEDED"
  | "PEM_NEAT_TIMEOUT"
  | "PEM_NEAT_OUTPUT_TRUNCATED"
  | "PEM_NEAT_PROVIDER_INCOMPLETE"
  | "PEM_NEAT_PROVIDER_REFUSAL"
  | "PEM_NEAT_EMPTY_OUTPUT"
  | "AI_NOT_CONFIGURED";

function mapHttpToPemError(
  status: number,
  body: { error?: { message?: string; code?: string; type?: string; param?: string } } | null,
): { code: PemOpenAiErrorCode; message: string; retryable: boolean } {
  const errCode = (body?.error?.code ?? "").toLowerCase();
  const errType = (body?.error?.type ?? "").toLowerCase();
  const errMsg = (body?.error?.message ?? "").toLowerCase();
  const combined = `${errCode} ${errType} ${errMsg}`;

  if (status === 401) {
    return {
      code: "PEM_NEAT_PROVIDER_REQUEST_INVALID",
      message: "Baxter's PEM AI configuration needs attention (OpenAI authorization failed).",
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      code: "PEM_NEAT_MODEL_NOT_AVAILABLE",
      message: "Configured PEM AI model is not available to this OpenAI project.",
      retryable: false,
    };
  }
  if (
    status === 404 ||
    combined.includes("model_not_found") ||
    combined.includes("does not exist")
  ) {
    return {
      code: "PEM_NEAT_MODEL_NOT_AVAILABLE",
      message: "Configured PEM AI model is not available to this OpenAI project.",
      retryable: false,
    };
  }
  if (status === 400) {
    return {
      code: "PEM_NEAT_PROVIDER_REQUEST_INVALID",
      message: "Baxter's PEM AI configuration needs attention.",
      retryable: false,
    };
  }
  if (status === 429) {
    if (
      combined.includes("insufficient_quota") ||
      combined.includes("quota") ||
      combined.includes("billing")
    ) {
      return {
        code: "PEM_NEAT_QUOTA_EXCEEDED",
        message: "OpenAI quota or billing is preventing PEM generation.",
        retryable: false,
      };
    }
    return {
      code: "PEM_NEAT_RATE_LIMITED",
      message: "OpenAI is temporarily rate limited. Try again shortly.",
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      code: "PEM_NEAT_PROVIDER_ERROR",
      message:
        "Unable to generate PEM NEAT. Baxter couldn't complete the analysis with the AI provider.",
      retryable: true,
    };
  }
  return {
    code: "PEM_NEAT_PROVIDER_ERROR",
    message:
      "Unable to generate PEM NEAT. Baxter couldn't complete the analysis with the AI provider.",
    retryable: false,
  };
}

function extractResponsesText(data: Record<string, unknown>): string | null {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }
  const output = data.output;
  if (!Array.isArray(output)) return null;
  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type === "message" && Array.isArray(row.content)) {
      for (const part of row.content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (
          (p.type === "output_text" || p.type === "text") &&
          typeof p.text === "string" &&
          p.text.trim()
        ) {
          texts.push(p.text);
        }
      }
    }
  }
  return texts.length ? texts.join("\n") : null;
}

function buildResponsesBody(input: PemOpenAiJsonRequest, caps: OpenAiModelCapabilities) {
  const effort =
    input.reasoningEffort ?? parseReasoningEffort(process.env.PEM_NEAT_REASONING_EFFORT, "medium");

  const body: Record<string, unknown> = {
    model: input.model,
    max_output_tokens: input.maxOutputTokens,
    text: { format: { type: "json_object" } },
    input: input.messages.map((m) => ({
      role:
        m.role === "system"
          ? "developer"
          : m.role === "assistant"
            ? "assistant"
            : m.role === "developer"
              ? "developer"
              : "user",
      content: m.content,
    })),
  };

  if (caps.supportsReasoningEffort) {
    body.reasoning = { effort };
  }

  return body;
}

function buildChatBody(input: PemOpenAiJsonRequest, caps: OpenAiModelCapabilities) {
  const body: Record<string, unknown> = {
    model: input.model,
    response_format: { type: "json_object" },
    messages: input.messages.map((m) => ({
      role: m.role === "developer" ? "system" : m.role,
      content: m.content,
    })),
  };

  if (caps.outputTokenParam === "max_completion_tokens" || caps.isReasoningFamily) {
    body.max_completion_tokens = input.maxOutputTokens;
  } else {
    body.max_tokens = input.maxOutputTokens;
  }

  if (caps.supportsTemperature && input.temperature != null) {
    body.temperature = input.temperature;
  }

  return body;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Call OpenAI for PEM JSON generation using model-aware API selection.
 * GPT-5-class → Responses API; GPT-4o-class → Chat Completions.
 */
export async function callPemOpenAiJson(input: PemOpenAiJsonRequest): Promise<PemOpenAiJsonResult> {
  const env = getEnv();
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new AppError("AI generation is not configured", {
      code: "AI_NOT_CONFIGURED",
      statusCode: 503,
    });
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const caps = getOpenAiModelCapabilities(input.model);
  const primary = await callOnce(input, caps, apiKey, fetchImpl, false);

  return primary;
}

/**
 * Provider call with one bounded retry for transient failures,
 * and optional configured technical fallback model.
 */
export async function callPemOpenAiJsonWithRetries(
  input: PemOpenAiJsonRequest,
  options?: { maxAttempts?: number; fallbackModel?: string | null },
): Promise<PemOpenAiJsonResult> {
  const maxAttempts = Math.min(Math.max(options?.maxAttempts ?? 2, 1), 3);
  const fallbackModel = (options?.fallbackModel ?? "").trim() || null;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callPemOpenAiJson(input);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof AppError &&
        (error.code === "PEM_NEAT_RATE_LIMITED" ||
          error.code === "PEM_NEAT_PROVIDER_ERROR" ||
          error.code === "PEM_NEAT_TIMEOUT");
      if (!retryable || attempt >= maxAttempts) break;
      await sleep(400 * attempt);
    }
  }

  if (fallbackModel && fallbackModel !== input.model) {
    try {
      const result = await callPemOpenAiJson({ ...input, model: fallbackModel });
      return { ...result, usedFallback: true };
    } catch (fallbackError) {
      lastError = fallbackError;
    }
  }

  throw lastError;
}

async function callOnce(
  input: PemOpenAiJsonRequest,
  caps: OpenAiModelCapabilities,
  apiKey: string,
  fetchImpl: typeof fetch,
  usedFallback: boolean,
): Promise<PemOpenAiJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    if (caps.api === "responses") {
      return await callResponses(input, caps, apiKey, fetchImpl, controller.signal, usedFallback);
    }
    return await callChatCompletions(
      input,
      caps,
      apiKey,
      fetchImpl,
      controller.signal,
      usedFallback,
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw new AppError(
        "PEM analysis took too long. Your transcript is saved and can be retried.",
        { code: "PEM_NEAT_TIMEOUT", statusCode: 504, cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callResponses(
  input: PemOpenAiJsonRequest,
  caps: OpenAiModelCapabilities,
  apiKey: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  usedFallback: boolean,
): Promise<PemOpenAiJsonResult> {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildResponsesBody(input, caps)),
    signal,
  });

  const text = await response.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const mapped = mapHttpToPemError(
      response.status,
      data as { error?: { message?: string; code?: string; type?: string; param?: string } },
    );
    console.error("[pem-neat] provider HTTP error", {
      status: response.status,
      code: mapped.code,
      param: (data as { error?: { param?: string } } | null)?.error?.param ?? null,
      api: "responses",
      model: input.model,
    });
    throw new AppError(mapped.message, {
      code: mapped.code,
      statusCode: response.status === 429 ? 429 : mapped.retryable ? 502 : 400,
    });
  }

  if (!data) {
    throw new AppError("PEM NEAT generation returned empty output", {
      code: "PEM_NEAT_EMPTY_OUTPUT",
      statusCode: 502,
    });
  }

  const status = typeof data.status === "string" ? data.status : null;
  if (status === "incomplete") {
    const details = data.incomplete_details as { reason?: string } | undefined;
    const reason = details?.reason ?? "incomplete";
    console.error("[pem-neat] incomplete response", {
      code: "PEM_NEAT_PROVIDER_INCOMPLETE",
      reason,
      model: input.model,
    });
    if (reason === "max_output_tokens") {
      throw new AppError("Baxter's analysis was truncated before it finished. Try regenerating.", {
        code: "PEM_NEAT_OUTPUT_TRUNCATED",
        statusCode: 502,
      });
    }
    throw new AppError(
      "Baxter's PEM analysis was incomplete. Your transcript is saved — try again.",
      { code: "PEM_NEAT_PROVIDER_INCOMPLETE", statusCode: 502 },
    );
  }

  if (status === "failed" || data.error) {
    throw new AppError(
      "Unable to generate PEM NEAT. Baxter couldn't complete the analysis with the AI provider.",
      { code: "PEM_NEAT_PROVIDER_ERROR", statusCode: 502 },
    );
  }

  // Refusal detection (structured refusal item or content filter)
  const output = Array.isArray(data.output) ? data.output : [];
  if (
    output.some((o) => o && typeof o === "object" && (o as { type?: string }).type === "refusal")
  ) {
    throw new AppError(
      "The AI provider declined to complete this PEM analysis. Try editing the transcript or retrying.",
      { code: "PEM_NEAT_PROVIDER_REFUSAL", statusCode: 502 },
    );
  }

  const content = extractResponsesText(data);
  if (!content?.trim()) {
    throw new AppError("PEM NEAT generation returned empty output", {
      code: "PEM_NEAT_EMPTY_OUTPUT",
      statusCode: 502,
    });
  }

  const usage = (data.usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
  };

  return {
    content,
    model: typeof data.model === "string" ? data.model : input.model,
    api: "responses",
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null,
    finishReason: status,
    status,
    usedFallback,
  };
}

async function callChatCompletions(
  input: PemOpenAiJsonRequest,
  caps: OpenAiModelCapabilities,
  apiKey: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  usedFallback: boolean,
): Promise<PemOpenAiJsonResult> {
  // Ensure json_object mode prompt compliance for chat API.
  const messages = [...input.messages];
  const hasJsonWord = messages.some((m) => /\bjson\b/i.test(m.content));
  if (!hasJsonWord && messages[0]) {
    messages[0] = {
      ...messages[0],
      content: `${messages[0].content}\n\nReturn a single JSON object.`,
    };
  }

  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildChatBody({ ...input, messages }, caps)),
    signal,
  });

  const text = await response.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const mapped = mapHttpToPemError(
      response.status,
      data as { error?: { message?: string; code?: string; type?: string; param?: string } },
    );
    console.error("[pem-neat] provider HTTP error", {
      status: response.status,
      code: mapped.code,
      param: (data as { error?: { param?: string } } | null)?.error?.param ?? null,
      api: "chat_completions",
      model: input.model,
    });
    throw new AppError(mapped.message, {
      code: mapped.code,
      statusCode: response.status === 429 ? 429 : mapped.retryable ? 502 : 400,
    });
  }

  const choices = data?.choices as
    Array<{ message?: { content?: string; refusal?: string }; finish_reason?: string }> | undefined;
  const choice = choices?.[0];
  if (choice?.message?.refusal) {
    throw new AppError(
      "The AI provider declined to complete this PEM analysis. Try editing the transcript or retrying.",
      { code: "PEM_NEAT_PROVIDER_REFUSAL", statusCode: 502 },
    );
  }
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason ?? null;

  if (finishReason === "length") {
    throw new AppError("Baxter's analysis was truncated before it finished. Try regenerating.", {
      code: "PEM_NEAT_OUTPUT_TRUNCATED",
      statusCode: 502,
    });
  }

  if (!content || !data) {
    throw new AppError("PEM NEAT generation returned empty output", {
      code: "PEM_NEAT_EMPTY_OUTPUT",
      statusCode: 502,
    });
  }

  const usage = (data.usage ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
  };

  return {
    content,
    model: typeof data.model === "string" ? data.model : input.model,
    api: "chat_completions",
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
    reasoningTokens: null,
    finishReason,
    status: finishReason,
    usedFallback,
  };
}

/** Tiny structured ping for admin diagnostics (no customer data). */
export async function runPemOpenAiDiagnosticTest(): Promise<{
  pass: boolean;
  model: string;
  api: string;
  reasoningEffort: string | null;
  latencyMs: number;
  code: string | null;
  message: string | null;
}> {
  const started = Date.now();
  const model = resolvePemNeatModelName();
  const caps = getOpenAiModelCapabilities(model);
  const effort = caps.supportsReasoningEffort
    ? parseReasoningEffort(process.env.PEM_NEAT_REASONING_EFFORT, "medium")
    : null;

  try {
    const result = await callPemOpenAiJson({
      model,
      maxOutputTokens: 120,
      temperature: 0.2,
      reasoningEffort: effort ?? undefined,
      timeoutMs: Math.min(getPemNeatStageTimeoutMs(), 60_000),
      messages: [
        {
          role: "system",
          content:
            'Return JSON only: {"prospectName":"Alex","outcome":"YES"}. The word JSON is required.',
        },
        {
          role: "user",
          content: "Synthetic PEM AI diagnostic. Return the test schema values.",
        },
      ],
    });
    const parsed = JSON.parse(result.content) as { prospectName?: string; outcome?: string };
    const pass = parsed.prospectName === "Alex" && parsed.outcome === "YES";
    return {
      pass,
      model: result.model,
      api: result.api,
      reasoningEffort: effort,
      latencyMs: Date.now() - started,
      code: pass ? null : "PEM_NEAT_DIAGNOSTIC_MISMATCH",
      message: pass ? null : "Structured diagnostic response did not match expected test values.",
    };
  } catch (error) {
    return {
      pass: false,
      model,
      api: caps.api,
      reasoningEffort: effort,
      latencyMs: Date.now() - started,
      code: error instanceof AppError ? error.code : "PEM_NEAT_PROVIDER_ERROR",
      message: error instanceof AppError ? error.message : "PEM AI diagnostic failed",
    };
  }
}

/** Explicit PEM model resolution — no silent substitution. */
export function resolvePemNeatModelName(): string {
  const explicit = (process.env.PEM_NEAT_OPENAI_MODEL ?? "").trim();
  if (explicit) return explicit;
  const env = getEnv();
  // Default PEM model when unset (documented). Does not rewrite an explicit env value.
  const configured = (env.BAXTER_OPENAI_MODEL || env.OPENAI_MODEL || "").trim();
  return configured || "gpt-4o";
}

export function resolvePemNeatFallbackModel(): string | null {
  const raw = (process.env.PEM_NEAT_OPENAI_FALLBACK_MODEL ?? "").trim();
  return raw || null;
}

export function getPemNeatReasoningEffort(): OpenAiReasoningEffort {
  return parseReasoningEffort(process.env.PEM_NEAT_REASONING_EFFORT, "medium");
}

export function getPemNeatStageTimeoutMs(): number {
  const raw = process.env.PEM_NEAT_TIMEOUT_MS;
  if (raw && /^\d+$/.test(raw)) {
    return Math.min(Math.max(Number(raw), 30_000), 300_000);
  }
  // GPT-5.4 reasoning stages need substantial headroom.
  return 180_000;
}

/** Exported for unit tests — HTTP → PEM error mapping. */
export function mapPemOpenAiHttpErrorForTests(
  status: number,
  body: { error?: { message?: string; code?: string; type?: string; param?: string } } | null,
) {
  return mapHttpToPemError(status, body);
}

/** Exported for unit tests — request body builders. */
export function buildPemProviderRequestForTests(
  model: string,
  maxOutputTokens: number,
  messages: PemOpenAiJsonRequest["messages"],
) {
  const caps = getOpenAiModelCapabilities(model);
  const input: PemOpenAiJsonRequest = {
    model,
    maxOutputTokens,
    messages,
    timeoutMs: 30_000,
    temperature: 0.25,
    reasoningEffort: getPemNeatReasoningEffort(),
  };
  if (caps.api === "responses") {
    return {
      api: "responses" as const,
      url: "https://api.openai.com/v1/responses",
      body: buildResponsesBody(input, caps),
      caps,
    };
  }
  return {
    api: "chat_completions" as const,
    url: "https://api.openai.com/v1/chat/completions",
    body: buildChatBody(input, caps),
    caps,
  };
}
