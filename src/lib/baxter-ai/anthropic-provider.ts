import "server-only";

import { getEnv } from "@/lib/env";
import { parseBaxterLlmOutputLenient } from "./schemas";
import { buildBaxterSystemPrompt, buildBaxterUserPrompt } from "./prompts";
import { BaxterConfigError, BaxterProviderError } from "./errors";
import type { BaxterLLMProvider } from "./provider";
import type { BaxterLLMInput, BaxterLLMOutput } from "./types";

function resolveAnthropicModel(): string {
  const env = getEnv();
  return (env.BAXTER_ANTHROPIC_MODEL || env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest").trim();
}

/**
 * Anthropic Messages API Baxter provider.
 */
export class AnthropicBaxterProvider implements BaxterLLMProvider {
  readonly key = "anthropic" as const;
  readonly name = "Anthropic";
  readonly model: string;

  constructor(model?: string) {
    this.model = (model ?? resolveAnthropicModel()).trim();
  }

  async generateAnswer(input: BaxterLLMInput): Promise<BaxterLLMOutput> {
    const env = getEnv();
    const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new BaxterConfigError(
        "ANTHROPIC_API_KEY is not configured. Add it to enable Anthropic as Baxter provider.",
        "BAXTER_ANTHROPIC_KEY_MISSING",
      );
    }

    const model = this.model || resolveAnthropicModel();
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.EXTERNAL_API_TIMEOUT_MS);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          temperature: 0.3,
          system: buildBaxterSystemPrompt(),
          messages: [{ role: "user", content: buildBaxterUserPrompt(input) }],
        }),
        signal: controller.signal,
      });

      const text = await response.text();
      type AnthropicResponse = {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { type?: string; message?: string };
      };
      let data: AnthropicResponse | null = null;
      try {
        data = text ? (JSON.parse(text) as AnthropicResponse) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const message = data?.error?.message || `Anthropic request failed (${response.status})`;
        if (response.status === 401 || response.status === 403) {
          throw new BaxterConfigError(message, "BAXTER_ANTHROPIC_AUTH_FAILED");
        }
        const retryable = response.status === 429 || response.status >= 500;
        throw new BaxterProviderError(message, {
          code: retryable ? "BAXTER_ANTHROPIC_SERVICE_UNAVAILABLE" : "BAXTER_ANTHROPIC_BAD_REQUEST",
          statusCode: response.status,
          retryable,
        });
      }

      const content = (data?.content ?? [])
        .filter((b: { type?: string; text?: string }) => b.type === "text" && b.text)
        .map((b: { type?: string; text?: string }) => b.text!)
        .join("\n")
        .trim();
      if (!content) {
        throw new BaxterProviderError("Anthropic returned an empty completion", {
          code: "BAXTER_ANTHROPIC_MALFORMED_RESPONSE",
        });
      }

      const parsed = parseBaxterLlmOutputLenient(content);
      const latencyMs = Date.now() - started;
      const inputTokens = data?.usage?.input_tokens ?? null;
      const outputTokens = data?.usage?.output_tokens ?? null;

      if (parsed.structured) {
        return {
          answer: parsed.structured.answer.trim(),
          usedSourceNumbers: parsed.structured.usedSourceNumbers,
          confidence: parsed.structured.confidence,
          insufficientKnowledge: parsed.structured.insufficientKnowledge,
          answerMode: parsed.structured.answerMode,
          modelProvider: this.key,
          modelName: model,
          inputTokens,
          outputTokens,
          latencyMs,
        };
      }
      if (parsed.textFallback) {
        return {
          answer: parsed.textFallback,
          usedSourceNumbers: [],
          confidence: "medium",
          insufficientKnowledge: false,
          answerMode: "general",
          modelProvider: this.key,
          modelName: model,
          inputTokens,
          outputTokens,
          latencyMs,
          rawTextFallback: true,
        };
      }
      throw new BaxterProviderError("Anthropic returned an invalid structured response", {
        code: "BAXTER_ANTHROPIC_MALFORMED_RESPONSE",
      });
    } catch (error) {
      if (error instanceof BaxterConfigError || error instanceof BaxterProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BaxterProviderError("Anthropic request timed out", {
          code: "BAXTER_ANTHROPIC_TIMEOUT",
          retryable: true,
          cause: error,
        });
      }
      throw new BaxterProviderError("Anthropic request failed", {
        code: "BAXTER_UNKNOWN_ERROR",
        cause: error,
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
