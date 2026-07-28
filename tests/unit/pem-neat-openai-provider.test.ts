import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { getOpenAiModelCapabilities } from "@/lib/openai/capabilities";
import {
  buildPemProviderRequestForTests,
  callPemOpenAiJson,
  mapPemOpenAiHttpErrorForTests,
} from "@/lib/pem-neat/openai-client";
import { emptyPemNeatShell } from "@/lib/pem-neat/defaults";
import { parsePemNeatStructuredResult } from "@/lib/pem-neat/schemas";

function envBootstrap() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.OPENAI_API_KEY = "sk-test-pem";
}

describe("OpenAI model capabilities", () => {
  it("routes GPT-5.4 to Responses with max_output_tokens and reasoning", () => {
    const caps = getOpenAiModelCapabilities("gpt-5.4");
    expect(caps.api).toBe("responses");
    expect(caps.outputTokenParam).toBe("max_output_tokens");
    expect(caps.supportsReasoningEffort).toBe(true);
    expect(caps.supportsTemperature).toBe(false);
  });

  it("routes GPT-4o to Chat Completions with max_tokens", () => {
    const caps = getOpenAiModelCapabilities("gpt-4o");
    expect(caps.api).toBe("chat_completions");
    expect(caps.outputTokenParam).toBe("max_tokens");
    expect(caps.supportsReasoningEffort).toBe(false);
    expect(caps.supportsTemperature).toBe(true);
  });
});

describe("PEM GPT-5.4 request shape", () => {
  afterEach(() => {
    delete process.env.PEM_NEAT_REASONING_EFFORT;
  });

  it("builds Responses body without legacy chat fields", () => {
    process.env.PEM_NEAT_REASONING_EFFORT = "medium";
    const built = buildPemProviderRequestForTests("gpt-5.4", 4000, [
      { role: "system", content: "Return JSON" },
      { role: "user", content: "facts" },
    ]);
    expect(built.api).toBe("responses");
    expect(built.url).toBe("https://api.openai.com/v1/responses");
    expect(built.body.model).toBe("gpt-5.4");
    expect(built.body.max_output_tokens).toBe(4000);
    expect(built.body.reasoning).toEqual({ effort: "medium" });
    expect(built.body.text).toEqual({ format: { type: "json_object" } });
    expect(built.body).not.toHaveProperty("max_tokens");
    expect(built.body).not.toHaveProperty("max_completion_tokens");
    expect(built.body).not.toHaveProperty("temperature");
    expect(built.body).not.toHaveProperty("messages");
    expect(built.body).not.toHaveProperty("response_format");
  });

  it("builds GPT-4o Chat Completions body with max_tokens + temperature", () => {
    const built = buildPemProviderRequestForTests("gpt-4o", 4000, [
      { role: "system", content: "Return JSON" },
      { role: "user", content: "facts" },
    ]);
    expect(built.api).toBe("chat_completions");
    expect(built.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(built.body.max_tokens).toBe(4000);
    expect(built.body.temperature).toBe(0.25);
    expect(built.body.response_format).toEqual({ type: "json_object" });
    expect(built.body).not.toHaveProperty("max_output_tokens");
    expect(built.body).not.toHaveProperty("reasoning");
  });
});

describe("PEM OpenAI error mapping", () => {
  it("maps HTTP statuses to specific PEM codes", () => {
    expect(
      mapPemOpenAiHttpErrorForTests(400, { error: { code: "unsupported_parameter" } }).code,
    ).toBe("PEM_NEAT_PROVIDER_REQUEST_INVALID");
    expect(mapPemOpenAiHttpErrorForTests(401, null).code).toBe("PEM_NEAT_PROVIDER_REQUEST_INVALID");
    expect(mapPemOpenAiHttpErrorForTests(403, null).code).toBe("PEM_NEAT_MODEL_NOT_AVAILABLE");
    expect(
      mapPemOpenAiHttpErrorForTests(404, {
        error: { code: "model_not_found", message: "does not exist" },
      }).code,
    ).toBe("PEM_NEAT_MODEL_NOT_AVAILABLE");
    expect(
      mapPemOpenAiHttpErrorForTests(429, { error: { code: "rate_limit_exceeded" } }).code,
    ).toBe("PEM_NEAT_RATE_LIMITED");
    expect(
      mapPemOpenAiHttpErrorForTests(429, {
        error: { code: "insufficient_quota", type: "insufficient_quota" },
      }).code,
    ).toBe("PEM_NEAT_QUOTA_EXCEEDED");
    expect(mapPemOpenAiHttpErrorForTests(500, null).code).toBe("PEM_NEAT_PROVIDER_ERROR");
  });

  it("maps truncated Responses incomplete to PEM_NEAT_OUTPUT_TRUNCATED", async () => {
    envBootstrap();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: [],
          }),
          { status: 200 },
        ),
    );
    await expect(
      callPemOpenAiJson({
        model: "gpt-5.4",
        maxOutputTokens: 100,
        timeoutMs: 5_000,
        messages: [{ role: "user", content: "json" }],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "PEM_NEAT_OUTPUT_TRUNCATED" });
  });

  it("maps 404 model errors from Responses", async () => {
    envBootstrap();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "model_not_found", message: "The model does not exist" },
          }),
          {
            status: 404,
          },
        ),
    );
    try {
      await callPemOpenAiJson({
        model: "gpt-does-not-exist",
        maxOutputTokens: 100,
        timeoutMs: 5_000,
        messages: [{ role: "user", content: "json" }],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("PEM_NEAT_MODEL_NOT_AVAILABLE");
    }
  });
});

describe("PEM staged GPT-5.4 response parsing + merge", () => {
  it("parses Responses output_text JSON for a facts-stage payload", async () => {
    envBootstrap();
    const facts = {
      salesIntelligence: {
        customerStory: "Prospect wants ADU for aging parents.",
        type1Pain: ["Privacy for in-laws"],
        type2Pain: [],
      },
      projectIntelligence: {
        facts: [{ label: "Lot", value: "Flat backyard", evidence: "Prospect said flat backyard" }],
      },
    };

    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            model: "gpt-5.4",
            output_text: JSON.stringify(facts),
            usage: { input_tokens: 10, output_tokens: 20 },
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: JSON.stringify(facts) }],
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const result = await callPemOpenAiJson({
      model: "gpt-5.4",
      maxOutputTokens: 2000,
      timeoutMs: 5_000,
      messages: [
        { role: "system", content: "Return JSON" },
        { role: "user", content: "facts" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.api).toBe("responses");
    expect(result.finishReason).toBe("completed");
    expect(JSON.parse(result.content)).toMatchObject({
      salesIntelligence: { customerStory: expect.stringContaining("ADU") },
    });

    // Staged merge still produces a valid NEAT when shell defaults fill gaps.
    const shell = emptyPemNeatShell({ prospectName: "Alex", advisorName: "Jesse" });
    shell.salesIntelligence.customerStory = facts.salesIntelligence.customerStory;
    const merged = parsePemNeatStructuredResult(shell);
    expect(merged.salesIntelligence.customerStory).toContain("ADU");
  });
});
