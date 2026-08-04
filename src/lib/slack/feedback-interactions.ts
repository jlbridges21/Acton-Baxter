/**
 * Slack interactivity for Baxter negative-feedback follow-up
 * (ephemeral button → modal → comment update).
 *
 * Keep this module free of GHL/Google/project-setup heavy imports so the
 * interactions route cold-start budget stays intact.
 *
 * Ephemeral lifecycle: chat.postEphemeral messages cannot be updated via
 * chat.update. The block_actions payload includes a response_url for that
 * ephemeral; we thread it through modal private_metadata and POST
 * replace_original: true on successful submit.
 */

import "server-only";

import { updateSlackFeedbackComment } from "@/lib/baxter-ai/feedback";
import { openSlackModal } from "@/lib/slack/provisioning";
import type { SlackInteractionPayload } from "@/lib/slack/interaction-payload";
import { postSlackResponseUrl } from "@/lib/slack/response-url";

export const BAXTER_FEEDBACK_TELL_MORE_ACTION = "baxter_feedback_tell_more";
export const BAXTER_FEEDBACK_COMMENT_CALLBACK = "baxter_feedback_comment";

/** Plain confirmation after successful modal submit (no interactive elements). */
export const BAXTER_FEEDBACK_RECEIVED_TEXT = "We got your feedback. Thanks.";

export const BAXTER_FEEDBACK_ALREADY_GIVEN_TEXT = "You've already given feedback on this message";

export type FeedbackActionValue = {
  feedbackId: string;
  messageId: string;
  conversationId: string;
};

export type FeedbackModalMeta = FeedbackActionValue & {
  slackUserId: string;
  /** From the Tell us more button click — required to replace the ephemeral. */
  responseUrl?: string;
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

/** Confirmation shown via response_url replace_original after modal submit. */
export function buildFeedbackReceivedEphemeral(text: string = BAXTER_FEEDBACK_RECEIVED_TEXT): {
  replace_original: true;
  text: string;
  blocks: unknown[];
} {
  return {
    replace_original: true,
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
    ],
  };
}

/** Repeat 👎 after a comment was already left — no Tell us more button. */
export function buildAlreadyGaveFeedbackEphemeral(input: { priorComment?: string | null }): {
  text: string;
  blocks: unknown[];
} {
  const prior = input.priorComment?.trim();
  const detail =
    prior && prior.length > 0
      ? `${BAXTER_FEEDBACK_ALREADY_GIVEN_TEXT}:\n>${prior.replace(/\n/g, "\n>")}`
      : `${BAXTER_FEEDBACK_ALREADY_GIVEN_TEXT}.`;
  return {
    text: BAXTER_FEEDBACK_ALREADY_GIVEN_TEXT,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: detail },
      },
    ],
  };
}

export function encodeModalMeta(value: FeedbackModalMeta): string {
  return JSON.stringify(value);
}

export function decodeModalMeta(raw: string | undefined | null): FeedbackModalMeta | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as FeedbackModalMeta;
    if (!parsed?.feedbackId || !parsed.messageId || !parsed.conversationId || !parsed.slackUserId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildFeedbackCommentModal(input: {
  meta: FeedbackModalMeta;
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
 * Captures response_url into private_metadata so view_submission can replace
 * the ephemeral (view_submission does not carry the button's response_url).
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

  const responseUrl =
    typeof payload.response_url === "string" && payload.response_url.trim()
      ? payload.response_url.trim()
      : undefined;

  await openSlackModal({
    triggerId,
    view: buildFeedbackCommentModal({
      meta: { ...decoded, slackUserId, responseUrl },
    }),
  });
  return { handled: true };
}

/**
 * Persist the modal comment onto the existing Slack feedback row.
 * On success, replaces the original ephemeral via response_url (replace_original).
 * Dismiss without submit does not call this handler — ephemeral stays unchanged.
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

  if (meta.responseUrl) {
    try {
      await postSlackResponseUrl(meta.responseUrl, buildFeedbackReceivedEphemeral());
    } catch (error) {
      // Comment is already saved — don't fail the modal close over ephemeral replace.
      console.error("[slack.feedback.ephemeral_replace_failed]", {
        feedbackId: meta.feedbackId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    console.info("[slack.feedback.ephemeral_replace_skipped]", {
      reason: "missing_response_url",
      feedbackId: meta.feedbackId,
    });
  }

  // Clear the modal.
  return {};
}
