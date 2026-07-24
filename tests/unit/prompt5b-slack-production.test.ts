import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { SlackSignatureError, verifySlackRequest } from "@/lib/slack/verify";
import {
  buildSlackExternalThreadId,
  evaluateSlackAccess,
  shouldIgnoreSlackEvent,
  stripBotMention,
  claimSlackEvent,
} from "@/lib/slack/baxter-events";
import {
  buildBaxterSlackText,
  escapeSlackMrkdwn,
  sanitizeSourceUrl,
  splitSlackMessage,
} from "@/lib/slack/format";
import { getSlackRuntimeConfig, evaluateSlackHealth } from "@/lib/slack/config";
import { resetSlackReceiptMemoryForTests } from "@/lib/slack/receipts";
import { SLACK_ERROR_CODES, mapSlackApiErrorToCode } from "@/lib/slack/errors";
import { resetBaxterConversationMemoryForTests } from "@/lib/baxter-ai/conversations";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { resetKnowledgeMemoryForTests } from "@/lib/knowledge/store";
import { resetMemoryJobsForTests } from "@/lib/jobs/queue";
import type { BaxterAnswer } from "@/lib/baxter-ai/types";

function sign(secret: string, timestamp: string, body: string) {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
  process.env.NEXT_PUBLIC_APP_URL = "https://acton-baxter.vercel.app";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.ENABLE_SLACK_INTEGRATION = "true";
  process.env.SLACK_SIGNING_SECRET = "secret";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_ALLOWED_TEAM_IDS = "T123";
  process.env.SLACK_ALLOWED_CHANNEL_IDS = "C111";
  process.env.SLACK_ALLOWED_USER_IDS = "";
  process.env.SLACK_ENABLE_DMS = "true";
  process.env.SLACK_ENABLE_CHANNEL_MENTIONS = "true";
  process.env.BAXTER_CHAT_ENABLED = "true";
  process.env.OPENAI_API_KEY = "test-key";
  resetEnvCacheForTests();
  resetSlackReceiptMemoryForTests();
  resetBaxterConversationMemoryForTests();
  resetKnowledgeMemoryForTests();
  resetMemoryJobsForTests();
});

describe("Prompt 5B Slack signature verification", () => {
  it("accepts valid signatures and rejects invalid/missing/old", () => {
    const body = '{"type":"url_verification"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign("secret", timestamp, body);
    expect(() =>
      verifySlackRequest({ signature, timestamp, rawBody: body, signingSecret: "secret" }),
    ).not.toThrow();

    expect(() =>
      verifySlackRequest({
        signature: "v0=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        timestamp,
        rawBody: body,
        signingSecret: "secret",
      }),
    ).toThrow(SlackSignatureError);

    expect(() =>
      verifySlackRequest({
        signature: null,
        timestamp,
        rawBody: body,
        signingSecret: "secret",
      }),
    ).toThrow(SlackSignatureError);

    expect(() =>
      verifySlackRequest({
        signature,
        timestamp: String(Math.floor(Date.now() / 1000) - 600),
        rawBody: body,
        signingSecret: "secret",
      }),
    ).toThrow(SlackSignatureError);
  });
});

describe("Prompt 5B Slack access and events", () => {
  it("ignores bots and unsupported subtypes", () => {
    expect(shouldIgnoreSlackEvent({ type: "message", bot_id: "B1", text: "hi" })).toBe(true);
    expect(shouldIgnoreSlackEvent({ type: "message", subtype: "message_changed" })).toBe(true);
    expect(shouldIgnoreSlackEvent({ type: "app_mention", user: "U1", text: "<@B> hi" })).toBe(
      false,
    );
  });

  it("strips mention markup", () => {
    expect(stripBotMention("<@U123ABC> What is an ADU?")).toBe("What is an ADU?");
  });

  it("dedupes events", async () => {
    expect(await claimSlackEvent("evt-5b-1", "message", "T123")).toBe(true);
    expect(await claimSlackEvent("evt-5b-1", "message", "T123")).toBe(false);
  });

  it("allows DMs and restrict channels by allowlist", () => {
    expect(
      evaluateSlackAccess({
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        text: "hi",
      }).allowed,
    ).toBe(true);

    expect(
      evaluateSlackAccess({
        type: "app_mention",
        channel: "C999",
        user: "U1",
        text: "<@B> hi",
      }).allowed,
    ).toBe(false);

    expect(
      evaluateSlackAccess({
        type: "app_mention",
        channel: "C111",
        user: "U1",
        text: "<@B> hi",
      }).allowed,
    ).toBe(true);
  });

  it("builds stable conversation thread ids", () => {
    expect(
      buildSlackExternalThreadId({
        teamId: "T123",
        channelId: "D1",
        userId: "U1",
        threadTs: "1.2",
        isDm: true,
      }),
    ).toBe("T123:D1:U1");

    expect(
      buildSlackExternalThreadId({
        teamId: "T123",
        channelId: "C111",
        userId: "U1",
        threadTs: "9.9",
        isDm: false,
      }),
    ).toBe("T123:C111:9.9");
  });
});

