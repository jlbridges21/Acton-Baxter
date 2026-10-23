/**
 * Provider-agnostic model access for AI Workforce agents.
 *
 * - A curated, capability-aware catalog drives the model selector; admins may also enter
 *   another model ID, which is verified against the provider before it can be published.
 * - API keys stay server-side (env). The browser only ever sees "configured: yes/no".
 * - Fallback to another provider happens only when an admin configured one, and only for
 *   temporary failures (timeouts, 429, 5xx). Config/auth errors surface as errors.
 */

import "server-only";

import { getEnv } from "@/lib/env";
import { buildOpenAiJsonRequest, extractOpenAiResponsesText } from "@/lib/openai/json-request";
import type { AgentModelConfig, EffortLevel, ModelProvider } from "./types";

export type ModelCatalogEntry = {
  provider: ModelProvider;
  id: string;
  label: string;
  tier: "most capable" | "balanced" | "fast";
  supportsEffort: boolean;
  supportsJsonMode: boolean;
  maxOutputTokens: number;
  /** USD per 1M tokens. `estimated` prices are approximations for dashboards only. */
  pricing: { input: number; output: number; estimated: boolean } | null;
  note?: string;
};

// Anthropic prices from the Claude API reference (cached 2026-10-06).
// OpenAI prices are list-price estimates; verify against your OpenAI invoice.
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    provider: "anthropic",
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    tier: "most capable",
    supportsEffort: true,
    supportsJsonMode: false,
    maxOutputTokens: 32000,
    pricing: { input: 4, output: 20, estimated: false },
    note: "Recommended default for specialists.",
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    tier: "balanced",
    supportsEffort: true,
    supportsJsonMode: false,
    maxOutputTokens: 32000,
    pricing: { input: 2, output: 10, estimated: false },
  },
  {
    provider: "anthropic",
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    tier: "fast",
    supportsEffort: true,
    supportsJsonMode: false,
    maxOutputTokens: 32000,
    pricing: { input: 0.1, output: 0.5, estimated: false },
  },
  {
    provider: "anthropic",
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    tier: "most capable",
    supportsEffort: true,
    supportsJsonMode: false,
    maxOutputTokens: 32000,
    pricing: { input: 10, output: 50, estimated: false },
    note: "Highest capability and cost; long turns.",
  },
  {
    provider: "openai",
    id: "gpt-5",
    label: "GPT-5",
    tier: "most capable",
    supportsEffort: true,
    supportsJsonMode: true,
    maxOutputTokens: 32000,
    pricing: { input: 1.25, output: 10, estimated: true },
  },
  {
    provider: "openai",
    id: "gpt-5-mini",
    label: "GPT-5 mini",
    tier: "balanced",
    supportsEffort: true,
    supportsJsonMode: true,
    maxOutputTokens: 32000,
    pricing: { input: 0.25, output: 2, estimated: true },
  },
  {
    provider: "openai",
    id: "gpt-4.1",
    label: "GPT-4.1",
    tier: "balanced",
    supportsEffort: false,
    supportsJsonMode: true,
    maxOutputTokens: 32000,
    pricing: { input: 2, output: 8, estimated: true },
  },
  {
    provider: "openai",
    id: "gpt-4o",
    label: "GPT-4o",
    tier: "balanced",
    supportsEffort: false,
    supportsJsonMode: true,
    maxOutputTokens: 16000,
    pricing: { input: 2.5, output: 10, estimated: true },
  },
  {
    provider: "openai",
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    tier: "fast",
    supportsEffort: false,
    supportsJsonMode: true,
    maxOutputTokens: 16000,
    pricing: { input: 0.15, output: 0.6, estimated: true },
  },
];

export function findCatalogModel(provider: string, id: string): ModelCatalogEntry | null {
  return MODEL_CATALOG.find((m) => m.provider === provider && m.id === id) ?? null;
}

/** Capabilities for any model ID, including ones outside the catalog (conservative guesses). */
export function modelCapabilities(provider: ModelProvider, id: string) {
  const known = findCatalogModel(provider, id);
  if (known) return known;
  const lower = id.toLowerCase();
  const openAiReasoning = lower.startsWith("gpt-5") || /^o[0-9]/.test(lower);
  return {
    provider,
    id,
    label: id,
    tier: "balanced" as const,
    supportsEffort:
      provider === "openai"
        ? openAiReasoning
        : /claude-(opus|sonnet|haiku|fable)-[5-9]/.test(lower),
    supportsJsonMode: provider === "openai",
    maxOutputTokens: 8000,
    pricing: null,
  };
}

