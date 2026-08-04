/**
 * Lightweight helper for Slack interaction / slash-command response_url posts.
 * Kept separate from commands.ts so feedback interactivity does not pull in
 * GHL / property-research dependencies on the interactions cold path.
 */

import "server-only";

import { AppError } from "@/lib/errors";

export type SlackCommandAck = {
  response_type: "ephemeral";
  text: string;
  /** Optional Block Kit blocks (e.g. link buttons for `/pem` web handoff). */
  blocks?: unknown[];
};

/** Body for posting to an interaction `response_url` (including ephemeral replace/delete). */
export type SlackResponseUrlBody =
  | SlackCommandAck
  | {
      text?: string;
      blocks?: unknown[];
      replace_original?: boolean;
      delete_original?: boolean;
      response_type?: "ephemeral" | "in_channel";
    };

export async function postSlackResponseUrl(
  responseUrl: string,
  body: SlackResponseUrlBody,
): Promise<void> {
  const response = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new AppError(`Slack response_url failed with HTTP ${response.status}`, {
      code: "SLACK_RESPONSE_URL_FAILED",
      statusCode: 502,
      expose: false,
    });
  }
}
