import "server-only";

import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

export class SlackClientError extends AppError {
  constructor(message: string, statusCode = 502) {
    super(message, { code: "SLACK_CLIENT_ERROR", statusCode, expose: false });
    this.name = "SlackClientError";
  }
}

export type SlackPostMessageInput = {
  channel: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
};

export async function postSlackMessage(
  input: SlackPostMessageInput,
): Promise<{ ok: true; ts?: string }> {
  const env = getEnv();
  if (!env.SLACK_BOT_TOKEN) {
    throw new SlackClientError("SLACK_BOT_TOKEN is not configured", 500);
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
      blocks: input.blocks,
      thread_ts: input.threadTs,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    ts?: string;
  } | null;

  if (!response.ok || !data?.ok) {
    throw new SlackClientError(
      data?.error ? `Slack API error: ${data.error}` : "Slack API request failed",
    );
  }

  return { ok: true, ts: data.ts };
}
