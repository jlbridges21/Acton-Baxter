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

const addSlackReaction = vi.fn(
  async (_input?: {
    channel: string;
    timestamp: string;
    name?: string;
  }): Promise<{ ok: boolean; error?: string }> => ({
    ok: true,
  }),
);
const removeSlackReaction = vi.fn(
  async (_input?: {
    channel: string;
    timestamp: string;
    name?: string;
  }): Promise<{ ok: boolean; error?: string }> => ({
    ok: true,
  }),
);

const answerBaxterQuestion = vi.fn(async (): Promise<BaxterAnswer> => ({
  answer: "Hello from Baxter.",
  conversationId: "conv-1",
  sources: [],
  answerMode: "general",
  confidence: "medium",
  insufficientKnowledge: false,
}));

const updateSlackEventReceipt = vi.fn(async () => undefined);

vi.mock("@/lib/slack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/slack/client")>();
  return {
    ...actual,
    postSlackMessage: (input: SlackPostMessageInput) => postSlackMessage(input),
    addSlackReaction: (...args: unknown[]) =>
      addSlackReaction(...(args as [Parameters<typeof addSlackReaction>[0]])),
    removeSlackReaction: (...args: unknown[]) =>
      removeSlackReaction(...(args as [Parameters<typeof removeSlackReaction>[0]])),
    addProcessingReaction: (input: { channel: string; timestamp: string }) =>
      addSlackReaction({
        channel: input.channel,
        timestamp: input.timestamp,
        name: "eyes",
      } as never),
    removeProcessingReaction: (input: { channel: string; timestamp: string }) =>
      removeSlackReaction({
        channel: input.channel,
        timestamp: input.timestamp,
        name: "eyes",
      } as never),
  };
});

vi.mock("@/lib/baxter-ai/answer", () => ({
  answerBaxterQuestion: () => answerBaxterQuestion(),
}));

vi.mock("@/lib/slack/receipts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/slack/receipts")>();
  return {
    ...actual,
    updateSlackEventReceipt: (...args: unknown[]) =>
      updateSlackEventReceipt(...(args as Parameters<typeof updateSlackEventReceipt>)),
  };
});

import { handleBaxterSlackEvent, shouldIgnoreSlackEvent } from "@/lib/slack/baxter-events";
import { SLACK_EYES_REACTION } from "@/lib/slack/client";

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
  addSlackReaction.mockClear();
  removeSlackReaction.mockClear();
  updateSlackEventReceipt.mockClear();
  addSlackReaction.mockResolvedValue({ ok: true });
  removeSlackReaction.mockResolvedValue({ ok: true });
}

