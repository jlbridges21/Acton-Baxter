import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  classifyOpenAiHttpError,
  employeeFacingErrorMessage,
  isTemporaryOpenAiCode,
} from "@/lib/baxter-ai/errors";
import {
  getIdempotentChatAnswer,
  resetChatIdempotencyForTests,
  storeIdempotentChatAnswer,
} from "@/lib/baxter-ai/idempotency";
import { resetOpenAiMetricsForTests } from "@/lib/baxter-ai/openai-metrics";
import { normalizePrivateKey, isPrivateKeyFormatValid } from "@/lib/connectors/google/auth";
import { normalizeGoogleFolderId } from "@/lib/connectors/google/folder-id";
import { runRateLimitClassificationDiagnostic } from "@/lib/baxter-ai/diagnostics";
import { BAXTER_CONTEXT_LIMIT, BAXTER_MAX_EXCERPT_CHARS } from "@/lib/baxter-ai/context";
import { readFileSync } from "node:fs";
import { join } from "node:path";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.BAXTER_CHAT_ENABLED = "true";
  resetEnvCacheForTests();
  resetChatIdempotencyForTests();
  resetOpenAiMetricsForTests();
});

describe("Prompt 5C OpenAI classification", () => {
  it("maps temporary 429 separately from quota and billing", () => {
    expect(
      classifyOpenAiHttpError(429, {
        error: { code: "rate_limit_exceeded", message: "Rate limit reached for rpm" },
      }).code,
    ).toBe("BAXTER_OPENAI_RATE_LIMITED");

    expect(
      classifyOpenAiHttpError(429, {
        error: { code: "insufficient_quota", type: "insufficient_quota" },
      }).code,
    ).toBe("BAXTER_OPENAI_QUOTA_EXCEEDED");

    expect(
      classifyOpenAiHttpError(429, {
        error: { message: "Billing hard limit has been reached" },
      }).code,
    ).toBe("BAXTER_OPENAI_BILLING_REQUIRED");

    expect(classifyOpenAiHttpError(401).code).toBe("BAXTER_OPENAI_AUTH_FAILED");
    expect(classifyOpenAiHttpError(503).code).toBe("BAXTER_OPENAI_SERVICE_UNAVAILABLE");
  });

  it("does not retry quota errors and does retry temporary limits", () => {
    expect(classifyOpenAiHttpError(429, { error: { code: "insufficient_quota" } }).retryable).toBe(
      false,
    );
    expect(classifyOpenAiHttpError(429, { error: { code: "rate_limit_exceeded" } }).retryable).toBe(
      true,
    );
    expect(isTemporaryOpenAiCode("BAXTER_OPENAI_RATE_LIMITED")).toBe(true);
    expect(isTemporaryOpenAiCode("BAXTER_OPENAI_QUOTA_EXCEEDED")).toBe(false);
  });

  it("returns employee-safe messages for quota vs rate limit", () => {
    expect(employeeFacingErrorMessage("BAXTER_OPENAI_RATE_LIMITED")).toContain("lot of requests");
    expect(employeeFacingErrorMessage("BAXTER_OPENAI_QUOTA_EXCEEDED")).toContain(
      "administrator attention",
    );
  });

  it("passes mocked rate-limit classification diagnostic", async () => {
    const result = await runRateLimitClassificationDiagnostic();
    expect(result.pass).toBe(true);
  });

  it("honors Retry-After when present", () => {
    const headers = new Headers({ "retry-after": "5" });
    const classified = classifyOpenAiHttpError(
      429,
      { error: { code: "rate_limit_exceeded" } },
      headers,
    );
    expect(classified.retryAfterSeconds).toBe(5);
  });
});

describe("Prompt 5C OpenAI provider retries", () => {
  it("retries temporary 429 at most twice and does not retry quota", async () => {
    const { OpenAIBaxterProvider } = await import("@/lib/baxter-ai/openai-provider");
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({ error: { code: "rate_limit_exceeded", message: "slow down" } }),
        };
      }),
    );

    const provider = new OpenAIBaxterProvider("gpt-4o-mini");
    await expect(
      provider.generateAnswer({
        question: "Hello",
        contextItems: [],
        channel: "web",
        questionClass: "general_knowledge",
        identityContext: "",
        history: [],
      }),
    ).rejects.toMatchObject({ code: "BAXTER_OPENAI_RATE_LIMITED" });
    // initial + 2 retries = 3
    expect(calls).toBe(3);

    calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({ error: { code: "insufficient_quota", type: "insufficient_quota" } }),
        };
      }),
    );
    await expect(
      provider.generateAnswer({
        question: "Hello",
        contextItems: [],
        channel: "web",
        questionClass: "general_knowledge",
        identityContext: "",
        history: [],
      }),
    ).rejects.toMatchObject({ code: "BAXTER_OPENAI_QUOTA_EXCEEDED" });
    expect(calls).toBe(1);
    vi.unstubAllGlobals();
  });
});

