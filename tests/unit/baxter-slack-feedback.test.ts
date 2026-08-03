import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  assertFeedbackActor,
  listFeedbackForAdmin,
  resetBaxterFeedbackMemoryForTests,
  updateSlackFeedbackComment,
  upsertMessageFeedback,
  upsertSlackMessageFeedback,
} from "@/lib/baxter-ai/feedback";
import {
  attachSlackMessageRef,
  findAssistantMessageBySlackRef,
  getOrCreateConversation,
  appendAssistantMessage,
  appendUserMessage,
  resetBaxterConversationMemoryForTests,
} from "@/lib/baxter-ai/conversations";
import { normalizeSlackReactionName, ratingFromSlackReaction } from "@/lib/slack/feedback-emoji";
import { handleBaxterFeedbackReaction } from "@/lib/slack/feedback-reactions";
import {
  BAXTER_FEEDBACK_COMMENT_CALLBACK,
  BAXTER_FEEDBACK_TELL_MORE_ACTION,
  handleBaxterFeedbackViewSubmission,
} from "@/lib/slack/feedback-interactions";
import { ValidationError } from "@/lib/errors";

const postEphemeralSlackMessage = vi.fn();
const openSlackModal = vi.fn();

vi.mock("@/lib/slack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/slack/client")>();
  return {
    ...actual,
    postEphemeralSlackMessage: (...args: unknown[]) => postEphemeralSlackMessage(...args),
  };
});

vi.mock("@/lib/slack/provisioning", () => ({
  openSlackModal: (...args: unknown[]) => openSlackModal(...args),
  updateSlackModal: vi.fn(),
  openSlackDm: vi.fn(),
  createPublicSlackChannel: vi.fn(),
  lookupSlackUserByEmail: vi.fn(),
  inviteUsersToSlackChannel: vi.fn(),
}));

async function seedSlackAnswer(input?: { channelId?: string; messageTs?: string }) {
  const conversation = await getOrCreateConversation({
    userId: null,
    userName: "Tester",
    channel: "slack",
    externalThreadId: "T1:C1:thread",
    externalUserId: "U_ASKER",
  });
  await appendUserMessage({
    conversationId: conversation.id,
    content: "How do we kick off a project?",
  });
  const assistant = await appendAssistantMessage({
    conversationId: conversation.id,
    content: "Start with the project setup checklist.",
    insufficientKnowledge: false,
    confidence: "high",
    modelProvider: "openai",
    modelName: "test",
    sources: [],
    sourceEntryIds: [],
  });
  const channelId = input?.channelId ?? "C_TEST";
  const messageTs = input?.messageTs ?? "1710000000.000100";
  await attachSlackMessageRef({
    messageId: assistant.id,
    slackChannelId: channelId,
    slackMessageTs: messageTs,
  });
  return { conversation, assistant, channelId, messageTs };
}

beforeEach(() => {
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetBaxterConversationMemoryForTests();
  resetBaxterFeedbackMemoryForTests();
  vi.clearAllMocks();
  postEphemeralSlackMessage.mockResolvedValue({ ok: true, ts: "1.2" });
  openSlackModal.mockResolvedValue(undefined);
});

describe("emoji normalization", () => {
  it("strips skin-tone suffixes and maps aliases", () => {
    expect(normalizeSlackReactionName("+1::skin-tone-3")).toBe("+1");
    expect(normalizeSlackReactionName("thumbsup::skin-tone-2")).toBe("thumbsup");
    expect(normalizeSlackReactionName("-1::skin-tone-5")).toBe("-1");
    expect(normalizeSlackReactionName("ThumbsDown")).toBe("thumbsdown");

    expect(ratingFromSlackReaction("+1")).toBe("up");
    expect(ratingFromSlackReaction("thumbsup::skin-tone-4")).toBe("up");
    expect(ratingFromSlackReaction("-1")).toBe("down");
    expect(ratingFromSlackReaction("thumbsdown")).toBe("down");
    expect(ratingFromSlackReaction("eyes")).toBeNull();
    expect(ratingFromSlackReaction("heart")).toBeNull();
    expect(ratingFromSlackReaction("white_check_mark")).toBeNull();
  });
});

