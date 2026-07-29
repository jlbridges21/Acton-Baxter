import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOpenAiModelCapabilities } from "@/lib/openai/capabilities";
import { assertNoUndefinedDeep, buildOpenAiJsonRequest } from "@/lib/openai/json-request";
import { buildBaxterOpenAiRequest, OpenAIBaxterProvider } from "@/lib/baxter-ai/openai-provider";
import { buildBaxterUserPrompt } from "@/lib/baxter-ai/prompts";
import { classifyOpenAiHttpError } from "@/lib/baxter-ai/errors";
import { resetEnvCacheForTests } from "@/lib/env";
import { selectSlackEvidenceForModel } from "@/lib/baxter-data/slack/select";
import {
  SLACK_SOURCE_TYPE,
  type SlackMessageEvidence,
  type SlackQueryPlan,
} from "@/lib/baxter-data/slack/types";
import { slackEvidenceToContextItems } from "@/lib/baxter-data/slack/to-context";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function raciMessages(): SlackMessageEvidence[] {
  return [
    {
      sourceType: SLACK_SOURCE_TYPE,
      messageTs: "1721600000.000100",
      threadTs: null,
      channelId: "C_PM",
      channelName: "project-management",
      channelKind: "public_channel",
      authorId: "U_MAXX",
      authorName: "Maxx",
      timestamp: "2024-07-22T12:00:00.000Z",
      text: "Still working through the RACI matrix.",
      permalink: "https://example.slack.com/archives/C_PM/p1721600000000100",
      isThreadReply: false,
      relevance: 0.4,
      contextMessages: [],
      clusterKey: "C_PM:1721600000.000100",
    },
    {
      sourceType: SLACK_SOURCE_TYPE,
      messageTs: "1721772800.000100",
      threadTs: null,
      channelId: "C_PM",
      channelName: "project-management",
      channelKind: "public_channel",
      authorId: "U_MAXX",
      authorName: "Maxx",
      timestamp: "2024-07-24T12:00:00.000Z",
      text: "The roles are mapped. I need to review responsibilities.",
      permalink: "https://example.slack.com/archives/C_PM/p1721772800000100",
      isThreadReply: false,
      relevance: 0.9,
      contextMessages: [],
      clusterKey: "C_PM:1721772800.000100",
    },
    {
      sourceType: SLACK_SOURCE_TYPE,
      messageTs: "1721860000.000100",
      threadTs: null,
      channelId: "C_PM",
      channelName: "project-management",
      channelKind: "public_channel",
      authorId: "U_MILAN",
      authorName: "Milan",
      timestamp: "2024-07-25T12:00:00.000Z",
      text: "Let's have the RACI draft ready for review Friday.",
      permalink: "https://example.slack.com/archives/C_PM/p1721860000000100",
      isThreadReply: false,
      relevance: 0.5,
      contextMessages: [],
      clusterKey: "C_PM:1721860000.000100",
    },
  ];
}

function latestUpdatePlan(): SlackQueryPlan {
  return {
    intent: "latest_update",
    people: [],
    channels: [],
    keywords: ["RACI", "matrix"],
    phrases: [],
    decisionLanguage: [],
    timeRange: null,
    sort: "newest",
    limit: 8,
    includeThreads: true,
    includeNearbyContext: true,
    naturalQuery: "When will the RACI matrix be ready?",
  };
}

describe("Baxter OpenAI capability-aware request builder", () => {
  it("uses Responses API without max_tokens for GPT-5.x", () => {
    const built = buildBaxterOpenAiRequest({
      model: "gpt-5.4",
      systemPrompt: "System",
      userPrompt: "User",
    });
    expect(built.api).toBe("responses");
    expect(built.url).toContain("/v1/responses");
    expect(built.body.max_output_tokens).toBe(1200);
    expect(built.body).not.toHaveProperty("max_tokens");
    expect(built.body).not.toHaveProperty("temperature");
    expect(built.body).not.toHaveProperty("response_format");
    expect((built.body.text as { format: { type: string } }).format.type).toBe("json_object");
    expect(assertNoUndefinedDeep(built.body)).toEqual([]);
  });

  it("uses Chat Completions with max_tokens for GPT-4o", () => {
    const built = buildBaxterOpenAiRequest({
      model: "gpt-4o-mini",
      systemPrompt: "System",
      userPrompt: "User",
    });
    expect(built.api).toBe("chat_completions");
    expect(built.url).toContain("/v1/chat/completions");
    expect(built.body.max_tokens).toBe(1200);
    expect(built.body).not.toHaveProperty("max_output_tokens");
    expect(built.body.temperature).toBe(0.3);
    expect(built.body.response_format).toEqual({ type: "json_object" });
    expect(assertNoUndefinedDeep(built.body)).toEqual([]);
  });

  it("keeps GPT-5.6-terra on Responses (BAXTER_CHAT_MODEL family)", () => {
    const caps = getOpenAiModelCapabilities("gpt-5.6-terra");
    expect(caps.api).toBe("responses");
    expect(caps.supportsTemperature).toBe(false);
    const built = buildOpenAiJsonRequest({
      model: "gpt-5.6-terra",
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
      maxOutputTokens: 800,
      temperature: 0.3,
      jsonObject: true,
    });
    expect(built.api).toBe("responses");
    expect(built.body).not.toHaveProperty("max_tokens");
  });
});

