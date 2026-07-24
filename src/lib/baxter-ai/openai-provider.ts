import "server-only";

import { getEnv } from "@/lib/env";
import { parseBaxterLlmOutputLenient } from "./schemas";
import { buildBaxterSystemPrompt, buildBaxterUserPrompt } from "./prompts";
import { BaxterConfigError, BaxterProviderError, classifyOpenAiHttpError } from "./errors";
import type { BaxterLLMProvider } from "./provider";
import type { BaxterLLMInput, BaxterLLMOutput } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenAI Baxter provider using HTTP chat/completions.
 */
export class OpenAIBaxterProvider implements BaxterLLMProvider {
  readonly key = "openai" as const;
  readonly name = "OpenAI";
  readonly model: string;

  constructor(model?: string) {
    const env = getEnv();
    this.model = (model ?? env.BAXTER_OPENAI_MODEL) || env.OPENAI_MODEL || "gpt-4o-mini";
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

    const body = {
      model: this.model,
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildBaxterSystemPrompt() },
        { role: "user", content: buildBaxterUserPrompt(input) },
      ],
    };

    const started = Date.now();
    let attempt = 0;
    while (attempt <= env.EXTERNAL_API_MAX_RETRIES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.EXTERNAL_API_TIMEOUT_MS);
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await response.text();
        type OpenAiChatResponse = {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: { message?: string };
        };
        let data: OpenAiChatResponse | null = null;
        try {
          data = text ? (JSON.parse(text) as OpenAiChatResponse) : null;
        } catch {
          data = null;
        }

        if (!response.ok) {
          const classified = classifyOpenAiHttpError(response.status);
          if (classified.retryable && attempt < env.EXTERNAL_API_MAX_RETRIES) {
            attempt += 1;
            await sleep(300 * 2 ** attempt);
            continue;
          }
          if (classified.code === "BAXTER_OPENAI_AUTH_FAILED") {
            throw new BaxterConfigError(classified.message, classified.code);
          }
          throw new BaxterProviderError(classified.message, {
            code: classified.code,
            statusCode: response.status,
            retryable: classified.retryable,
          });
        }

        const content = data?.choices?.[0]?.message?.content?.trim();
        if (!content) {
          throw new BaxterProviderError("OpenAI returned an empty completion", {
            code: "BAXTER_OPENAI_MALFORMED_RESPONSE",
          });
        }

        const parsed = parseBaxterLlmOutputLenient(content);
        if (parsed.structured) {
          return {
            answer: parsed.structured.answer.trim(),
            usedSourceNumbers: parsed.structured.usedSourceNumbers,
            confidence: parsed.structured.confidence,
            insufficientKnowledge: parsed.structured.insufficientKnowledge,
            answerMode: parsed.structured.answerMode,
            modelProvider: this.key,
            modelName: this.model,
            inputTokens: data?.usage?.prompt_tokens ?? null,
            outputTokens: data?.usage?.completion_tokens ?? null,
            latencyMs: Date.now() - started,
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
            modelName: this.model,
            inputTokens: data?.usage?.prompt_tokens ?? null,
            outputTokens: data?.usage?.completion_tokens ?? null,
            latencyMs: Date.now() - started,
            rawTextFallback: true,
          };
        }

        throw new BaxterProviderError("OpenAI returned an invalid structured response", {
          code: "BAXTER_OPENAI_MALFORMED_RESPONSE",
        });
      } catch (error) {
        if (error instanceof BaxterConfigError || error instanceof BaxterProviderError) {
          throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
          throw new BaxterProviderError("OpenAI request timed out", {
            code: "BAXTER_OPENAI_TIMEOUT",
            retryable: true,
            cause: error,
          });
        }
        if (attempt < env.EXTERNAL_API_MAX_RETRIES) {
          attempt += 1;
          await sleep(300 * 2 ** attempt);
          continue;
        }
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

export function getBaxterLlmProvider(): BaxterLLMProvider {
  const env = getEnv();
  const provider = (env.BAXTER_LLM_PROVIDER || "openai").toLowerCase().trim();
  if (provider === "openai") {
    return new OpenAIBaxterProvider();
  }
  if (provider === "anthropic") {
    throw new BaxterConfigError(
      "Anthropic is planned for a later release. Set BAXTER_LLM_PROVIDER=openai.",
      "BAXTER_OPENAI_BAD_REQUEST",
    );
  }
  throw new BaxterConfigError(
    `Unsupported BAXTER_LLM_PROVIDER: ${provider}`,
    "BAXTER_OPENAI_BAD_REQUEST",
  );
}