export function estimateCostUsd(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const entry = findCatalogModel(provider, model);
  if (!entry?.pricing) return null;
  return (inputTokens * entry.pricing.input + outputTokens * entry.pricing.output) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Provider status (no secrets)
// ---------------------------------------------------------------------------

export type ProviderStatus = { provider: ModelProvider; label: string; configured: boolean };

export function getProviderStatuses(): ProviderStatus[] {
  let openai = false;
  let anthropic = false;
  try {
    const env = getEnv();
    openai = Boolean(env.OPENAI_API_KEY?.trim());
    anthropic = Boolean(env.ANTHROPIC_API_KEY?.trim());
  } catch {
    // Misconfigured env: report both as not configured.
  }
  return [
    { provider: "anthropic", label: "Anthropic (Claude)", configured: anthropic },
    { provider: "openai", label: "OpenAI", configured: openai },
  ];
}

function apiKey(provider: ModelProvider): string {
  const env = getEnv();
  const key = provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY;
  if (!key?.trim()) {
    throw new ModelCallError(
      `${provider === "openai" ? "OpenAI" : "Anthropic"} is not configured on this deployment. An administrator must add the API key in Vercel.`,
      { code: "PROVIDER_NOT_CONFIGURED", provider, retryable: false },
    );
  }
  return key.trim();
}

/**
 * Connection test via the providers' free model-lookup endpoints — no tokens are spent.
 * When `model` is given, also confirms that model ID exists for this account.
 */
export async function testProviderConnection(
  provider: ModelProvider,
  model?: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const key = apiKey(provider);
    const path = model ? `/v1/models/${encodeURIComponent(model)}` : "/v1/models";
    const response = await fetch(
      provider === "openai" ? `https://api.openai.com${path}` : `https://api.anthropic.com${path}`,
      {
        headers:
          provider === "openai"
            ? { Authorization: `Bearer ${key}` }
            : { "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok) {
      return { ok: true, message: model ? `Connected. ${model} is available.` : "Connected." };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: "The provider rejected the API key." };
    }
    if (response.status === 404 && model) {
      return { ok: false, message: `The provider does not recognize the model "${model}".` };
    }
    return { ok: false, message: `The provider returned HTTP ${response.status}.` };
  } catch (error) {
    if (error instanceof ModelCallError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not reach the provider." };
  }
}

// ---------------------------------------------------------------------------
// Calling a model
// ---------------------------------------------------------------------------

export class ModelCallError extends Error {
  readonly code: string;
  readonly provider: ModelProvider;
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(
    message: string,
    opts: { code: string; provider: ModelProvider; retryable: boolean; status?: number | null },
  ) {
    super(message);
    this.name = "ModelCallError";
    this.code = opts.code;
    this.provider = opts.provider;
    this.retryable = opts.retryable;
    this.status = opts.status ?? null;
  }
}

export type ModelMessage = { role: "user" | "assistant"; content: string };

export type ModelCallInput = {
  provider: ModelProvider;
  model: string;
  system: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
  effort: EffortLevel | null;
  timeoutMs: number;
  /** Images attached to the final user message (vision). Anthropic only. */
  images?: Array<{
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    base64: string;
  }>;
};

export type ModelCallOutput = {
  text: string;
  provider: ModelProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type ModelCaller = (input: ModelCallInput) => Promise<ModelCallOutput>;

let testCaller: ModelCaller | null = null;

/** Unit tests inject a deterministic model; production never uses this. */
export function setModelCallerForTests(caller: ModelCaller | null): void {
  testCaller = caller;
}

function classifyHttp(provider: ModelProvider, status: number, message: string): ModelCallError {
  if (status === 401 || status === 403) {
    return new ModelCallError(`The ${provider} API key was rejected.`, {
      code: "PROVIDER_AUTH_FAILED",
      provider,
      retryable: false,
      status,
    });
  }
  if (status === 404) {
    return new ModelCallError(`The ${provider} model was not found: ${message}`, {
      code: "MODEL_NOT_FOUND",
      provider,
      retryable: false,
      status,
    });
  }
  const retryable = status === 408 || status === 429 || status >= 500;
  return new ModelCallError(`${provider} request failed (${status}): ${message}`, {
    code: retryable ? "PROVIDER_TEMPORARY" : "PROVIDER_BAD_REQUEST",
    provider,
    retryable,
    status,
  });
}

async function postJson(
  provider: ModelProvider,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timeout = error instanceof Error && /timeout|abort/i.test(error.name + error.message);
    throw new ModelCallError(
      timeout ? `${provider} request timed out` : `${provider} unreachable`,
      {
        code: timeout ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE",
        provider,
        retryable: true,
      },
    );
  }
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const err = data.error as { message?: string } | undefined;
    throw classifyHttp(provider, response.status, err?.message ?? raw.slice(0, 200));
  }
  return data;
}

async function callOpenAi(input: ModelCallInput): Promise<ModelCallOutput> {
  if (input.images?.length) {
    throw new ModelCallError("Image analysis uses an Anthropic (Claude) model.", {
      code: "VISION_UNSUPPORTED",
      provider: "openai",
      retryable: false,
    });
  }
  const key = apiKey("openai");
  const started = Date.now();
  const caps = modelCapabilities("openai", input.model);
  const built = buildOpenAiJsonRequest({
    model: input.model,
    messages: [{ role: "system", content: input.system }, ...input.messages],
    maxOutputTokens: input.maxOutputTokens,
    jsonObject: true,
    ...(caps.supportsEffort && input.effort ? { reasoningEffort: input.effort } : {}),
  });
  const data = await postJson(
    "openai",
    built.url,
    { Authorization: `Bearer ${key}` },
    built.body,
    input.timeoutMs,
  );
  let textOut: string | null;
  let inputTokens = 0;
  let outputTokens = 0;
  if (built.api === "responses") {
    textOut = extractOpenAiResponsesText(data);
    const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    inputTokens = usage?.input_tokens ?? 0;
    outputTokens = usage?.output_tokens ?? 0;
  } else {
    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    textOut = choices?.[0]?.message?.content ?? null;
    const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    inputTokens = usage?.prompt_tokens ?? 0;
    outputTokens = usage?.completion_tokens ?? 0;
  }
  if (!textOut?.trim()) {
    throw new ModelCallError("OpenAI returned an empty response.", {
      code: "PROVIDER_EMPTY",
      provider: "openai",
      retryable: true,
    });
  }
  return {
    text: textOut,
    provider: "openai",
    model: input.model,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
  };
}

/** Put image blocks before the text of the last user message (Anthropic content blocks). */
function withImages(messages: ModelMessage[], images: NonNullable<ModelCallInput["images"]>) {
  const last = messages.length - 1;
  return messages.map((m, i) =>
    i === last && m.role === "user"
      ? {
          role: m.role,
          content: [
            ...images.map((img) => ({
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data: img.base64 },
            })),
            { type: "text", text: m.content },
          ],
        }
      : m,
  );
}

