import "server-only";

import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { enqueueJob } from "@/lib/jobs/queue";
import {
  getSlackRuntimeConfig,
  isSlackChannelAllowed,
  isSlackUserAllowed,
} from "@/lib/slack/config";
import { employeeFacingSlackError, SLACK_ERROR_CODES } from "@/lib/slack/errors";
import { buildSlackReplySegments } from "@/lib/slack/format";
import { postSlackMessage, SlackClientError } from "@/lib/slack/client";
import { claimSlackEventReceipt, updateSlackEventReceipt } from "@/lib/slack/receipts";
import { logServerError } from "@/lib/errors";

export type SlackIncomingEvent = {
  type?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  team?: string;
  event_ts?: string;
};

export type SlackBaxterReplyPayload = {
  eventId: string;
  teamId: string | null;
  event: SlackIncomingEvent;
};

export function stripBotMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, "").trim();
}

export function shouldIgnoreSlackEvent(event: SlackIncomingEvent): boolean {
  if (event.bot_id) return true;
  if (event.subtype === "bot_message") return true;
  if (event.type !== "message" && event.type !== "app_mention") return true;
  if (event.type === "message" && event.subtype && event.subtype !== "file_share") {
    if (event.subtype !== "thread_broadcast") return true;
  }
  return false;
}

/**
 * Stable conversation keys:
 * - DM: team:channel:user
 * - Channel thread: team:channel:thread_ts
 */
export function buildSlackExternalThreadId(input: {
  teamId: string | null;
  channelId: string;
  userId: string | null;
  threadTs: string;
  isDm: boolean;
}): string {
  const team = input.teamId ?? "unknown";
  if (input.isDm) {
    return `${team}:${input.channelId}:${input.userId ?? "unknown"}`;
  }
  return `${team}:${input.channelId}:${input.threadTs}`;
}

export function isDirectMessageEvent(event: SlackIncomingEvent): boolean {
  return event.channel_type === "im" || event.type === "message";
}

export function evaluateSlackAccess(event: SlackIncomingEvent): {
  allowed: boolean;
  code?: string;
  isDm: boolean;
} {
  const config = getSlackRuntimeConfig();
  const isDm =
    event.channel_type === "im" ||
    (event.type === "message" &&
      event.channel_type !== "channel" &&
      event.channel_type !== "group");

  // app_mention is always a channel (or group) interaction.
  const treatAsDm = event.type === "app_mention" ? false : isDm || event.channel_type === "im";

  if (treatAsDm) {
    if (!config.enableDms) {
      return { allowed: false, code: SLACK_ERROR_CODES.DMS_DISABLED, isDm: true };
    }
  } else {
    if (!config.enableChannelMentions) {
      return { allowed: false, code: SLACK_ERROR_CODES.MENTIONS_DISABLED, isDm: false };
    }
    if (!isSlackChannelAllowed(event.channel)) {
      return { allowed: false, code: SLACK_ERROR_CODES.CHANNEL_NOT_ALLOWED, isDm: false };
    }
  }

  if (!isSlackUserAllowed(event.user)) {
    return { allowed: false, code: SLACK_ERROR_CODES.USER_NOT_ALLOWED, isDm: treatAsDm };
  }

  return { allowed: true, isDm: treatAsDm };
}

/** @deprecated Use claimSlackEventReceipt — kept for existing tests. */
export async function claimSlackEvent(eventId: string, eventType?: string, teamId?: string) {
  const result = await claimSlackEventReceipt({
    eventId,
    eventType,
    teamId,
  });
  return result.claimed;
}

export { buildBaxterSlackBlocks } from "./format";

export async function enqueueBaxterSlackReply(payload: SlackBaxterReplyPayload) {
  return enqueueJob({
    reportId: null,
    jobType: "slack_baxter_reply",
    metadata: {
      eventId: payload.eventId,
      teamId: payload.teamId,
      event: payload.event,
    },
  });
}

/**
 * Process a claimed Slack Baxter Q&A event (shared by job worker and after()).
 */
