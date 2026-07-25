import "server-only";

import { getEnv } from "@/lib/env";
import { parseBaxterLlmOutputLenient } from "./schemas";
import { buildBaxterSystemPrompt, buildBaxterUserPrompt } from "./prompts";
import {
  BaxterConfigError,
  BaxterProviderError,
  classifyOpenAiHttpError,
  isTemporaryOpenAiCode,
  type OpenAiErrorBody,
} from "./errors";
import { recordOpenAiCall } from "./openai-metrics";
import type { BaxterLLMProvider } from "./provider";
import type { BaxterLLMInput, BaxterLLMOutput } from "./types";

/** Max automatic retries for temporary provider failures (attempts = 1 + retries). */
const MAX_TEMPORARY_RETRIES = 2;

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
  return (env.BAXTER_OPENAI_MODEL || env.OPENAI_MODEL || "gpt-4o-mini").trim();
}

function resolveFallbackModel(): string | null {
  const env = getEnv();
  const fallback = (env.BAXTER_OPENAI_FALLBACK_MODEL ?? "").trim();
  if (!fallback) return null;
  const primary = resolvePrimaryModel();
  if (fallback === primary) return null;
  return fallback;
}

/**
 * OpenAI Baxter provider using HTTP chat/completions.
 * Use getBaxterLlmProvider from ./providers for primary + fallback resolution.
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

    while (attempt <= MAX_TEMPORARY_RETRIES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.EXTERNAL_API_TIMEOUT_MS);
      try {
        const body = {
          model: activeModel,
          temperature: 0.3,
          max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildBaxterSystemPrompt() },
            { role: "user", content: buildBaxterUserPrompt(input) },
          ],
        };

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const providerRequestId =
          response.headers.get("x-request-id") ?? response.headers.get("openai-request-id");
        const text = await response.text();
        type OpenAiChatResponse = OpenAiErrorBody & {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          model?: string;
        };
        let data: OpenAiChatResponse | null = null;
        try {
          data = text ? (JSON.parse(text) as OpenAiChatResponse) : null;
        } catch {
          data = null;
        }

        if (!response.ok) {
          const classified = classifyOpenAiHttpError(response.status, data, response.headers);

          // One optional fallback model for temporary model-specific limits only.
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
          });
        }

        const content = data?.choices?.[0]?.message?.content?.trim();
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
        const inputTokens = data?.usage?.prompt_tokens ?? null;
        const outputTokens = data?.usage?.completion_tokens ?? null;

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