describe("message ref resolution", () => {
  it("matches reactions to the Baxter assistant message and ignores others", async () => {
    const { assistant, channelId, messageTs } = await seedSlackAnswer();

    const hit = await findAssistantMessageBySlackRef({
      slackChannelId: channelId,
      slackMessageTs: messageTs,
    });
    expect(hit?.id).toBe(assistant.id);

    const miss = await findAssistantMessageBySlackRef({
      slackChannelId: channelId,
      slackMessageTs: "999.999",
    });
    expect(miss).toBeNull();

    const ignored = await handleBaxterFeedbackReaction({
      teamId: "T1",
      event: {
        type: "reaction_added",
        user: "U_REACTOR",
        reaction: "+1",
        item: { channel: channelId, ts: "999.999" },
      },
    });
    expect(ignored.handled).toBe(true);
    if (ignored.handled) {
      expect(ignored.outcome).toBe("ignored");
      expect(ignored.reason).toBe("unmatched_message");
    }
  });
});

describe("slack feedback upsert", () => {
  it("dedupes by slack user when flipping 👍 to 👎", async () => {
    const { assistant, conversation, channelId, messageTs } = await seedSlackAnswer();

    const up = await handleBaxterFeedbackReaction({
      teamId: "T1",
      event: {
        type: "reaction_added",
        user: "U_REACTOR",
        reaction: "+1::skin-tone-2",
        item: { channel: channelId, ts: messageTs },
      },
    });
    expect(up).toMatchObject({ handled: true, outcome: "up" });
    expect(postEphemeralSlackMessage).not.toHaveBeenCalled();

    const down = await handleBaxterFeedbackReaction({
      teamId: "T1",
      event: {
        type: "reaction_added",
        user: "U_REACTOR",
        reaction: "thumbsdown",
        item: { channel: channelId, ts: messageTs },
      },
    });
    expect(down).toMatchObject({ handled: true, outcome: "down" });
    expect(postEphemeralSlackMessage).toHaveBeenCalledTimes(1);
    // Must not pass the reacted reply's ts as thread_ts (Slack hides/rejects that).
    expect(postEphemeralSlackMessage.mock.calls[0]?.[0]).toMatchObject({
      channel: channelId,
      user: "U_REACTOR",
    });
    expect(postEphemeralSlackMessage.mock.calls[0]?.[0]).not.toHaveProperty("threadTs");

    const listed = await listFeedbackForAdmin({ rating: "all", limit: 50 });
    const forMessage = listed.rows.filter((r) => r.messageId === assistant.id);
    expect(forMessage).toHaveLength(1);
    expect(forMessage[0]?.rating).toBe("down");
    expect(forMessage[0]?.channel).toBe("slack");
    expect(forMessage[0]?.conversationId).toBe(conversation.id);
  });

  it("updates comment on the existing negative row from modal submit", async () => {
    const { assistant, channelId, messageTs } = await seedSlackAnswer();

    await handleBaxterFeedbackReaction({
      teamId: "T1",
      event: {
        type: "reaction_added",
        user: "U_REACTOR",
        reaction: "-1",
        item: { channel: channelId, ts: messageTs },
      },
    });

    const before = await listFeedbackForAdmin({ rating: "down" });
    expect(before.rows).toHaveLength(1);
    const feedbackId = before.rows[0]!.id;

    const ephemeralArg = postEphemeralSlackMessage.mock.calls[0]?.[0] as {
      blocks?: Array<{ elements?: Array<{ action_id?: string; value?: string }> }>;
    };
    const button = ephemeralArg.blocks
      ?.flatMap((b) => b.elements ?? [])
      .find((el) => el.action_id === BAXTER_FEEDBACK_TELL_MORE_ACTION);
    expect(button?.value).toContain(feedbackId);

    const response = await handleBaxterFeedbackViewSubmission({
      type: "view_submission",
      user: { id: "U_REACTOR" },
      view: {
        callback_id: BAXTER_FEEDBACK_COMMENT_CALLBACK,
        private_metadata: JSON.stringify({
          feedbackId,
          messageId: assistant.id,
          conversationId: before.rows[0]!.conversationId,
          slackUserId: "U_REACTOR",
        }),
        state: {
          values: {
            what_went_wrong: {
              what_went_wrong_input: { value: "Missed the checklist link" },
            },
            what_expected: {
              what_expected_input: { value: "A direct link to the doc" },
            },
          },
        },
      },
    });
    expect(response).toEqual({});

    const after = await listFeedbackForAdmin({ rating: "down" });
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]?.id).toBe(feedbackId);
    expect(after.rows[0]?.comment).toContain("Missed the checklist link");
    expect(after.rows[0]?.comment).toContain("A direct link to the doc");
  });
});