describe("Prompt 5C idempotency and context", () => {
  it("returns one cached answer for duplicate client request ids", () => {
    const answer = {
      answer: "Dynamic reply",
      sources: [],
      confidence: "high" as const,
      insufficientKnowledge: false,
      conversationId: "00000000-0000-4000-8000-000000000001",
      messageId: "00000000-0000-4000-8000-000000000002",
      answerMode: "general" as const,
    };
    storeIdempotentChatAnswer("user-1", "00000000-0000-4000-8000-000000000099", answer);
    const replay = getIdempotentChatAnswer("user-1", "00000000-0000-4000-8000-000000000099");
    expect(replay?.answer).toBe("Dynamic reply");
  });

  it("keeps retrieval context bounded", () => {
    expect(BAXTER_CONTEXT_LIMIT).toBeLessThanOrEqual(8);
    expect(BAXTER_MAX_EXCERPT_CHARS).toBeLessThanOrEqual(1000);
  });
});

describe("Prompt 5C Google credential helpers", () => {
  it("normalizes quoted, literal-n, and multiline private keys", () => {
    const multiline = `-----BEGIN PRIVATE KEY-----
ABC
-----END PRIVATE KEY-----`;
    expect(isPrivateKeyFormatValid(multiline)).toBe(true);
    expect(
      normalizePrivateKey('"-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----"'),
    ).toContain("BEGIN PRIVATE KEY");
    expect(isPrivateKeyFormatValid("not-a-key")).toBe(false);
  });

  it("parses folder URLs to IDs", () => {
    expect(normalizeGoogleFolderId("1abcDEF")).toBe("1abcDEF");
    expect(
      normalizeGoogleFolderId("https://drive.google.com/drive/folders/1folderXYZ?usp=sharing"),
    ).toBe("1folderXYZ");
  });
});

describe("Prompt 5C Slack docs and manifest alignment", () => {
  it("setup docs use production endpoints and do not require fake Slack chat users", () => {
    const setup = readFileSync(join(process.cwd(), "docs/slack-setup.md"), "utf8");
    const manifest = readFileSync(join(process.cwd(), "docs/slack-app-manifest.yaml"), "utf8");
    expect(setup).toContain("https://acton-baxter.vercel.app/api/slack/events");
    expect(setup).toContain("/api/slack/commands/property");
    expect(setup.toLowerCase()).not.toContain("create a supabase auth user for slack attribution");
    expect(manifest).toContain("app_mentions:read");
    expect(manifest).toContain("chat:write");
    expect(manifest).toContain("im:history");
    expect(manifest).toContain("commands");
    expect(manifest).toContain("app_mention");
    expect(manifest).toContain("message.im");
    expect(manifest).not.toContain("channels:history");
  });
});

describe("Prompt 5C chat UI avatar removal", () => {
  it("assistant message component does not render BaxterAvatar", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/baxter-chat/baxter-chat-message.tsx"),
      "utf8",
    );
    expect(source).not.toContain("BaxterAvatar");
    expect(source).toContain("BaxterMessageFeedback");
    const panel = readFileSync(
      join(process.cwd(), "src/components/baxter-chat/baxter-chat-panel.tsx"),
      "utf8",
    );
    expect(panel).toContain("BaxterAvatar");
    const launcher = readFileSync(
      join(process.cwd(), "src/components/baxter-chat/baxter-chat-launcher.tsx"),
      "utf8",
    );
    expect(launcher).toContain("BaxterAvatar");
    const input = readFileSync(
      join(process.cwd(), "src/components/baxter-chat/baxter-chat-input.tsx"),
      "utf8",
    );
    expect(input).toContain("Ask Baxter anything");
  });
});
