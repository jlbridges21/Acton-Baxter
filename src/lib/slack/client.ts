import "server-only";

import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { mapSlackApiErrorToCode, SLACK_ERROR_CODES, type SlackErrorCode } from "./errors";

export class SlackClientError extends AppError {
  readonly slackError: string | null;
  readonly baxterCode: SlackErrorCode;
  readonly httpStatus: number;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      slackError?: string | null;
      baxterCode?: SlackErrorCode;
      retryAfterSeconds?: number | null;
    },
  ) {
    super(message, {
      code: options?.baxterCode ?? "SLACK_CLIENT_ERROR",
      statusCode: options?.statusCode ?? 502,
      expose: false,
    });
    this.name = "SlackClientError";
    this.slackError = options?.slackError ?? null;
    this.baxterCode = options?.baxterCode ?? SLACK_ERROR_CODES.POST_FAILED;
    this.httpStatus = options?.statusCode ?? 502;
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
  }
}

export type SlackPostMessageInput = {
  channel: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
};

export type SlackPostEphemeralInput = {
  channel: string;
  user: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postOnce(
  token: string,
  input: SlackPostMessageInput,
): Promise<
  | { ok: true; ts?: string }
  | { ok: false; error: string; retryAfter: number | null; status: number }
> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
      ...(input.blocks ? { blocks: input.blocks } : {}),
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      // Never broadcast threaded replies into the channel.
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  const retryAfterHeader = response.headers.get("Retry-After");
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;

  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    ts?: string;
  } | null;

  if (response.status === 429 || data?.error === "ratelimited") {
    return {
      ok: false,
      error: "ratelimited",
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : 3,
      status: 429,
    };
  }

  if (!response.ok || !data?.ok) {
    return {
      ok: false,
      error: data?.error ?? "request_failed",
      retryAfter: null,
      status: response.status,
    };
  }

  return { ok: true, ts: data.ts };
}

export async function postSlackMessage(
  input: SlackPostMessageInput,
): Promise<{ ok: true; ts?: string }> {
  const env = getEnv();
  if (!env.SLACK_BOT_TOKEN) {
    throw new SlackClientError("SLACK_BOT_TOKEN is not configured", {
      statusCode: 500,
      baxterCode: SLACK_ERROR_CODES.MISCONFIGURED,
    });
  }

  const maxAttempts = 3;
  let lastError: string | null = null;
  let lastStatus = 502;
  let lastRetryAfter: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await postOnce(env.SLACK_BOT_TOKEN, input);
    if (result.ok) return { ok: true, ts: result.ts };

    lastError = result.error;
    lastStatus = result.status;
    lastRetryAfter = result.retryAfter;

    if (result.error === "ratelimited" && attempt < maxAttempts) {
      const waitSeconds = Math.min(Math.max(result.retryAfter ?? 2, 1), 10);
      await sleep(waitSeconds * 1000);
      continue;
    }

    if (result.error === "msg_too_long") {
      throw new SlackClientError("Slack API error: msg_too_long", {
        statusCode: lastStatus,
        slackError: lastError,
        baxterCode: SLACK_ERROR_CODES.POST_FAILED,
      });
    }

    break;
  }

  throw new SlackClientError(
    lastError ? `Slack API error: ${lastError}` : "Slack API request failed",
    {
      statusCode: lastStatus,
      slackError: lastError,
      baxterCode: mapSlackApiErrorToCode(lastError),
      retryAfterSeconds: lastRetryAfter,
    },
  );
}

/**
 * Post an ephemeral message visible only to one user in a channel.
 * Same retry/error style as postSlackMessage.
 */