describe("Slack 👀 processing reaction", () => {
  beforeEach(() => {
    setSlackEnv();
  });

  it("ignores bot messages and reaction events", () => {
    expect(shouldIgnoreSlackEvent({ type: "message", bot_id: "B1", ts: "1.1" })).toBe(true);
    expect(shouldIgnoreSlackEvent({ type: "reaction_added", user: "U1" })).toBe(true);
    expect(
      shouldIgnoreSlackEvent({
        type: "message",
        channel_type: "im",
        user: "U1",
        text: "hi",
        ts: "1.1",
      }),
    ).toBe(false);
  });

  it("adds eyes before answering and removes after on DM, using triggering ts", async () => {
    const order: string[] = [];
    addSlackReaction.mockImplementation(async () => {
      order.push("add");
      return { ok: true };
    });
    answerBaxterQuestion.mockImplementation(async () => {
      order.push("answer");
      return {
        answer: "Sold $1.",
        conversationId: "conv-1",
        sources: [],
        answerMode: "general",
        confidence: "medium",
        insufficientKnowledge: false,
      };
    });
    postSlackMessage.mockImplementation(async () => {
      order.push("post");
      return { ok: true, ts: "99.1" };
    });
    removeSlackReaction.mockImplementation(async () => {
      order.push("remove");
      return { ok: true };
    });

    await handleBaxterSlackEvent(
      {
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        text: "How much sold?",
        ts: "1710000000.000100",
        team: "T123",
      },
      { eventId: "Ev1", teamId: "T123" },
    );

    expect(order).toEqual(["add", "answer", "post", "remove"]);
    expect(addSlackReaction).toHaveBeenCalledWith({
      channel: "D1",
      timestamp: "1710000000.000100",
      name: "eyes",
    });
    expect(removeSlackReaction).toHaveBeenCalledWith({
      channel: "D1",
      timestamp: "1710000000.000100",
      name: "eyes",
    });
  });

  it("reacts to the mention message ts in a thread, not only the root", async () => {
    await handleBaxterSlackEvent(
      {
        type: "app_mention",
        channel: "C1",
        user: "U1",
        text: "<@BBAXTER> hello",
        ts: "2.2",
        thread_ts: "2.1",
        team: "T123",
      },
      { eventId: "Ev-thread", teamId: "T123" },
    );

    expect(addSlackReaction).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C1", timestamp: "2.2", name: "eyes" }),
    );
    expect(removeSlackReaction).toHaveBeenCalledWith(expect.objectContaining({ timestamp: "2.2" }));
    expect(postSlackMessage).toHaveBeenCalledWith(expect.objectContaining({ threadTs: "2.1" }));
  });

  it("still answers when reaction add fails", async () => {
    addSlackReaction.mockResolvedValue({ ok: false, error: "missing_scope" });

    await handleBaxterSlackEvent(
      {
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        text: "hi",
        ts: "1.2",
        team: "T123",
      },
      { eventId: "Ev2", teamId: "T123" },
    );

    expect(answerBaxterQuestion).toHaveBeenCalled();
    expect(postSlackMessage).toHaveBeenCalled();
    // Cleanup is always attempted (eyes may have been added at accept time).
    expect(removeSlackReaction).toHaveBeenCalled();
    expect(updateSlackEventReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "Ev2", status: "completed" }),
    );
  });

  it("does not mark answer failed when reaction remove fails", async () => {
    removeSlackReaction.mockResolvedValue({ ok: false, error: "missing_scope" });

    await handleBaxterSlackEvent(
      {
        type: "app_mention",
        channel: "C1",
        user: "U1",
        text: "<@B> hello",
        ts: "2.2",
        thread_ts: "2.1",
        team: "T123",
      },
      { eventId: "Ev3", teamId: "T123" },
    );

    expect(updateSlackEventReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "Ev3", status: "completed" }),
    );
  });

  it("does not react to bot-generated events", async () => {
    await handleBaxterSlackEvent(
      {
        type: "message",
        bot_id: "B9",
        channel: "D1",
        text: "I am a bot",
        ts: "3.3",
        team: "T123",
      },
      { eventId: "Ev-bot", teamId: "T123" },
    );
    expect(addSlackReaction).not.toHaveBeenCalled();
    expect(answerBaxterQuestion).not.toHaveBeenCalled();
  });

  it("exports eyes reaction constant for Slack API name", () => {
    expect(SLACK_EYES_REACTION).toBe("eyes");
  });
});

describe("Slack accept-time processing reaction", () => {
  beforeEach(() => {
    setSlackEnv();
  });

  it("adds eyes after accept for a DM and does not enqueue ignored bots", async () => {
    const { acceptBaxterSlackEvent } = await import("@/lib/slack/baxter-events");

    const ignored = await acceptBaxterSlackEvent({
      eventId: "Ev-ignore-bot",
      teamId: "T123",
      event: {
        type: "message",
        bot_id: "B1",
        channel: "D1",
        text: "bot",
        ts: "9.9",
      },
    });
    expect(ignored.jobId).toBeUndefined();
    expect(addSlackReaction).not.toHaveBeenCalled();

    addSlackReaction.mockClear();
    const accepted = await acceptBaxterSlackEvent({
      eventId: "Ev-accept-dm",
      teamId: "T123",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        text: "Who is Baxter?",
        ts: "10.10",
        team: "T123",
      },
    });
    expect(accepted.duplicate).toBe(false);
    expect(accepted.jobId).toBeTruthy();
    expect(addSlackReaction).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "D1", timestamp: "10.10", name: "eyes" }),
    );
  });

  it("tolerates already_reacted on add", async () => {
    addSlackReaction.mockResolvedValue({ ok: true }); // already_reacted mapped to ok in client
    const { acceptBaxterSlackEvent } = await import("@/lib/slack/baxter-events");
    const accepted = await acceptBaxterSlackEvent({
      eventId: "Ev-already",
      teamId: "T123",
      event: {
        type: "app_mention",
        channel: "C1",
        user: "U1",
        text: "<@B> hi",
        ts: "11.11",
        team: "T123",
      },
    });
    expect(accepted.jobId).toBeTruthy();
  });
});