describe("listFeedbackForAdmin", () => {
  it("filters and sorts newest-first across web + slack", async () => {
    const slack = await seedSlackAnswer({ messageTs: "1710000001.000100" });
    await upsertSlackMessageFeedback({
      messageId: slack.assistant.id,
      conversationId: slack.conversation.id,
      slackUserId: "U1",
      slackTeamId: "T1",
      rating: "up",
    });

    const web = await getOrCreateConversation({
      userId: "00000000-0000-4000-8000-000000000099",
      userName: "Web User",
      channel: "web",
    });
    await appendUserMessage({ conversationId: web.id, content: "Web question?" });
    const webAssistant = await appendAssistantMessage({
      conversationId: web.id,
      content: "Web answer",
      insufficientKnowledge: false,
      confidence: "medium",
      modelProvider: "openai",
      modelName: "test",
      sources: [],
      sourceEntryIds: [],
    });
    await upsertMessageFeedback({
      messageId: webAssistant.id,
      conversationId: web.id,
      userId: "00000000-0000-4000-8000-000000000099",
      rating: "down",
      comment: "Not helpful",
    });

    // Flip slack to down so we have two downs and can filter
    await upsertSlackMessageFeedback({
      messageId: slack.assistant.id,
      conversationId: slack.conversation.id,
      slackUserId: "U1",
      slackTeamId: "T1",
      rating: "down",
    });

    const all = await listFeedbackForAdmin({ rating: "all" });
    expect(all.positiveCount).toBe(0);
    expect(all.negativeCount).toBe(2);
    expect(all.rows.map((r) => r.channel).sort()).toEqual(["slack", "web"]);
    // Newest first: created_at descending
    for (let i = 1; i < all.rows.length; i += 1) {
      expect(all.rows[i - 1]!.createdAt >= all.rows[i]!.createdAt).toBe(true);
    }

    const ups = await listFeedbackForAdmin({ rating: "up" });
    expect(ups.rows).toHaveLength(0);

    const downs = await listFeedbackForAdmin({ rating: "down" });
    expect(downs.rows).toHaveLength(2);
  });
});

describe("feedback actor constraint", () => {
  it("allows slack-only or user-only actors and rejects neither", () => {
    expect(() => assertFeedbackActor({ slackUserId: "U1" })).not.toThrow();
    expect(() => assertFeedbackActor({ userId: "user-1" })).not.toThrow();
    expect(() => assertFeedbackActor({})).toThrow(ValidationError);
    expect(() => assertFeedbackActor({ userId: null, slackUserId: null })).toThrow(ValidationError);
  });
});

describe("ephemeral failure handling", () => {
  it("treats Slack ok:false as a logged failure, not silent success", async () => {
    const { channelId, messageTs } = await seedSlackAnswer();
    postEphemeralSlackMessage.mockResolvedValue({
      ok: false,
      error: "invalid_thread_ts",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await handleBaxterFeedbackReaction({
      teamId: "T1",
      event: {
        type: "reaction_added",
        user: "U_REACTOR",
        reaction: "-1",
        item: { channel: channelId, ts: messageTs },
      },
    });

    expect(result).toMatchObject({ handled: true, outcome: "down" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[slack.feedback.ephemeral_failed]",
      expect.objectContaining({
        channelId,
        error: "invalid_thread_ts",
      }),
    );
    errorSpy.mockRestore();
  });
});

describe("updateSlackFeedbackComment", () => {
  it("updates the same row without creating a duplicate", async () => {
    const { assistant, conversation } = await seedSlackAnswer();
    const created = await upsertSlackMessageFeedback({
      messageId: assistant.id,
      conversationId: conversation.id,
      slackUserId: "U_REACTOR",
      rating: "down",
      comment: null,
    });
    const updated = await updateSlackFeedbackComment({
      feedbackId: created.id,
      slackUserId: "U_REACTOR",
      comment: "What went wrong:\nToo vague",
    });
    expect(updated.id).toBe(created.id);
    const listed = await listFeedbackForAdmin({ rating: "down" });
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]?.comment).toContain("Too vague");
  });
});
