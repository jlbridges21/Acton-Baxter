import "server-only";

import { getEnv } from "@/lib/env";
import { AiProviderError, sanitizeAiErrorMessage } from "./errors";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { aiReportContentSchema, type AiReportContent } from "./schemas";
import type { AiReportGenerator, SanitizedAiInput } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTextContent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const content = (data as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts = content
    .map((block) => {
      if (!block || typeof block !== "object") return null;
      const record = block as { type?: string; text?: string };
      if (record.type === "text" && typeof record.text === "string") return record.text;
      return null;
    })
    .filter((value): value is string => Boolean(value));
  return texts.length > 0 ? texts.join("\n") : null;
}

export class AnthropicReportProvider implements AiReportGenerator {
  readonly key = "anthropic" as const;
  readonly name = "Anthropic";
  readonly model: string;

  constructor(model?: string) {
    this.model = model ?? getEnv().ANTHROPIC_MODEL;
  }

  async generate(input: SanitizedAiInput): Promise<AiReportContent> {
    const env = getEnv();
    if (!env.ANTHROPIC_API_KEY) {
      throw new AiProviderError("ANTHROPIC_API_KEY is not configured", {
        provider: this.key,
        statusCode: 500,
      });
    }

    const body = {
      model: this.model,
      max_tokens: 2048,
      temperature: 0.2,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    };

    let attempt = 0;
    while (attempt <= env.EXTERNAL_API_MAX_RETRIES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.EXTERNAL_API_TIMEOUT_MS);
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
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
          throw new AiProviderError(`Anthropic authorization failed (${response.status})`, {
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
          throw new AiProviderError(`Anthropic temporary failure (${response.status})`, {
            provider: this.key,
            statusCode: response.status,
            retryable: true,
          });
        }

        if (!response.ok) {
          throw new AiProviderError(
            sanitizeAiErrorMessage(`Anthropic request failed (${response.status})`),
            { provider: this.key, statusCode: response.status },
          );
        }

        const contentText = extractTextContent(data);
        if (!contentText) {
          throw new AiProviderError("Anthropic returned an empty completion", {
            provider: this.key,
          });
        }

        const jsonText = contentText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(jsonText);
        } catch (error) {
          throw new AiProviderError("Anthropic returned non-JSON content", {
            provider: this.key,
            cause: error,
          });
        }

        const parsed = aiReportContentSchema.safeParse(parsedJson);
        if (!parsed.success) {
          throw new AiProviderError(
            `Anthropic output failed schema validation: ${parsed.error.issues[0]?.message ?? "invalid"}`,
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
          sanitizeAiErrorMessage(
            error instanceof Error ? error.message : "Anthropic request failed",
          ),
          { provider: this.key, retryable: true, cause: error },
        );
      } finally {
        clearTimeout(timer);
      }
    }

    throw new AiProviderError("Anthropic request failed after retries", {
      provider: this.key,
      retryable: true,
    });
  }
}
