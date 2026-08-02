/**
 * Slack interactivity for Baxter negative-feedback follow-up
 * (ephemeral button → modal → comment update).
 *
 * Keep this module free of GHL/Google/project-setup heavy imports so the
 * interactions route cold-start budget stays intact.
 */

import "server-only";

import { updateSlackFeedbackComment } from "@/lib/baxter-ai/feedback";
import { openSlackModal } from "@/lib/slack/provisioning";
import type { SlackInteractionPayload } from "@/lib/slack/interaction-payload";

export const BAXTER_FEEDBACK_TELL_MORE_ACTION = "baxter_feedback_tell_more";
export const BAXTER_FEEDBACK_COMMENT_CALLBACK = "baxter_feedback_comment";

export type FeedbackActionValue = {
  feedbackId: string;
  messageId: string;
  conversationId: string;
};

export function encodeFeedbackActionValue(value: FeedbackActionValue): string {
  return JSON.stringify(value);
}

export function decodeFeedbackActionValue(raw: unknown): FeedbackActionValue | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as FeedbackActionValue;
    if (
      !parsed ||
      typeof parsed.feedbackId !== "string" ||
      typeof parsed.messageId !== "string" ||
      typeof parsed.conversationId !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildNegativeFeedbackEphemeralBlocks(input: FeedbackActionValue): unknown[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Thanks for the feedback — want to tell us more?",
      },
    },
    {
      type: "actions",
      block_id: "baxter_feedback_actions",
      elements: [
        {
          type: "button",
          action_id: BAXTER_FEEDBACK_TELL_MORE_ACTION,
          text: { type: "plain_text", text: "Tell us more", emoji: true },
          value: encodeFeedbackActionValue(input),
        },
      ],
    },
  ];
}

function encodeModalMeta(value: FeedbackActionValue & { slackUserId: string }): string {
  return JSON.stringify(value);
}

function decodeModalMeta(raw: string | undefined | null):
  | (FeedbackActionValue & {
      slackUserId: string;
    })
  | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as FeedbackActionValue & { slackUserId?: string };
    if (!parsed?.feedbackId || !parsed.messageId || !parsed.conversationId || !parsed.slackUserId) {
      return null;
    }
    return parsed as FeedbackActionValue & { slackUserId: string };
  } catch {
    return null;
  }
}

export function buildFeedbackCommentModal(input: {
  meta: FeedbackActionValue & { slackUserId: string };
}): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: BAXTER_FEEDBACK_COMMENT_CALLBACK,
    private_metadata: encodeModalMeta(input.meta),
    title: { type: "plain_text", text: "Baxter feedback" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "what_went_wrong",
        label: { type: "plain_text", text: "What went wrong?" },
        element: {
          type: "plain_text_input",
          action_id: "what_went_wrong_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Briefly describe the issue with Baxter’s answer",
          },
        },
      },
      {
        type: "input",
        block_id: "what_expected",
        label: { type: "plain_text", text: "What were you expecting to see instead?" },
        element: {
          type: "plain_text_input",
          action_id: "what_expected_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "What would a better answer have included?",
          },
        },
      },
    ],
  };
}

function readInputValue(
  view: SlackInteractionPayload["view"],
  blockId: string,
  actionId: string,
): string {
  const block = view?.state?.values?.[blockId];
  const action = block?.[actionId];
  return action?.value?.trim() ?? "";
}

function formatFeedbackComment(wentWrong: string, expected: string): string {
  const parts: string[] = [];
  if (wentWrong) parts.push(`What went wrong:\n${wentWrong}`);
  if (expected) parts.push(`What they expected:\n${expected}`);
  return parts.join("\n\n").slice(0, 4000);
}

/**
 * Open the feedback modal from the ephemeral button click.
 * Must run synchronously while trigger_id is valid (do not defer with after()).
 */
export async function handleBaxterFeedbackBlockActions(
  payload: SlackInteractionPayload,
): Promise<{ handled: boolean }> {
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const action = actions[0] as { action_id?: string; value?: string } | undefined;
  if (!action || action.action_id !== BAXTER_FEEDBACK_TELL_MORE_ACTION) {
    return { handled: false };
  }

  const decoded = decodeFeedbackActionValue(action.value);
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  if (!decoded || !slackUserId || !triggerId) {
    console.info("[slack.feedback.interaction.ignored]", { reason: "missing_action_context" });
    return { handled: true };
  }

  await openSlackModal({
    triggerId,
    view: buildFeedbackCommentModal({
      meta: { ...decoded, slackUserId },
    }),
  });
  return { handled: true };
}

/**
 * Persist the modal comment onto the existing Slack feedback row.
 * Returns a Slack view_submission response body (usually empty close).
 */
export async function handleBaxterFeedbackViewSubmission(
  payload: SlackInteractionPayload,
): Promise<Record<string, unknown> | null> {
  const callbackId = payload.view?.callback_id ?? "";
  if (callbackId !== BAXTER_FEEDBACK_COMMENT_CALLBACK) return null;

  const meta = decodeModalMeta(payload.view?.private_metadata);
  const slackUserId = payload.user?.id;
  if (!meta || !slackUserId || meta.slackUserId !== slackUserId) {
    return {
      response_action: "errors",
      errors: {
        what_went_wrong: "Could not save feedback — try reacting 👎 again.",
      },
    };
  }

  const wentWrong = readInputValue(payload.view, "what_went_wrong", "what_went_wrong_input");
  const expected = readInputValue(payload.view, "what_expected", "what_expected_input");
  if (!wentWrong && !expected) {
    return {
      response_action: "errors",
      errors: {
        what_went_wrong: "Please share at least one detail.",
      },
    };
  }

  await updateSlackFeedbackComment({
    feedbackId: meta.feedbackId,
    slackUserId,
    comment: formatFeedbackComment(wentWrong, expected),
  });

  // Clear the modal.
  return {};
}
