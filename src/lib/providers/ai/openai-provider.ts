import "server-only";

import { getEnv } from "@/lib/env";
import { AiProviderError, sanitizeAiErrorMessage } from "./errors";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { aiReportContentSchema, type AiReportContent } from "./schemas";
import type { AiReportGenerator, SanitizedAiInput } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAiReportProvider implements AiReportGenerator {
  readonly key = "openai" as const;
  readonly name = "OpenAI";
  readonly model: string;

  constructor(model?: string) {
    this.model = model ?? getEnv().OPENAI_MODEL;
  }

  async generate(input: SanitizedAiInput): Promise<AiReportContent> {
    const env = getEnv();
    if (!env.OPENAI_API_KEY) {
      throw new AiProviderError("OPENAI_API_KEY is not configured", {
        provider: this.key,
        statusCode: 500,
      });
    }

    const body = {
      model: this.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(input) },
      ],
    };

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
        let data: unknown = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }

        if (response.status === 401 || response.status === 403) {
          throw new AiProviderError(`OpenAI authorization failed (${response.status})`, {
            provider: this.key,
            statusCode: response.status,
          });
        }

        if (response.status === 429 || response.status >= 500) {
          if (attempt < env.EXTERNAL_API_MAX_RETRIES) {
            attempt += 1;
            await sleep(300 * 2 ** attempt);
            continue;
          }
          throw new AiProviderError(`OpenAI temporary failure (${response.status})`, {
            provider: this.key,
            statusCode: response.status,
            retryable: true,
          });
        }

        if (!response.ok) {
          throw new AiProviderError(
            sanitizeAiErrorMessage(`OpenAI request failed (${response.status})`),
            { provider: this.key, statusCode: response.status },
          );
        }

        const record = data as {
          choices?: Array<{ message?: { content?: string } }>;
        } | null;
        const contentText = record?.choices?.[0]?.message?.content;
        if (!contentText) {
          throw new AiProviderError("OpenAI returned an empty completion", {
            provider: this.key,
          });
        }

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(contentText);
        } catch (error) {
          throw new AiProviderError("OpenAI returned non-JSON content", {
            provider: this.key,
            cause: error,
          });
        }

        const parsed = aiReportContentSchema.safeParse(parsedJson);
        if (!parsed.success) {
          throw new AiProviderError(
            `OpenAI output failed schema validation: ${parsed.error.issues[0]?.message ?? "invalid"}`,
            { provider: this.key, statusCode: 502 },
          );
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        if (attempt < env.EXTERNAL_API_MAX_RETRIES) {
          attempt += 1;
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw new AiProviderError(
          sanitizeAiErrorMessage(error instanceof Error ? error.message : "OpenAI request failed"),
          { provider: this.key, retryable: true, cause: error },
        );
      } finally {
        clearTimeout(timer);
      }
    }

    throw new AiProviderError("OpenAI request failed after retries", {
      provider: this.key,
      retryable: true,
    });
  }
}
