import "server-only";

import { getEnv } from "@/lib/env";
import { SlackClientError } from "./client";
import { SLACK_ERROR_CODES } from "./errors";

function botToken(): string {
  const env = getEnv();
  if (!env.SLACK_BOT_TOKEN) {
    throw new SlackClientError("SLACK_BOT_TOKEN is not configured", {
      statusCode: 500,
      baxterCode: SLACK_ERROR_CODES.MISCONFIGURED,
    });
  }
  return env.SLACK_BOT_TOKEN;
}

async function slackApi<T extends { ok?: boolean; error?: string }>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken()}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => null)) as T | null;
  if (!data) {
    throw new SlackClientError(`Slack API ${method} returned empty body`, {
      statusCode: response.status || 502,
      baxterCode: SLACK_ERROR_CODES.POST_FAILED,
    });
  }
  return data;
}

export async function openSlackModal(input: {
  triggerId: string;
  view: Record<string, unknown>;
}): Promise<void> {
  const data = await slackApi<{ ok?: boolean; error?: string }>("views.open", {
    trigger_id: input.triggerId,
    view: input.view,
  });
  if (!data.ok) {
    throw new SlackClientError(`Slack views.open failed: ${data.error ?? "unknown"}`, {
      statusCode: 502,
      slackError: data.error ?? null,
      baxterCode: SLACK_ERROR_CODES.POST_FAILED,
    });
  }
}

export async function updateSlackModal(input: {
  viewId: string;
  view: Record<string, unknown>;
  hash?: string;
}): Promise<void> {
  const data = await slackApi<{ ok?: boolean; error?: string }>("views.update", {
    view_id: input.viewId,
    ...(input.hash ? { hash: input.hash } : {}),
    view: input.view,
  });
  if (!data.ok) {
    throw new SlackClientError(`Slack views.update failed: ${data.error ?? "unknown"}`, {
      statusCode: 502,
      slackError: data.error ?? null,
      baxterCode: SLACK_ERROR_CODES.POST_FAILED,
    });
  }
}

export async function createPublicSlackChannel(name: string): Promise<{
  channelId: string;
  name: string;
  alreadyExistsError?: string;
}> {
  const data = await slackApi<{
    ok?: boolean;
    error?: string;
    channel?: { id?: string; name?: string };
  }>("conversations.create", {
    name,
    is_private: false,
  });

  if (data.ok && data.channel?.id) {
    return { channelId: data.channel.id, name: data.channel.name ?? name };
  }

  if (data.error === "name_taken") {
    return {
      channelId: "",
      name,
      alreadyExistsError: data.error,
    };
  }

  throw new SlackClientError(
    data.error
      ? `Could not create Slack channel #${name}: ${data.error}`
      : `Could not create Slack channel #${name}`,
    {
      statusCode: 502,
      slackError: data.error ?? null,
      baxterCode: SLACK_ERROR_CODES.POST_FAILED,
    },
  );
}

export async function lookupSlackUserByEmail(
  email: string,
): Promise<{ userId: string } | { notFound: true } | { error: string }> {
  const response = await fetch(
    `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${botToken()}` },
    },
  );
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    user?: { id?: string };
  } | null;

  if (data?.ok && data.user?.id) {
    return { userId: data.user.id };
  }
  if (data?.error === "users_not_found") {
    return { notFound: true };
  }
  return { error: data?.error ?? "lookup_failed" };
}

export type SlackInviteResult = {
  email: string;
  status: "invited" | "already_in_channel" | "not_found" | "failed";
  warning?: string;
  userId?: string;
};

export async function inviteUsersToSlackChannel(input: {
  channelId: string;
  userIds: string[];
  emailsByUserId: Record<string, string>;
}): Promise<{ results: SlackInviteResult[]; successCount: number }> {
  const results: SlackInviteResult[] = [];
  let successCount = 0;
  if (input.userIds.length === 0) {
    return { results, successCount };
  }

  const batch = await slackApi<{
    ok?: boolean;
    error?: string;
    errors?: Array<{ user?: string; error?: string }>;
  }>("conversations.invite", {
    channel: input.channelId,
    users: input.userIds.join(","),
  });

  if (batch.ok) {
    for (const userId of input.userIds) {
      successCount += 1;
      results.push({
        email: input.emailsByUserId[userId] ?? userId,
        status: "invited",
        userId,
      });
    }
    return { results, successCount };
  }

  // Partial failure or total failure — invite individually for clearer per-email results.
  for (const userId of input.userIds) {
    const email = input.emailsByUserId[userId] ?? userId;
    const one = await slackApi<{ ok?: boolean; error?: string }>("conversations.invite", {
      channel: input.channelId,
      users: userId,
    });
    if (one.ok) {
      successCount += 1;
      results.push({ email, status: "invited", userId });
      continue;
    }
    if (one.error === "already_in_channel") {
      results.push({
        email,
        status: "already_in_channel",
        userId,
        warning: `${email} is already in the channel`,
      });
      // Count as success for "at least one invite succeeded" purposes? Prompt says
      // "Emails not found … or already in the channel are recorded as warnings, NOT step failures.
      // The step fails only if channel creation fails or zero invites succeed."
      // already_in_channel means they're in the channel — treat as a soft success for the zero-check.
      successCount += 1;
      continue;
    }
    results.push({
      email,
      status: "failed",
      userId,
      warning: `${email}: ${one.error ?? "invite_failed"}`,
    });
  }

  return { results, successCount };
}

export async function openSlackDm(userId: string): Promise<{ channelId: string }> {
  const data = await slackApi<{
    ok?: boolean;
    error?: string;
    channel?: { id?: string };
  }>("conversations.open", {
    users: userId,
  });
  if (!data.ok || !data.channel?.id) {
    // Fallback: some workspaces accept the user id as a chat.postMessage channel.
    return { channelId: userId };
  }
  return { channelId: data.channel.id };
}