describe("Prompt 5B Slack formatting", () => {
  it("escapes unsafe markup and sanitizes urls", () => {
    expect(escapeSlackMrkdwn("Hello <!channel>")).not.toContain("<!channel>");
    expect(sanitizeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeSourceUrl("/knowledge/abc")).toBe(
      "https://acton-baxter.vercel.app/knowledge/abc",
    );
  });

  it("formats sources with validated links and answer type", () => {
    const answer: BaxterAnswer = {
      answer: "Use the checklist.",
      confidence: "high",
      insufficientKnowledge: false,
      conversationId: "c1",
      answerMode: "grounded",
      sources: [
        {
          title: "Project Brief",
          sourceName: "Ops",
          category: null,
          sourceUrl: "https://docs.google.com/document/d/abc",
          citationLabel: "Ops — Project Brief",
          sourceKind: "google_doc",
          openLabel: "Open Google Doc",
          lastUpdated: new Date().toISOString(),
          relevanceScore: 10,
          availability: "available",
        },
      ],
    };
    const text = buildBaxterSlackText(answer);
    expect(text).toContain("*Baxter*");
    expect(text).toContain("<https://docs.google.com/document/d/abc|Project Brief>");
    expect(text).toContain("Answer type: Approved Acton knowledge");
    expect(text).not.toContain("Confidence:");
  });

  it("splits long messages without breaking links", () => {
    const link = "<https://docs.google.com/document/d/abc|Very Long Title Here>";
    const text = `${"x".repeat(3400)}\n${link}\n${"y".repeat(200)}`;
    const parts = splitSlackMessage(text, 3500);
    expect(parts.length).toBeGreaterThan(1);
    expect(
      parts.some((part) => part.includes(link) || part.includes("https://docs.google.com")),
    ).toBe(true);
  });
});

describe("Prompt 5B Slack config health", () => {
  it("reports disabled and misconfigured safely", async () => {
    process.env.ENABLE_SLACK_INTEGRATION = "false";
    resetEnvCacheForTests();
    const disabled = await evaluateSlackHealth();
    expect(disabled.status).toBe("disabled");

    process.env.ENABLE_SLACK_INTEGRATION = "true";
    process.env.SLACK_ALLOWED_TEAM_IDS = "";
    resetEnvCacheForTests();
    const misconfigured = await evaluateSlackHealth();
    expect(misconfigured.status).toBe("misconfigured");
    expect(getSlackRuntimeConfig().missingRequired).toContain("SLACK_ALLOWED_TEAM_IDS");
  });

  it("maps Slack API errors to Baxter codes", () => {
    expect(mapSlackApiErrorToCode("invalid_auth")).toBe(SLACK_ERROR_CODES.AUTH_FAILED);
    expect(mapSlackApiErrorToCode("not_in_channel")).toBe(SLACK_ERROR_CODES.NOT_IN_CHANNEL);
    expect(mapSlackApiErrorToCode("ratelimited")).toBe(SLACK_ERROR_CODES.RATE_LIMITED);
  });
});

describe("Prompt 5B Slack conversation mapping", () => {
  it("stores Slack conversations without fake Supabase users", async () => {
    const first = await answerBaxterQuestion({
      question: "Who is Baxter?",
      userId: null,
      userName: "Slack user U99",
      channel: "slack",
      externalThreadId: "T123:D1:U99",
      externalUserId: "U99",
    });
    expect(first.conversationId).toBeTruthy();
    expect(first.answerMode).toBe("identity");

    const second = await answerBaxterQuestion({
      question: "What can you do?",
      userId: null,
      userName: "Slack user U99",
      channel: "slack",
      externalThreadId: "T123:D1:U99",
      externalUserId: "U99",
    });
    expect(second.conversationId).toBe(first.conversationId);

    const otherThread = await answerBaxterQuestion({
      question: "Who is Baxter?",
      userId: null,
      channel: "slack",
      externalThreadId: "T123:C111:99.99",
      externalUserId: "U99",
    });
    expect(otherThread.conversationId).not.toBe(first.conversationId);
  });
});

describe("Prompt 5B Slack client logging safety", () => {
  it("never includes bot token in client error messages", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-super-secret-token";
    resetEnvCacheForTests();

    const { postSlackMessage } = await import("@/lib/slack/client");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ ok: false, error: "invalid_auth" }),
      })),
    );

    await expect(postSlackMessage({ channel: "C1", text: "hi" })).rejects.toThrow(
      /invalid_auth|Slack API/,
    );

    try {
      await postSlackMessage({ channel: "C1", text: "hi" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("xoxb-super-secret-token");
    }

    vi.unstubAllGlobals();
  });
});
