import "server-only";

import { getEnv } from "@/lib/env";
import {
  buildOpenAiJsonRequest,
  extractOpenAiResponsesText,
  type BuiltOpenAiJsonRequest,
} from "@/lib/openai/json-request";
import { parseBaxterLlmOutputLenient } from "./schemas";
import { buildBaxterSystemPrompt, buildBaxterUserPrompt } from "./prompts";
import {
  BaxterConfigError,
  BaxterProviderError,
  classifyOpenAiHttpError,
  isTemporaryOpenAiCode,
  logBaxterDiagnostic,
  type OpenAiErrorBody,
} from "./errors";
import { recordOpenAiCall } from "./openai-metrics";
import type { BaxterLLMProvider } from "./provider";
import type { BaxterLLMInput, BaxterLLMOutput } from "./types";

/** Max automatic retries for temporary provider failures (attempts = 1 + retries). */
const MAX_TEMPORARY_RETRIES = 2;
const DEFAULT_MAX_OUTPUT_TOKENS = 1200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredBackoff(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 15_000);
  }
  const base = 400 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(base + jitter, 8_000);
}

function resolvePrimaryModel(): string {
  const env = getEnv();
  // BAXTER_CHAT_MODEL is dedicated to Baxter Q&A (not PEM generation).
  return (
    env.BAXTER_CHAT_MODEL ||
    env.BAXTER_OPENAI_MODEL ||
    env.OPENAI_MODEL ||
    "gpt-4o-mini"
  ).trim();
}

function resolveFallbackModel(): string | null {
  const env = getEnv();
  const fallback = (env.BAXTER_OPENAI_FALLBACK_MODEL ?? "").trim();
  if (!fallback) return null;
  const primary = resolvePrimaryModel();
  if (fallback === primary) return null;
  return fallback;
}

function ensureStringContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

/**
 * Build the capability-aware OpenAI request for Baxter Q&A (exported for tests).
 */
export function buildBaxterOpenAiRequest(input: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}): BuiltOpenAiJsonRequest {
  return buildOpenAiJsonRequest({
    model: input.model,
    maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: input.temperature ?? 0.3,
    jsonObject: true,
    messages: [
      { role: "system", content: ensureStringContent(input.systemPrompt) },
      { role: "user", content: ensureStringContent(input.userPrompt) },
    ],
  });
}

