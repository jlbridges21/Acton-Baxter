/**
 * Central OpenAI model capability detection for Baxter / PEM.
 * Prefer capability flags over scattered model.startsWith checks.
 */

export type OpenAiApiSurface = "responses" | "chat_completions";

export type OpenAiOutputTokenParam = "max_output_tokens" | "max_completion_tokens" | "max_tokens";

export type OpenAiReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export type OpenAiModelCapabilities = {
  /** Preferred API for structured/reasoning workloads. */
  api: OpenAiApiSurface;
  supportsReasoningEffort: boolean;
  /** Whether custom temperature is safe to send. */
  supportsTemperature: boolean;
  outputTokenParam: OpenAiOutputTokenParam;
  supportsJsonObjectFormat: boolean;
  /** GPT-5 / o-series style reasoning family. */
  isReasoningFamily: boolean;
};

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

/** GPT-5.x, o1/o3/o4 reasoning models. */
export function isOpenAiReasoningFamily(model: string): boolean {
  const m = normalizeModelId(model);
  if (m.startsWith("gpt-5")) return true;
  if (/^o[0-9]/.test(m)) return true;
  if (m.includes("o1-") || m.includes("o3-") || m.includes("o4-")) return true;
  return false;
}

export function getOpenAiModelCapabilities(model: string): OpenAiModelCapabilities {
  const reasoning = isOpenAiReasoningFamily(model);
  if (reasoning) {
    return {
      api: "responses",
      supportsReasoningEffort: true,
      // Reasoning models often reject non-default temperature.
      supportsTemperature: false,
      outputTokenParam: "max_output_tokens",
      supportsJsonObjectFormat: true,
      isReasoningFamily: true,
    };
  }

  // GPT-4o / 4.1 / classic chat models
  return {
    api: "chat_completions",
    supportsReasoningEffort: false,
    supportsTemperature: true,
    outputTokenParam: "max_tokens",
    supportsJsonObjectFormat: true,
    isReasoningFamily: false,
  };
}

export function parseReasoningEffort(
  raw: string | null | undefined,
  fallback: OpenAiReasoningEffort = "medium",
): OpenAiReasoningEffort {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "none" || v === "low" || v === "medium" || v === "high" || v === "xhigh") {
    return v;
  }
  return fallback;
}