export async function handleBaxterSlackEvent(
  event: SlackIncomingEvent,
  options?: { eventId?: string; teamId?: string | null },
): Promise<void> {
  const config = getSlackRuntimeConfig();
  const eventId = options?.eventId;
  const teamId = options?.teamId ?? event.team ?? null;

  if (!config.enabled) {
    if (eventId) {
      await updateSlackEventReceipt({
        eventId,
        status: "ignored",
        errorCode: SLACK_ERROR_CODES.DISABLED,
      });
    }
    return;
  }

  if (!config.readyForEvents) {
    if (eventId) {
      await updateSlackEventReceipt({
        eventId,
        status: "failed",
        errorCode: SLACK_ERROR_CODES.MISCONFIGURED,
      });
    }
    return;
  }

  if (shouldIgnoreSlackEvent(event)) {
    if (eventId) {
      await updateSlackEventReceipt({
        eventId,
        status: "ignored",
        errorCode: SLACK_ERROR_CODES.EVENT_UNSUPPORTED,
      });
    }
    return;
  }

  const access = evaluateSlackAccess(event);
  if (!access.allowed) {
    if (eventId) {
      await updateSlackEventReceipt({
        eventId,
        status: "ignored",
        errorCode: access.code,
      });
    }
    return;
  }

  const text = stripBotMention(event.text ?? "");
  const channel = event.channel;
  if (!channel) {
    if (eventId) {
      await updateSlackEventReceipt({
        eventId,
        status: "ignored",
        errorCode: SLACK_ERROR_CODES.EVENT_UNSUPPORTED,
      });
    }
    return;
  }

  const threadTs = event.thread_ts || event.ts || null;
  if (!threadTs) {
    if (eventId) {
      await updateSlackEventReceipt({
        eventId,
        status: "ignored",
        errorCode: SLACK_ERROR_CODES.EVENT_UNSUPPORTED,
      });
    }
    return;
  }

  // Empty mention (just @Baxter) — reply with a short prompt, no AI call.
  if (!text) {
    try {
      await postSlackMessage({
        channel,
        threadTs,
        text: "*Baxter*\nAsk me a question about Acton procedures, general work help, or what I can do.",
      });
      if (eventId) {
        await updateSlackEventReceipt({ eventId, status: "completed" });
      }
    } catch (error) {
      await markPostFailure(eventId, error);
    }
    return;
  }

  const externalThreadId = buildSlackExternalThreadId({
    teamId,
    channelId: channel,
    userId: event.user ?? null,
    threadTs,
    isDm: access.isDm,
  });

  try {
    const result = await answerBaxterQuestion({
      question: text,
      userId: null,
      userName: event.user ? `Slack user ${event.user}` : "Slack user",
      channel: "slack",
      externalThreadId,
      externalUserId: event.user ?? null,
    });

    const segments = buildSlackReplySegments(result);
    for (const segment of segments) {
      await postSlackMessage({
        channel,
        threadTs,
        text: segment.text,
        blocks: segment.blocks,
      });
    }

    if (eventId) {
      await updateSlackEventReceipt({
        eventId,
        status: "completed",
        metadata: {
          conversationId: result.conversationId,
          sourceCount: result.sources.length,
          answerMode: result.answerMode ?? null,
        },
      });
    }
  } catch (error) {
    const code =
      error instanceof SlackClientError
        ? error.baxterCode
        : (resultErrorCode(error) ?? SLACK_ERROR_CODES.JOB_FAILED);

    logServerError("handleBaxterSlackEvent", {
      code,
      eventId: eventId ?? null,
      channelId: channel,
      threadTs,
      slackError: error instanceof SlackClientError ? error.slackError : null,
      httpStatus: error instanceof SlackClientError ? error.httpStatus : null,
    });

    try {
      await postSlackMessage({
        channel,
        threadTs,
        text: employeeFacingSlackError(code),
      });
    } catch (postError) {
      logServerError("handleBaxterSlackEvent:errorReply", {
        code: SLACK_ERROR_CODES.POST_FAILED,
        eventId: eventId ?? null,
        channelId: channel,
        threadTs,
        slackError: postError instanceof SlackClientError ? postError.slackError : null,
      });
    }

    if (eventId) {
      await updateSlackEventReceipt({
        eventId,
        status: "failed",
        errorCode: code,
      });
    }
  }
}

function resultErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: string; errorCode?: string };
  return record.errorCode ?? record.code ?? null;
}

async function markPostFailure(eventId: string | undefined, error: unknown) {
  const code = error instanceof SlackClientError ? error.baxterCode : SLACK_ERROR_CODES.POST_FAILED;
  if (eventId) {
    await updateSlackEventReceipt({ eventId, status: "failed", errorCode: code });
  }
}

/**
 * Job processor entry for slack_baxter_reply.
 */
export async function processSlackBaxterReplyJob(metadata: Record<string, unknown>): Promise<void> {
  const event = metadata.event as SlackIncomingEvent | undefined;
  const eventId = typeof metadata.eventId === "string" ? metadata.eventId : undefined;
  const teamId = typeof metadata.teamId === "string" ? metadata.teamId : null;
  if (!event) {
    throw new Error("slack_baxter_reply job missing event metadata");
  }
  await handleBaxterSlackEvent(event, { eventId, teamId });
}

/** Claim + enqueue a Slack Baxter reply job. Caller should process via after()/cron. */
export async function acceptBaxterSlackEvent(input: {
  eventId: string;
  teamId: string | null;
  event: SlackIncomingEvent;
}): Promise<{ duplicate: boolean; jobId?: string }> {
  const claim = await claimSlackEventReceipt({
    eventId: input.eventId,
    teamId: input.teamId,
    eventType: input.event.type,
    eventTs: input.event.event_ts ?? input.event.ts,
  });

  if (!claim.claimed) {
    return { duplicate: true };
  }

  const job = await enqueueBaxterSlackReply({
    eventId: input.eventId,
    teamId: input.teamId,
    event: input.event,
  });

  return { duplicate: false, jobId: job.id };
}