function extractChatContent(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const choices = data.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

function extractUsage(data: Record<string, unknown> | null, api: "responses" | "chat_completions") {
  if (!data || typeof data.usage !== "object" || !data.usage) {
    return { inputTokens: null as number | null, outputTokens: null as number | null };
  }
  const usage = data.usage as Record<string, unknown>;
  if (api === "responses") {
    return {
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    };
  }
  return {
    inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
  };
}

/**
 * OpenAI Baxter provider — capability-aware Responses API (GPT-5.x) or Chat Completions (GPT-4o).
 */
export class OpenAIBaxterProvider implements BaxterLLMProvider {
  readonly key = "openai" as const;
  readonly name = "OpenAI";
  readonly model: string;

  constructor(model?: string) {
    this.model = (model ?? resolvePrimaryModel()).trim();
  }

  async generateAnswer(input: BaxterLLMInput): Promise<BaxterLLMOutput> {
    const env = getEnv();
    const apiKey = (env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new BaxterConfigError(
        "OPENAI_API_KEY is not configured. Add it to enable Baxter chat.",
        "BAXTER_OPENAI_KEY_MISSING",
      );
    }

    const primaryModel = this.model || resolvePrimaryModel();
    const fallbackModel = resolveFallbackModel();
    let activeModel = primaryModel;
    let usedFallback = false;
    let retryCount = 0;
    let fallbackAttempted = false;

    const started = Date.now();
    let attempt = 0;

    const systemPrompt = buildBaxterSystemPrompt(input.question);
    const userPrompt = buildBaxterUserPrompt(input);

    while (attempt <= MAX_TEMPORARY_RETRIES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.EXTERNAL_API_TIMEOUT_MS);
      try {
        const built = buildBaxterOpenAiRequest({
          model: activeModel,
          systemPrompt,
          userPrompt,
        });

        const response = await fetch(built.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(built.body),
          signal: controller.signal,
        });

        const providerRequestId =
          response.headers.get("x-request-id") ?? response.headers.get("openai-request-id");
        const text = await response.text();
        let data: (OpenAiErrorBody & Record<string, unknown>) | null = null;
        try {
          data = text ? (JSON.parse(text) as OpenAiErrorBody & Record<string, unknown>) : null;
        } catch {
          data = null;
        }

        if (!response.ok) {
          const classified = classifyOpenAiHttpError(response.status, data, response.headers);
          const openaiParam =
            data && typeof data.error === "object" && data.error
              ? ((data.error as { param?: string }).param ?? null)
              : null;
          const openaiCode =
            data && typeof data.error === "object" && data.error
              ? ((data.error as { code?: string }).code ?? null)
              : null;

          logBaxterDiagnostic("openaiProvider", {
            code: classified.code,
            route: "OpenAIBaxterProvider.generateAnswer",
            safeMessage: JSON.stringify({
              stage: "llm_request",
              httpStatus: response.status,
              model: activeModel,
              api: built.api,
              openaiCode,
              openaiParam,
              messageCount: 2,
              approxInputChars: systemPrompt.length + userPrompt.length,
              sourceKinds: [
                ...new Set(input.contextItems.map((c) => c.sourceType).filter(Boolean)),
              ],
            }),
          });

          // One optional fallback model for temporary model-specific limits only.
          // Do not fall back on deterministic BAD_REQUEST (wrong request contract).
          if (
            !fallbackAttempted &&
            fallbackModel &&
            isTemporaryOpenAiCode(classified.code) &&
            (classified.code === "BAXTER_OPENAI_RATE_LIMITED" ||
              classified.code === "BAXTER_OPENAI_TOKEN_LIMITED" ||
              classified.code === "BAXTER_OPENAI_SERVICE_UNAVAILABLE")
          ) {
            fallbackAttempted = true;
            usedFallback = true;
            activeModel = fallbackModel;
            attempt = 0;
            continue;
          }

          if (classified.retryable && attempt < MAX_TEMPORARY_RETRIES) {
            attempt += 1;
            retryCount += 1;
            await sleep(jitteredBackoff(attempt, classified.retryAfterSeconds));
            continue;
          }

          recordOpenAiCall({
            at: new Date().toISOString(),
            ok: false,
            code: classified.code,
            httpStatus: response.status,
            latencyMs: Date.now() - started,
            model: activeModel,
            retryCount,
            providerRequestId,
            inputTokens: null,
            outputTokens: null,
            usedFallback,
          });

          if (classified.code === "BAXTER_OPENAI_AUTH_FAILED") {
            throw new BaxterConfigError(classified.message, classified.code);
          }
          throw new BaxterProviderError(classified.message, {
            code: classified.code,
            statusCode: response.status,
            retryable: classified.retryable,
            retryAfterSeconds: classified.retryAfterSeconds,
            providerRequestId,
            details: {
              api: built.api,
              model: activeModel,
              openaiCode,
              openaiParam,
            },
          });
        }

        // Incomplete Responses API
        if (built.api === "responses" && data && data.status === "incomplete") {
          const reason =
            data.incomplete_details &&
            typeof data.incomplete_details === "object" &&
            data.incomplete_details
              ? String((data.incomplete_details as { reason?: string }).reason ?? "incomplete")
              : "incomplete";
          const code =
            reason === "max_output_tokens"
              ? "BAXTER_OPENAI_OUTPUT_TRUNCATED"
              : "BAXTER_OPENAI_MALFORMED_RESPONSE";
          recordOpenAiCall({
            at: new Date().toISOString(),
            ok: false,
            code,
            httpStatus: response.status,
            latencyMs: Date.now() - started,
            model: activeModel,
            retryCount,
            providerRequestId,
            inputTokens: null,
            outputTokens: null,
            usedFallback,
          });
          throw new BaxterProviderError(
            reason === "max_output_tokens"
              ? "OpenAI truncated the answer before it finished"
              : "OpenAI returned an incomplete response",
            { code, providerRequestId },
          );
        }

        const content =
          built.api === "responses"
            ? extractOpenAiResponsesText(data ?? {})
            : extractChatContent(data);

        if (!content) {
          recordOpenAiCall({
            at: new Date().toISOString(),
            ok: false,
            code: "BAXTER_OPENAI_MALFORMED_RESPONSE",
            httpStatus: response.status,
            latencyMs: Date.now() - started,
            model: activeModel,
            retryCount,
            providerRequestId,
            inputTokens: null,
            outputTokens: null,
            usedFallback,
          });
          throw new BaxterProviderError("OpenAI returned an empty completion", {
            code: "BAXTER_OPENAI_MALFORMED_RESPONSE",
            providerRequestId,
          });
        }

        const parsed = parseBaxterLlmOutputLenient(content);
        const latencyMs = Date.now() - started;
        const usage = extractUsage(data, built.api);
        const inputTokens = usage.inputTokens;
        const outputTokens = usage.outputTokens;

        if (parsed.structured) {
          recordOpenAiCall({
            at: new Date().toISOString(),
            ok: true,
            code: null,
            httpStatus: response.status,
            latencyMs,
            model: activeModel,
            retryCount,
            providerRequestId,
            inputTokens,
            outputTokens,
            usedFallback,
          });
          return {
            answer: parsed.structured.answer.trim(),
            usedSourceNumbers: parsed.structured.usedSourceNumbers,
            confidence: parsed.structured.confidence,
            insufficientKnowledge: parsed.structured.insufficientKnowledge,
            answerMode: parsed.structured.answerMode,
            modelProvider: this.key,
            modelName: activeModel,
            inputTokens,
            outputTokens,
            latencyMs,
          };
        }

        if (parsed.textFallback) {
          recordOpenAiCall({
            at: new Date().toISOString(),
            ok: true,
            code: null,
            httpStatus: response.status,
            latencyMs,
            model: activeModel,
            retryCount,
            providerRequestId,
            inputTokens,
            outputTokens,
            usedFallback,
          });
          return {
            answer: parsed.textFallback,
            usedSourceNumbers: [],
            confidence: "medium",
            insufficientKnowledge: false,
            answerMode: "general",
            modelProvider: this.key,
            modelName: activeModel,
            inputTokens,
            outputTokens,
            latencyMs,
            rawTextFallback: true,
          };
        }

        throw new BaxterProviderError("OpenAI returned an invalid structured response", {
          code: "BAXTER_OPENAI_MALFORMED_RESPONSE",
          providerRequestId,
        });
      } catch (error) {
        if (error instanceof BaxterConfigError || error instanceof BaxterProviderError) {
          throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
          if (attempt < MAX_TEMPORARY_RETRIES) {
            attempt += 1;
            retryCount += 1;
            await sleep(jitteredBackoff(attempt, null));
            continue;
          }
          recordOpenAiCall({
            at: new Date().toISOString(),
            ok: false,
            code: "BAXTER_OPENAI_TIMEOUT",
            httpStatus: null,
            latencyMs: Date.now() - started,
            model: activeModel,
            retryCount,
            providerRequestId: null,
            inputTokens: null,
            outputTokens: null,
            usedFallback,
          });
          throw new BaxterProviderError("OpenAI request timed out", {
            code: "BAXTER_OPENAI_TIMEOUT",
            retryable: true,
            cause: error,
          });
        }
        if (attempt < MAX_TEMPORARY_RETRIES) {
          attempt += 1;
          retryCount += 1;
          await sleep(jitteredBackoff(attempt, null));
          continue;
        }
        recordOpenAiCall({
          at: new Date().toISOString(),
          ok: false,
          code: "BAXTER_UNKNOWN_ERROR",
          httpStatus: null,
          latencyMs: Date.now() - started,
          model: activeModel,
          retryCount,
          providerRequestId: null,
          inputTokens: null,
          outputTokens: null,
          usedFallback,
        });
        throw new BaxterProviderError("OpenAI request failed after retries", {
          code: "BAXTER_UNKNOWN_ERROR",
          cause: error,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    throw new BaxterProviderError("OpenAI request failed after retries", {
      code: "BAXTER_UNKNOWN_ERROR",
    });
  }
}

/** @deprecated Import from `@/lib/baxter-ai/providers` instead. */
export { getBaxterLlmProvider } from "./providers";