describe("Slack + GPT-5 request payload", () => {
  it("serializes Slack evidence as strings for GPT-5 Responses body", () => {
    const selected = selectSlackEvidenceForModel(raciMessages(), latestUpdatePlan());
    expect(selected[0]?.authorName).toBe("Milan");
    const items = slackEvidenceToContextItems(selected, latestUpdatePlan(), 1);
    const userPrompt = buildBaxterUserPrompt({
      question: "When will the RACI matrix be ready?",
      contextItems: items,
      channel: "slack",
      questionClass: "acton_company_specific",
      history: [],
    });
    expect(typeof userPrompt).toBe("string");
    expect(userPrompt).toMatch(/ready for review Friday/i);
    expect(userPrompt).not.toMatch(/\[object Object\]/);

    const built = buildBaxterOpenAiRequest({
      model: "gpt-5.4",
      systemPrompt: "sys",
      userPrompt,
    });
    const input = built.body.input as Array<{ content: unknown }>;
    expect(input.every((m) => typeof m.content === "string")).toBe(true);
    expect(assertNoUndefinedDeep(built.body)).toEqual([]);
  });

  it("multi-source Rulebook + Slack still yields valid GPT-5 payload", () => {
    const slackItems = slackEvidenceToContextItems(
      selectSlackEvidenceForModel(raciMessages(), latestUpdatePlan()),
      latestUpdatePlan(),
      2,
    );
    const contextItems = [
      {
        number: 1,
        id: "rulebook-raci",
        title: "RACI process",
        summary: "Official process",
        contentExcerpt:
          "The RACI matrix is maintained by Project Management and reviewed quarterly.",
        category: "Rulebook",
        tags: ["rulebook"],
        sourceName: "Process Rulebook",
        sourceUrl: "/admin/rulebook",
        sourceType: "rulebook",
        mimeType: null,
        updatedAt: new Date().toISOString(),
        citationLabel: "Process Rulebook · RACI",
        relevanceScore: 80,
      },
      ...slackItems,
    ];
    const userPrompt = buildBaxterUserPrompt({
      question: "When will the RACI matrix be ready?",
      contextItems,
      channel: "web",
      history: [],
    });
    const built = buildBaxterOpenAiRequest({
      model: "gpt-5.4",
      systemPrompt: "sys",
      userPrompt,
    });
    expect(built.api).toBe("responses");
    expect(JSON.stringify(built.body)).toMatch(/ready for review Friday/i);
    expect(JSON.stringify(built.body)).toMatch(/quarterly/i);
  });
});

describe("OpenAI error classification for provider diagnostics", () => {
  it("maps unsupported_parameter 400 with param", () => {
    const classified = classifyOpenAiHttpError(400, {
      error: {
        message: "Unsupported parameter: 'max_tokens'",
        type: "invalid_request_error",
        code: "unsupported_parameter",
        param: "max_tokens",
      },
    });
    expect(classified.code).toBe("BAXTER_OPENAI_BAD_REQUEST");
    expect(classified.message).toContain("max_tokens");
    expect(classified.retryable).toBe(false);
  });

  it("maps model_not_found", () => {
    expect(
      classifyOpenAiHttpError(404, {
        error: { code: "model_not_found", message: "The model does not exist" },
      }).code,
    ).toBe("BAXTER_OPENAI_MODEL_NOT_AVAILABLE");
  });
});

describe("OpenAIBaxterProvider GPT-5 live request path (mocked)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.EXTERNAL_API_TIMEOUT_MS = "10000";
    resetEnvCacheForTests();
  });

  it("POSTs to /v1/responses and never sends max_tokens", async () => {
    process.env.BAXTER_CHAT_MODEL = "gpt-5.4";
    resetEnvCacheForTests();

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            answer: "The latest update says the RACI draft should be ready for review Friday.",
            usedSourceNumbers: [1],
            confidence: "high",
            insufficientKnowledge: false,
            answerMode: "grounded",
          }),
          usage: { input_tokens: 100, output_tokens: 40 },
          model: "gpt-5.4",
          status: "completed",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIBaxterProvider("gpt-5.4");
    const items = slackEvidenceToContextItems(
      selectSlackEvidenceForModel(raciMessages(), latestUpdatePlan()),
      latestUpdatePlan(),
      1,
    );
    const result = await provider.generateAnswer({
      question: "When will the RACI matrix be ready?",
      contextItems: items,
      channel: "slack",
      questionClass: "acton_company_specific",
      history: [],
    });

    expect(result.answer).toMatch(/Friday/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toContain("/v1/responses");
    const body = JSON.parse(String(call[1].body));
    expect(body).toHaveProperty("max_output_tokens");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
  });

  it("POSTs to chat/completions for gpt-4o-mini", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "OK",
                  usedSourceNumbers: [],
                  confidence: "medium",
                  insufficientKnowledge: false,
                  answerMode: "general",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIBaxterProvider("gpt-4o-mini");
    await provider.generateAnswer({
      question: "Say OK",
      contextItems: [],
      channel: "web",
      history: [],
    });

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toContain("/v1/chat/completions");
    const body = JSON.parse(String(call[1].body));
    expect(body.max_tokens).toBe(1200);
    expect(body.temperature).toBe(0.3);
  });
});

describe("RACI latest-update evidence quality", () => {
  it("selects Milan Friday update over older Maxx messages", () => {
    const selected = selectSlackEvidenceForModel(raciMessages(), latestUpdatePlan());
    expect(selected[0]?.text).toMatch(/ready for review Friday/i);
    expect(selected[0]?.authorName).toBe("Milan");
  });
});
