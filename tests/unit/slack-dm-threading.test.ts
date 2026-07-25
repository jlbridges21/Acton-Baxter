import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import type { SlackPostMessageInput } from "@/lib/slack/client";
import type { BaxterAnswer } from "@/lib/baxter-ai/types";

const postSlackMessage = vi.fn(
  async (_input: SlackPostMessageInput): Promise<{ ok: true; ts?: string }> => ({
    ok: true,
    ts: "99.1",
  }),
);

const answerBaxterQuestion = vi.fn(
  async (): Promise<BaxterAnswer> => ({
    answer: "Hello from Baxter.",
    conversationId: "conv-1",
    sources: [],
    answerMode: "general",
    confidence: "medium",
    insufficientKnowledge: false,
  }),
);

vi.mock("@/lib/slack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/slack/client")>();
  return {
    ...actual,
    postSlackMessage: (input: SlackPostMessageInput) => postSlackMessage(input),
  };
});

vi.mock("@/lib/baxter-ai/answer", () => ({
  answerBaxterQuestion: () => answerBaxterQuestion(),
}));

import {
  buildSlackExternalThreadId,
  claimSlackEvent,
  handleBaxterSlackEvent,
  resolveSlackReplyThreadTs,
  shouldIgnoreSlackEvent,
} from "@/lib/slack/baxter-events";

function setSlackEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.ENABLE_SLACK_INTEGRATION = "true";
  process.env.SLACK_SIGNING_SECRET = "secret";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_ALLOWED_TEAM_IDS = "T123";
  delete process.env.SLACK_ALLOWED_CHANNEL_IDS;
  process.env.SLACK_ENABLE_DMS = "true";
  process.env.SLACK_ENABLE_CHANNEL_MENTIONS = "true";
  process.env.BAXTER_CHAT_ENABLED = "true";
  process.env.OPENAI_API_KEY = "test-key";
  resetEnvCacheForTests();
  postSlackMessage.mockClear();
  answerBaxterQuestion.mockClear();
}

function postedArgs(): SlackPostMessageInput[] {
  return postSlackMessage.mock.calls.map((call) => call[0] as SlackPostMessageInput);
}

describe("Slack DM vs channel reply threading", () => {
  beforeEach(() => {
    setSlackEnv();
  });

  it("resolveSlackReplyThreadTs omits thread for DMs and uses root for channels", () => {
    expect(
      resolveSlackReplyThreadTs(
        { type: "message", channel_type: "im", channel: "D1", ts: "1.1" },
        true,
      ),
    ).toBeUndefined();

    expect(
      resolveSlackReplyThreadTs(
        { type: "app_mention", channel: "C1", ts: "2.2", thread_ts: "1.1" },
        false,
      ),
    ).toBe("1.1");

    expect(
      resolveSlackReplyThreadTs({ type: "app_mention", channel: "C1", ts: "3.3" }, false),
    ).toBe("3.3");
  });

  it("DM conversation key ignores Slack thread_ts and stays stable across messages", () => {
    const first = buildSlackExternalThreadId({
      teamId: "T123",
      channelId: "D1",
      userId: "U1",
      threadTs: "10.1",
      isDm: true,
    });
    const second = buildSlackExternalThreadId({
      teamId: "T123",
      channelId: "D1",
      userId: "U1",
      threadTs: "11.2",
      isDm: true,
    });
    expect(first).toBe("T123:D1:U1");
    expect(second).toBe(first);
  });

  it("DM response posts without thread_ts and does not call assistant.threads APIs", async () => {
    await handleBaxterSlackEvent(
      {
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        text: "Who is Baxter?",
        ts: "10.1",
        team: "T123",
      },
      { eventId: "evt-dm-1", teamId: "T123" },
    );

    expect(postSlackMessage).toHaveBeenCalled();
    for (const arg of postedArgs()) {
      expect(arg.threadTs).toBeUndefined();
      expect(arg.channel).toBe("D1");
    }
    expect(answerBaxterQuestion).toHaveBeenCalled();
  });

  it("consecutive DMs post as top-level messages with shared conversation context", async () => {
    await handleBaxterSlackEvent(
      {
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        text: "First question",
        ts: "10.1",
        team: "T123",
      },
      { eventId: "evt-dm-a", teamId: "T123" },
    );
    await handleBaxterSlackEvent(
      {
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        text: "Follow up",
        ts: "11.2",
        team: "T123",
      },
      { eventId: "evt-dm-b", teamId: "T123" },
    );

    expect(postedArgs().length).toBeGreaterThanOrEqual(2);
    for (const arg of postedArgs()) {
      expect(arg.threadTs).toBeUndefined();
    }
    expect(answerBaxterQuestion).toHaveBeenCalledTimes(2);
  });

  it("top-level channel mention creates a thread under event.ts", async () => {
    await handleBaxterSlackEvent(
      {
        type: "app_mention",
        channel: "C1",
        user: "U1",
        text: "<@B> Who is Baxter?",
        ts: "20.2",
        team: "T123",
      },
      { eventId: "evt-ch-1", teamId: "T123" },
    );

    expect(postSlackMessage).toHaveBeenCalled();
    for (const arg of postedArgs()) {
      expect(arg.threadTs).toBe("20.2");
    }
  });

  it("mention inside an existing channel thread stays in that thread", async () => {
    await handleBaxterSlackEvent(
      {
        type: "app_mention",
        channel: "C1",
        user: "U1",
        text: "<@B> continue",
        ts: "21.3",
        thread_ts: "20.2",
        team: "T123",
      },
      { eventId: "evt-ch-2", teamId: "T123" },
    );

    expect(postSlackMessage).toHaveBeenCalled();
    for (const arg of postedArgs()) {
      expect(arg.threadTs).toBe("20.2");
    }
  });

  it("keeps retries/duplicates idempotent and ignores bots", async () => {
    expect(await claimSlackEvent("evt-dup-thread-1", "message", "T123")).toBe(true);
    expect(await claimSlackEvent("evt-dup-thread-1", "message", "T123")).toBe(false);
    expect(shouldIgnoreSlackEvent({ type: "message", bot_id: "B1", text: "hi" })).toBe(true);
    expect(shouldIgnoreSlackEvent({ type: "message", subtype: "bot_message" })).toBe(true);
  });

  it("postSlackMessage JSON omits thread_ts when not provided and never sets reply_broadcast", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    resetEnvCacheForTests();
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ ok: true, ts: "1" }),
        };
      }),
    );

    const { postSlackMessage: realPost } = await vi.importActual<
      typeof import("@/lib/slack/client")
    >("@/lib/slack/client");
    await realPost({ channel: "D1", text: "top-level" });
    expect(bodies[0]).not.toHaveProperty("thread_ts");
    expect(bodies[0]).not.toHaveProperty("reply_broadcast");

    await realPost({ channel: "C1", text: "threaded", threadTs: "9.9" });
    expect(bodies[1]?.thread_ts).toBe("9.9");
    expect(bodies[1]).not.toHaveProperty("reply_broadcast");
    vi.unstubAllGlobals();
  });
});
