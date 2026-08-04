/**
 * Baxter Q&A thumbs feedback via Slack reactions.
 * Separate from the Q&A pipeline (shouldIgnoreSlackEvent still drops reaction_*).
 */

import "server-only";

import {
  deleteSlackMessageFeedback,
  getSlackMessageFeedback,
  upsertSlackMessageFeedback,
} from "@/lib/baxter-ai/feedback";
import { findAssistantMessageBySlackRef } from "@/lib/baxter-ai/conversations";
import { postEphemeralSlackMessage } from "@/lib/slack/client";
import { ratingFromSlackReaction } from "@/lib/slack/feedback-emoji";
import {
  buildAlreadyGaveFeedbackEphemeral,
  buildNegativeFeedbackEphemeralBlocks,
} from "@/lib/slack/feedback-interactions";

export type SlackReactionFeedbackEvent = {
  type?: string;
  user?: string;
  bot_id?: string;
  reaction?: string;
  item?: { type?: string; channel?: string; ts?: string };
  item_user?: string;
  event_ts?: string;
  team?: string;
};

export type HandleBaxterFeedbackReactionResult =
  | { handled: true; outcome: "up" | "down" | "removed" | "ignored"; reason?: string }
  | { handled: false; reason: string };

function hasFeedbackComment(comment: string | null | undefined): boolean {
  return typeof comment === "string" && comment.trim().length > 0;
}

/**
 * Handle reaction_added / reaction_removed for Baxter answer feedback.
 * Call only for reaction_* events that are not monitoring findings.
 */
export async function handleBaxterFeedbackReaction(input: {
  event: SlackReactionFeedbackEvent;
  teamId?: string | null;
}): Promise<HandleBaxterFeedbackReactionResult> {
  const event = input.event;
  const eventType = event.type ?? "";

  if (eventType !== "reaction_added" && eventType !== "reaction_removed") {
    return { handled: false, reason: "not_reaction_event" };
  }

  if (event.bot_id) {
    console.info("[slack.feedback.reaction.ignored]", { reason: "bot_actor" });
    return { handled: true, outcome: "ignored", reason: "bot_actor" };
  }

  const slackUserId = event.user?.trim();
  if (!slackUserId) {
    console.info("[slack.feedback.reaction.ignored]", { reason: "missing_user" });
    return { handled: true, outcome: "ignored", reason: "missing_user" };
  }

  const channel = event.item?.channel?.trim();
  const messageTs = event.item?.ts?.trim();
  if (!channel || !messageTs) {
    console.info("[slack.feedback.reaction.ignored]", { reason: "missing_item_ref" });
    return { handled: true, outcome: "ignored", reason: "missing_item_ref" };
  }

  const rating = ratingFromSlackReaction(event.reaction ?? "");
  if (!rating) {
    console.info("[slack.feedback.reaction.ignored]", {
      reason: "untracked_emoji",
      reaction: (event.reaction ?? "").split("::")[0] ?? null,
    });
    return { handled: true, outcome: "ignored", reason: "untracked_emoji" };
  }

  const message = await findAssistantMessageBySlackRef({
    slackChannelId: channel,
    slackMessageTs: messageTs,
  });
  if (!message) {
    console.info("[slack.feedback.reaction.ignored]", {
      reason: "unmatched_message",
      reaction: rating,
    });
    return { handled: true, outcome: "ignored", reason: "unmatched_message" };
  }

  const teamId = input.teamId ?? event.team ?? null;

  if (eventType === "reaction_removed") {
    const removed = await deleteSlackMessageFeedback({
      messageId: message.id,
      slackUserId,
      rating,
    });
    console.info("[slack.feedback.reaction.removed]", {
      matched: removed,
      rating,
    });
    return { handled: true, outcome: removed ? "removed" : "ignored", reason: "removed" };
  }

  const existing =
    rating === "down"
      ? await getSlackMessageFeedback({ messageId: message.id, slackUserId })
      : null;
  const alreadyCommented = hasFeedbackComment(existing?.comment);

  const feedback = await upsertSlackMessageFeedback({
    messageId: message.id,
    conversationId: message.conversation_id,
    slackUserId,
    slackTeamId: teamId,
    rating,
    // Positive: no comment. Negative with prior comment: keep it.
    // Negative without comment: clear so a fresh thumbs-down can solicit follow-up.
    comment: null,
    preserveCommentIfUnset: alreadyCommented,
  });

  if (rating === "up") {
    console.info("[slack.feedback.reaction.recorded]", { rating: "up" });
    return { handled: true, outcome: "up" };
  }

  // Negative: ephemeral prompt → button → modal (trigger_id only available on click).
  // Do NOT pass thread_ts = reacted message ts: channel answers are thread *replies*,
  // and Slack rejects/hides ephemerals when thread_ts is a reply (use parent, or omit).
  // Omitting thread_ts posts a channel/DM-visible ephemeral the reactor can see.
  //
  // Repeat 👎 after a comment was already left: do not re-prompt Tell us more.
  if (alreadyCommented) {
    const already = buildAlreadyGaveFeedbackEphemeral({ priorComment: existing?.comment });
    const ephemeral = await postEphemeralSlackMessage({
      channel,
      user: slackUserId,
      text: already.text,
      blocks: already.blocks,
    });
    if (!ephemeral.ok) {
      console.error("[slack.feedback.ephemeral_failed]", {
        channelId: channel,
        error: ephemeral.error ?? null,
        kind: "already_commented",
      });
    } else {
      console.info("[slack.feedback.ephemeral_ok]", {
        channelId: channel,
        kind: "already_commented",
      });
    }
    console.info("[slack.feedback.reaction.recorded]", {
      rating: "down",
      alreadyCommented: true,
    });
    return { handled: true, outcome: "down", reason: "already_commented" };
  }

  const ephemeral = await postEphemeralSlackMessage({
    channel,
    user: slackUserId,
    text: "Thanks for the feedback — want to tell us more?",
    blocks: buildNegativeFeedbackEphemeralBlocks({
      feedbackId: feedback.id,
      messageId: message.id,
      conversationId: message.conversation_id,
    }),
  });
  if (!ephemeral.ok) {
    // Match eyes-reaction convention: structured error code, never silent.
    console.error("[slack.feedback.ephemeral_failed]", {
      channelId: channel,
      error: ephemeral.error ?? null,
    });
  } else {
    console.info("[slack.feedback.ephemeral_ok]", { channelId: channel });
  }

  console.info("[slack.feedback.reaction.recorded]", { rating: "down" });
  return { handled: true, outcome: "down" };
}
