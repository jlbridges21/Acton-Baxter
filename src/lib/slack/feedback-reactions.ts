/**
 * Baxter Q&A thumbs feedback via Slack reactions.
 * Separate from the Q&A pipeline (shouldIgnoreSlackEvent still drops reaction_*).
 */

import "server-only";

import { deleteSlackMessageFeedback, upsertSlackMessageFeedback } from "@/lib/baxter-ai/feedback";
import { findAssistantMessageBySlackRef } from "@/lib/baxter-ai/conversations";
import { postEphemeralSlackMessage } from "@/lib/slack/client";
import { ratingFromSlackReaction } from "@/lib/slack/feedback-emoji";
import { buildNegativeFeedbackEphemeralBlocks } from "@/lib/slack/feedback-interactions";

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

  const feedback = await upsertSlackMessageFeedback({
    messageId: message.id,
    conversationId: message.conversation_id,
    slackUserId,
    slackTeamId: teamId,
    rating,
    // Positive: no comment. Negative: capture rating even if follow-up never completes;
    // clear prior comment when flipping rating so a new thumbs-down starts fresh.
    comment: null,
    preserveCommentIfUnset: false,
  });

  if (rating === "up") {
    console.info("[slack.feedback.reaction.recorded]", { rating: "up" });
    return { handled: true, outcome: "up" };
  }

  // Negative: ephemeral prompt → button → modal (trigger_id only available on click).
  try {
    await postEphemeralSlackMessage({
      channel,
      user: slackUserId,
      threadTs: messageTs,
      text: "Thanks for the feedback — want to tell us more?",
      blocks: buildNegativeFeedbackEphemeralBlocks({
        feedbackId: feedback.id,
        messageId: message.id,
        conversationId: message.conversation_id,
      }),
    });
  } catch (error) {
    console.error("[slack.feedback.reaction.ephemeral_failed]", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  console.info("[slack.feedback.reaction.recorded]", { rating: "down" });
  return { handled: true, outcome: "down" };
}
