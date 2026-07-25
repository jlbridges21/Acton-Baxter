import "server-only";

import { getEnv } from "@/lib/env";
import { BaxterConfigError, BaxterProviderError, isTemporaryOpenAiCode } from "./errors";
import { OpenAIBaxterProvider } from "./openai-provider";
import { AnthropicBaxterProvider } from "./anthropic-provider";
import type { BaxterLLMProvider } from "./provider";
import type { BaxterLLMInput, BaxterLLMOutput, BaxterLlmProviderName } from "./types";

function createProvider(name: string): BaxterLLMProvider {
  const key = name.toLowerCase().trim();
  if (key === "openai") return new OpenAIBaxterProvider();
  if (key === "anthropic") return new AnthropicBaxterProvider();
  throw new BaxterConfigError(
    `Unsupported BAXTER_LLM_PROVIDER: ${name}`,
    "BAXTER_OPENAI_BAD_REQUEST",
  );
}

/**
 * Wraps primary + optional fallback provider.
 * Fallback only for temporary provider outages — not config/auth/safety failures.
 */
export class FallbackBaxterProvider implements BaxterLLMProvider {
  readonly key: BaxterLlmProviderName;
  readonly name: string;
  private readonly primary: BaxterLLMProvider;
  private readonly fallback: BaxterLLMProvider | null;

  constructor(primary: BaxterLLMProvider, fallback: BaxterLLMProvider | null) {
    this.primary = primary;
    this.fallback = fallback;
    this.key = primary.key;
    this.name = fallback ? `${primary.name} (fallback: ${fallback.name})` : primary.name;
  }

  async generateAnswer(input: BaxterLLMInput): Promise<BaxterLLMOutput> {
    try {
      return await this.primary.generateAnswer(input);
    } catch (error) {
      if (!this.fallback) throw error;
      if (error instanceof BaxterConfigError) throw error;
      if (error instanceof BaxterProviderError) {
        const eligible =
          error.retryable ||
          isTemporaryOpenAiCode(error.code) ||
          /SERVICE_UNAVAILABLE|TIMEOUT|RATE_LIMITED|TOKEN_LIMITED/i.test(error.code);
        if (!eligible) throw error;
        return this.fallback.generateAnswer(input);
      }
      // Unknown network errors may fall back
      return this.fallback.generateAnswer(input);
    }
  }
}

/**
 * Resolve Baxter reasoning provider from env.
 * AI_PROVIDER (Property Research) is intentionally ignored here.
 */
export function getBaxterLlmProvider(): BaxterLLMProvider {
  const env = getEnv();
  const primaryName = (env.BAXTER_LLM_PROVIDER || "openai").toLowerCase().trim();
  const fallbackName = (env.BAXTER_LLM_FALLBACK_PROVIDER || "").toLowerCase().trim();

  const primary = createProvider(primaryName);
  if (!fallbackName || fallbackName === primaryName) {
    return primary;
  }
  try {
    const fallback = createProvider(fallbackName);
    return new FallbackBaxterProvider(primary, fallback);
  } catch {
    return primary;
  }
}

export function getBaxterProviderDiagnostics(): {
  reasoningProvider: string;
  reasoningModel: string;
  fallbackProvider: string | null;
  fallbackModel: string | null;
  embeddingProvider: string;
  embeddingModel: string;
  visionProvider: string;
  visionModel: string;
  propertyResearchAiProvider: string;
} {
  const env = getEnv();
  const reasoningProvider = (env.BAXTER_LLM_PROVIDER || "openai").toLowerCase().trim();
  const fallbackProvider = (env.BAXTER_LLM_FALLBACK_PROVIDER || "").trim() || null;
  return {
    reasoningProvider,
    reasoningModel:
      reasoningProvider === "anthropic"
        ? env.BAXTER_ANTHROPIC_MODEL || env.ANTHROPIC_MODEL
        : env.BAXTER_OPENAI_MODEL || env.OPENAI_MODEL,
    fallbackProvider,
    fallbackModel: fallbackProvider
      ? fallbackProvider === "anthropic"
        ? env.BAXTER_ANTHROPIC_MODEL || env.ANTHROPIC_MODEL
        : env.BAXTER_OPENAI_MODEL || env.OPENAI_MODEL
      : null,
    embeddingProvider: env.BAXTER_EMBEDDING_PROVIDER || "openai",
    embeddingModel: env.BAXTER_EMBEDDING_MODEL || "text-embedding-3-small",
    visionProvider: env.BAXTER_VISION_PROVIDER || "openai",
    visionModel: env.BAXTER_VISION_MODEL || env.BAXTER_OPENAI_MODEL || env.OPENAI_MODEL,
    propertyResearchAiProvider: env.AI_PROVIDER,
  };
}
