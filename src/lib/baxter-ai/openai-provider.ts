import "server-only";

import { getEnv } from "@/lib/env";
import { parseBaxterLlmJson } from "./schemas";
import { buildBaxterSystemPrompt, buildBaxterUserPrompt } from "./prompts";
import { BaxterConfigError, BaxterProviderError } from "./errors";
import type { BaxterLLMProvider } from "./provider";
import type { BaxterLLMInput, BaxterLLMOutput } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenAI Baxter provider using the same HTTP chat/completions pattern as Property Research.
 * No separate OpenAI SDK is installed in this repository.
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
    if (!env.OPENAI_API_KEY) {
      throw new BaxterConfigError(
        "OPENAI_API_KEY is not configured. Add it to enable Baxter chat.",
      );
    }

    const body = {
      model: this.model,
      temperature: 0.2,
      max_tokens: 900,
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
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
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

        if (response.status === 401 || response.status === 403) {
          throw new BaxterConfigError("OpenAI authorization failed. Check OPENAI_API_KEY.");
        }

        if (response.status === 429 || response.status >= 500) {
          if (attempt < env.EXTERNAL_API_MAX_RETRIES) {
            attempt += 1;
            await sleep(300 * 2 ** attempt);
            continue;
          }
          throw new BaxterProviderError(`OpenAI temporary failure (${response.status})`, {
            statusCode: response.status,
            retryable: true,
          });
        }

        if (!response.ok) {
          throw new BaxterProviderError(`OpenAI request failed (${response.status})`, {
            statusCode: response.status,
          });
        }

        const content = data?.choices?.[0]?.message?.content?.trim();
        if (!content) {
          throw new BaxterProviderError("OpenAI returned an empty completion");
        }

        let structured;
        try {
          structured = parseBaxterLlmJson(content);
        } catch (firstError) {
          try {
            structured = parseBaxterLlmJson(repairJsonLike(content));
          } catch {
            throw new BaxterProviderError("OpenAI returned an invalid structured response", {
              cause: firstError,
            });
          }
        }

        return {
          answer: structured.answer.trim(),
          usedSourceNumbers: structured.usedSourceNumbers,
          confidence: structured.confidence,
          insufficientKnowledge: structured.insufficientKnowledge,
          modelProvider: this.key,
          modelName: this.model,
          inputTokens: data?.usage?.prompt_tokens ?? null,
          outputTokens: data?.usage?.completion_tokens ?? null,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        if (error instanceof BaxterConfigError || error instanceof BaxterProviderError) {
          throw error;
        }
        if (attempt < env.EXTERNAL_API_MAX_RETRIES) {
          attempt += 1;
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw new BaxterProviderError("OpenAI request failed after retries", { cause: error });
      } finally {
        clearTimeout(timer);
      }
    }

    throw new BaxterProviderError("OpenAI request failed after retries");
  }
}

function repairJsonLike(raw: string): string {
  return raw
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/(\w+)\s*:/g, '"$1":')
    .replace(/'/g, '"');
}

export function getBaxterLlmProvider(): BaxterLLMProvider {
  const env = getEnv();
  const provider = (env.BAXTER_LLM_PROVIDER || "openai").toLowerCase();
  if (provider === "openai") {
    return new OpenAIBaxterProvider();
  }
  if (provider === "anthropic") {
    throw new BaxterConfigError(
      "Anthropic is planned for a later release. Set BAXTER_LLM_PROVIDER=openai.",
    );
  }
  throw new BaxterConfigError(`Unsupported BAXTER_LLM_PROVIDER: ${provider}`);
}
