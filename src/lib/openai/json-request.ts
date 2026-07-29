/**
 * Shared capability-aware OpenAI JSON request builders.
 * Used by Baxter chat (and available to PEM) so GPT-5.x vs GPT-4o contracts stay consistent.
 */

import {
  getOpenAiModelCapabilities,
  parseReasoningEffort,
  type OpenAiModelCapabilities,
  type OpenAiReasoningEffort,
} from "./capabilities";

export type OpenAiJsonMessage = {
  role: "system" | "user" | "assistant" | "developer";
  content: string;
};

export type BuildOpenAiJsonRequestInput = {
  model: string;
  messages: OpenAiJsonMessage[];
  maxOutputTokens: number;
  temperature?: number;
  reasoningEffort?: OpenAiReasoningEffort;
  /** Prefer json_object for Baxter structured answers. */
  jsonObject?: boolean;
};

export type BuiltOpenAiJsonRequest = {
  api: "responses" | "chat_completions";
  url: string;
  body: Record<string, unknown>;
  caps: OpenAiModelCapabilities;
};

export function extractOpenAiResponsesText(data: Record<string, unknown>): string | null {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }
  const output = data.output;
  if (!Array.isArray(output)) return null;
  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type === "message" && Array.isArray(row.content)) {
      for (const part of row.content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (
          (p.type === "output_text" || p.type === "text") &&
          typeof p.text === "string" &&
          p.text.trim()
        ) {
          texts.push(p.text);
        }
      }
    }
  }
  return texts.length ? texts.join("\n") : null;
}

export function buildOpenAiResponsesJsonBody(
  input: BuildOpenAiJsonRequestInput,
  caps: OpenAiModelCapabilities,
): Record<string, unknown> {
  const effort =
    input.reasoningEffort ?? parseReasoningEffort(process.env.BAXTER_REASONING_EFFORT, "low");

  const body: Record<string, unknown> = {
    model: input.model,
    max_output_tokens: input.maxOutputTokens,
    text: {
      format: input.jsonObject === false ? { type: "text" } : { type: "json_object" },
    },
    input: input.messages.map((m) => ({
      role:
        m.role === "system"
          ? "developer"
          : m.role === "assistant"
            ? "assistant"
            : m.role === "developer"
              ? "developer"
              : "user",
      content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
    })),
  };

  if (caps.supportsReasoningEffort) {
    body.reasoning = { effort };
  }

  return body;
}

export function buildOpenAiChatCompletionsJsonBody(
  input: BuildOpenAiJsonRequestInput,
  caps: OpenAiModelCapabilities,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    response_format: input.jsonObject === false ? undefined : { type: "json_object" },
    messages: input.messages.map((m) => ({
      role: m.role === "developer" ? "system" : m.role,
      content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
    })),
  };

  if (body.response_format === undefined) {
    delete body.response_format;
  }

  if (caps.outputTokenParam === "max_completion_tokens" || caps.isReasoningFamily) {
    body.max_completion_tokens = input.maxOutputTokens;
  } else {
    body.max_tokens = input.maxOutputTokens;
  }

  if (caps.supportsTemperature && input.temperature != null) {
    body.temperature = input.temperature;
  }

  return body;
}

/**
 * Build the exact HTTP request Baxter/PEM should send for a JSON-style completion.
 */
export function buildOpenAiJsonRequest(input: BuildOpenAiJsonRequestInput): BuiltOpenAiJsonRequest {
  const caps = getOpenAiModelCapabilities(input.model);
  if (caps.api === "responses") {
    return {
      api: "responses",
      url: "https://api.openai.com/v1/responses",
      body: buildOpenAiResponsesJsonBody(input, caps),
      caps,
    };
  }
  return {
    api: "chat_completions",
    url: "https://api.openai.com/v1/chat/completions",
    body: buildOpenAiChatCompletionsJsonBody(input, caps),
    caps,
  };
}

/** Assert request body has no undefined values (OpenAI rejects malformed JSON serialization oddly). */
export function assertNoUndefinedDeep(value: unknown, path = "root"): string[] {
  const problems: string[] = [];
  if (value === undefined) {
    problems.push(path);
    return problems;
  }
  if (value === null || typeof value !== "object") return problems;
  if (Array.isArray(value)) {
    value.forEach((item, i) => problems.push(...assertNoUndefinedDeep(item, `${path}[${i}]`)));
    return problems;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    problems.push(...assertNoUndefinedDeep(v, `${path}.${k}`));
  }
  return problems;
}