export async function postEphemeralSlackMessage(
  input: SlackPostEphemeralInput,
): Promise<{ ok: true; ts?: string }> {
  const env = getEnv();
  if (!env.SLACK_BOT_TOKEN) {
    throw new SlackClientError("SLACK_BOT_TOKEN is not configured", {
      statusCode: 500,
      baxterCode: SLACK_ERROR_CODES.MISCONFIGURED,
    });
  }

  const maxAttempts = 3;
  let lastError: string | null = null;
  let lastStatus = 502;
  let lastRetryAfter: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch("https://slack.com/api/chat.postEphemeral", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: input.channel,
        user: input.user,
        text: input.text,
        ...(input.blocks ? { blocks: input.blocks } : {}),
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      }),
    });

    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message_ts?: string;
    } | null;

    if (response.status === 429 || data?.error === "ratelimited") {
      lastError = "ratelimited";
      lastStatus = 429;
      lastRetryAfter = Number.isFinite(retryAfter) ? retryAfter : 3;
      if (attempt < maxAttempts) {
        await sleep(Math.min(Math.max(lastRetryAfter ?? 2, 1), 10) * 1000);
        continue;
      }
      break;
    }

    if (!response.ok || !data?.ok) {
      lastError = data?.error ?? "request_failed";
      lastStatus = response.status;
      lastRetryAfter = null;
      break;
    }

    return { ok: true, ts: data.message_ts };
  }

  throw new SlackClientError(
    lastError ? `Slack API error: ${lastError}` : "Slack ephemeral request failed",
    {
      statusCode: lastStatus,
      slackError: lastError,
      baxterCode: mapSlackApiErrorToCode(lastError),
      retryAfterSeconds: lastRetryAfter,
    },
  );
}

/** Slack reaction name for the 👀 emoji. */
export const SLACK_EYES_REACTION = "eyes";

export type SlackReactionInput = {
  channel: string;
  timestamp: string;
  name?: string;
};

export async function addProcessingReaction(input: {
  channel: string;
  timestamp: string;
}): Promise<{ ok: boolean; error?: string }> {
  return addSlackReaction({
    channel: input.channel,
    timestamp: input.timestamp,
    name: SLACK_EYES_REACTION,
  });
}

export async function removeProcessingReaction(input: {
  channel: string;
  timestamp: string;
}): Promise<{ ok: boolean; error?: string }> {
  return removeSlackReaction({
    channel: input.channel,
    timestamp: input.timestamp,
    name: SLACK_EYES_REACTION,
  });
}

/**
 * Add a reaction to a Slack message. Cosmetic only — never throws.
 * Requires reactions:write. Failures are logged safely by the caller.
 */
export async function addSlackReaction(
  input: SlackReactionInput,
): Promise<{ ok: boolean; error?: string }> {
  return slackReactionRequest("reactions.add", input);
}

/**
 * Remove a reaction Baxter previously added. Cosmetic only — never throws.
 */
export async function removeSlackReaction(
  input: SlackReactionInput,
): Promise<{ ok: boolean; error?: string }> {
  return slackReactionRequest("reactions.remove", input);
}

async function slackReactionRequest(
  method: "reactions.add" | "reactions.remove",
  input: SlackReactionInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const env = getEnv();
    if (!env.SLACK_BOT_TOKEN) {
      return { ok: false, error: "missing_bot_token" };
    }
    if (!input.channel || !input.timestamp) {
      return { ok: false, error: "missing_channel_or_timestamp" };
    }

    const name = input.name ?? SLACK_EYES_REACTION;
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: input.channel,
        timestamp: input.timestamp,
        name,
      }),
    });

    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;

    if (!data?.ok) {
      // already_reacted / no_reaction are benign for our add/remove lifecycle
      const error = data?.error ?? "reaction_failed";
      if (error === "already_reacted" || error === "no_reaction") {
        return { ok: true };
      }
      return { ok: false, error };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "reaction_exception" };
  }
}

export async function authTestSlack(): Promise<{
  ok: boolean;
  error?: string;
  team?: string;
  user?: string;
}> {
  const env = getEnv();
  if (!env.SLACK_BOT_TOKEN) {
    return { ok: false, error: "missing_bot_token" };
  }

  const response = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
  });

  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    team?: string;
    user?: string;
  } | null;

  if (!data?.ok) {
    return { ok: false, error: data?.error ?? "auth_test_failed" };
  }

  return { ok: true, team: data.team, user: data.user };
}