async function callAnthropic(input: ModelCallInput): Promise<ModelCallOutput> {
  const key = apiKey("anthropic");
  const started = Date.now();
  const caps = modelCapabilities("anthropic", input.model);
  // No sampling parameters: current Claude models reject non-default temperature/top_p/top_k.
  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.maxOutputTokens,
    system: input.system,
    messages: input.images?.length ? withImages(input.messages, input.images) : input.messages,
  };
  if (caps.supportsEffort && input.effort) body.output_config = { effort: input.effort };
  const data = await postJson(
    "anthropic",
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    body,
    input.timeoutMs,
  );
  if (data.stop_reason === "refusal") {
    throw new ModelCallError("The model declined this request.", {
      code: "MODEL_REFUSED",
      provider: "anthropic",
      retryable: false,
    });
  }
  const blocks = (data.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
  const textOut = blocks
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!textOut) {
    throw new ModelCallError(
      data.stop_reason === "max_tokens"
        ? "The model ran out of output tokens. Increase the maximum response length."
        : "Anthropic returned an empty response.",
      {
        code: "PROVIDER_EMPTY",
        provider: "anthropic",
        retryable: data.stop_reason !== "max_tokens",
      },
    );
  }
  const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  return {
    text: textOut,
    provider: "anthropic",
    model: input.model,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
}

async function callOnce(input: ModelCallInput): Promise<ModelCallOutput> {
  if (testCaller) return testCaller(input);
  return input.provider === "openai" ? callOpenAi(input) : callAnthropic(input);
}

/** A single model call (used for attachment analysis). Honors the test caller. */
export function callModelDirect(input: ModelCallInput): Promise<ModelCallOutput> {
  return callOnce(input);
}

/** Resolve the effective provider/model for an agent ("environment" uses Baxter's env config). */
export function resolveModelTarget(config: AgentModelConfig): {
  provider: ModelProvider;
  model: string;
} {
  if (config.source === "environment") {
    // Same resolution as Baxter's own provider (src/lib/baxter-ai/providers.ts), read directly so
    // agent routes don't pull in Baxter's prompt/governance modules.
    const env = getEnv();
    const provider: ModelProvider =
      (env.BAXTER_LLM_PROVIDER || "openai").toLowerCase().trim() === "anthropic"
        ? "anthropic"
        : "openai";
    const model =
      provider === "anthropic"
        ? env.BAXTER_ANTHROPIC_MODEL || env.ANTHROPIC_MODEL
        : env.BAXTER_CHAT_MODEL || env.BAXTER_OPENAI_MODEL || env.OPENAI_MODEL;
    return { provider, model: (model || config.model).trim() };
  }
  return { provider: config.provider, model: config.model };
}

export type ModelCallWithFallbackResult = ModelCallOutput & { usedFallback: boolean };

export async function callAgentModel(input: {
  config: AgentModelConfig;
  system: string;
  messages: ModelMessage[];
  timeoutMs: number;
  maxOutputTokens?: number;
}): Promise<ModelCallWithFallbackResult> {
  const target = resolveModelTarget(input.config);
  const base = {
    system: input.system,
    messages: input.messages,
    maxOutputTokens: input.maxOutputTokens ?? input.config.maxOutputTokens,
    effort: input.config.effort,
    timeoutMs: input.timeoutMs,
  };
  try {
    return { ...(await callOnce({ ...base, ...target })), usedFallback: false };
  } catch (error) {
    const fallback = input.config.fallback;
    if (!fallback || !(error instanceof ModelCallError) || !error.retryable) throw error;
    return { ...(await callOnce({ ...base, ...fallback })), usedFallback: true };
  }
}

/** Parse the first JSON object from model text (tolerates code fences and leading prose). */
export function parseJsonObject(textIn: string): Record<string, unknown> | null {
  const trimmed = textIn
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}
