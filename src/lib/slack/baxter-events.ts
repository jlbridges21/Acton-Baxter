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
import {
  addProcessingReaction,
  postSlackMessage,
  removeProcessingReaction,
  SlackClientError,
} from "@/lib/slack/client";
import { claimSlackEventReceipt, updateSlackEventReceipt } from "@/lib/slack/receipts";
import { observeSlackIdentities } from "@/lib/slack/profiles";
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
  /** Present on AI-enabled app message / app_mention events for Real-time Search. */
  action_token?: string;
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
  // Reaction events handled separately (monitoring reactions) — never enter Q&A pipeline.
  if (typeof event.type === "string" && event.type.startsWith("reaction_")) return true;
  if (event.type !== "message" && event.type !== "app_mention") return true;
  if (event.type === "message" && event.subtype && event.subtype !== "file_share") {
    if (event.subtype !== "thread_broadcast") return true;
  }
  return false;
}

/**
 * Handle Slack reaction to monitoring finding.
 * ✅ = acknowledge
 * ❌ = dismiss as false positive
 */
export async function handleMonitoringReaction(metadata: Record<string, unknown>): Promise<void> {
  const { findBySlackMessage, acknowledgeFinding, dismissFalsePositive } =
    await import("@/lib/monitoring");

  const channel = typeof metadata.channel === "string" ? metadata.channel : null;
  const ts = typeof metadata.ts === "string" ? metadata.ts : null;
  const reaction = typeof metadata.reaction === "string" ? metadata.reaction : null;
  const user = typeof metadata.user === "string" ? metadata.user : null;

  if (!channel || !ts || !reaction || !user) {
    throw new Error("slack_monitoring_reaction job missing required metadata");
  }

  const finding = await findBySlackMessage(channel, ts);
  if (!finding) {
    return;
  }

  if (reaction === "white_check_mark") {
    await acknowledgeFinding(finding.id, user);
  } else if (reaction === "x") {
    await dismissFalsePositive(finding.id, user);
  }
}

/**
 * Stable conversation keys:
 * - DM: team:channel:user (does not use Slack thread_ts)
 * - Channel thread: team:channel:root_thread_ts
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

/**
 * Slack posting thread target:
 * - DMs: omit thread_ts so replies stay in the main DM timeline
 * - Channel mentions: thread under event.thread_ts ?? event.ts
 */
export function resolveSlackReplyThreadTs(
  event: SlackIncomingEvent,
  isDm: boolean,
): string | undefined {
  if (isDm) return undefined;
  return event.thread_ts ?? event.ts ?? undefined;
}

export function isDirectMessageEvent(event: SlackIncomingEvent): boolean {
  return event.channel_type === "im" || event.type === "message";
}

export function evaluateSlackAccess(event: SlackIncomingEvent): {
  allowed: boolean;
  code?: string;
  reason?: string;
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
      return {
        allowed: false,
        code: SLACK_ERROR_CODES.DMS_DISABLED,
        reason: "dms_disabled",
        isDm: true,
      };
    }
  } else {
    if (!config.enableChannelMentions) {
      return {
        allowed: false,
        code: SLACK_ERROR_CODES.MENTIONS_DISABLED,
        reason: "channel_mentions_disabled",
        isDm: false,
      };
    }
    if (!isSlackChannelAllowed(event.channel)) {
      return {
        allowed: false,
        code: SLACK_ERROR_CODES.CHANNEL_NOT_ALLOWED,
        reason: "channel_not_in_allowlist",
        isDm: false,
      };
    }
  }

  if (!isSlackUserAllowed(event.user)) {
    return {
      allowed: false,
      code: SLACK_ERROR_CODES.USER_NOT_ALLOWED,
      reason: "user_not_allowed",
      isDm: treatAsDm,
    };
  }

  return { allowed: true, isDm: treatAsDm };
}

/** Safe diagnostic log for ignored Slack mentions/events — never logs text, tokens, or secrets. */
export function logIgnoredSlackMention(input: {
  eventType: string | undefined;
  teamId: string | null;
  channelId: string | null | undefined;
  reason: string;
  code?: string;
}) {
  console.error("[slack.mention.ignored]", {
    eventType: input.eventType ?? null,
    teamId: input.teamId,
    channelId: input.channelId ?? null,
    reason: input.reason,
    code: input.code ?? null,
  });
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
    logIgnoredSlackMention({
      eventType: event.type,
      teamId,
      channelId: event.channel,
      reason: event.bot_id || event.subtype === "bot_message" ? "bot_message" : "unsupported_event",
      code: SLACK_ERROR_CODES.EVENT_UNSUPPORTED,
    });
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
    logIgnoredSlackMention({
      eventType: event.type,
      teamId,
      channelId: event.channel,
      reason: access.reason ?? access.code ?? "access_denied",
      code: access.code,
    });
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
  const channelId: string = channel;

  // Channel mentions must thread under the mention (or existing thread).
  // DMs must post top-level — never pass thread_ts for message.im.
  const replyThreadTs = resolveSlackReplyThreadTs(event, access.isDm);
  if (!access.isDm && !replyThreadTs) {
    if (eventId) {
      await updateSlackEventReceipt({
        eventId,
        status: "ignored",
        errorCode: SLACK_ERROR_CODES.EVENT_UNSUPPORTED,
      });
    }
    return;
  }

  // Conversation memory key: DMs use team+channel+user; channels use root thread ts.
  const conversationRootTs = access.isDm
    ? event.ts || event.event_ts || "dm"
    : (replyThreadTs as string);

  // React to the triggering user message (not the thread root unless they are the same).
  const reactionTs = event.ts ?? null;

  async function tryAddEyesReaction() {
    if (!reactionTs) return;
    const result = await addProcessingReaction({
      channel: channelId,
      timestamp: reactionTs,
    });
    if (!result.ok) {
      console.error("[slack.reaction.add_failed]", {
        channelId,
        timestamp: reactionTs,
        error: result.error ?? null,
      });
    }
  }

  async function tryRemoveEyesReaction() {
    // Always attempt cleanup — eyes may have been added at accept time in another process.
    if (!reactionTs) return;
    const result = await removeProcessingReaction({
      channel: channelId,
      timestamp: reactionTs,
    });
    if (!result.ok) {
      console.error("[slack.reaction.remove_failed]", {
        channelId,
        timestamp: reactionTs,
        error: result.error ?? null,
      });
    }
  }

  // Empty mention (just @Baxter) — reply with a short prompt, no AI call.
  if (!text) {
    await tryAddEyesReaction();
    try {
      await postSlackMessage({
        channel: channelId,
        ...(replyThreadTs ? { threadTs: replyThreadTs } : {}),
        text: "*Baxter*\nAsk me a question about Acton procedures, general work help, or what I can do. Send `/clear` to start a fresh conversation.",
      });
      if (eventId) {
        await updateSlackEventReceipt({ eventId, status: "completed" });
      }
    } catch (error) {
      await markPostFailure(eventId, error);
    } finally {
      await tryRemoveEyesReaction();
    }
    return;
  }

  const externalThreadId = buildSlackExternalThreadId({
    teamId,
    channelId,
    userId: event.user ?? null,
    threadTs: conversationRootTs,
    isDm: access.isDm,
  });

  // For DM continuity, threadTs in the key is stable — rebuildSlackExternalThreadId for DMs
  // ignores per-message ts and uses user id. Use a stable DM key:
  const stableExternalThreadId = access.isDm
    ? buildSlackExternalThreadId({
        teamId,
        channelId,
        userId: event.user ?? null,
        threadTs: "dm",
        isDm: true,
      })
    : externalThreadId;

  await tryAddEyesReaction();
  try {
    const identities = await observeSlackIdentities({
      teamId: teamId ?? "unknown",
      slackUserId: event.user ?? null,
      slackChannelId: channelId,
    });

    const result = await answerBaxterQuestion({
      question: text,
      userId: null,
      userName: identities.userLabel,
      channel: "slack",
      externalThreadId: stableExternalThreadId,
      externalUserId: event.user ?? null,
      slackTeamId: teamId,
      slackActionToken: event.action_token ?? null,
    });

    const segments = buildSlackReplySegments(result);
    for (const segment of segments) {
      await postSlackMessage({
        channel: channelId,
        ...(replyThreadTs ? { threadTs: replyThreadTs } : {}),
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
      channelId,
      threadTs: replyThreadTs ?? null,
      isDm: access.isDm,
      slackError: error instanceof SlackClientError ? error.slackError : null,
      httpStatus: error instanceof SlackClientError ? error.httpStatus : null,
    });

    try {
      await postSlackMessage({
        channel: channelId,
        ...(replyThreadTs ? { threadTs: replyThreadTs } : {}),
        text: employeeFacingSlackError(code),
      });
    } catch (postError) {
      logServerError("handleBaxterSlackEvent:errorReply", {
        code: SLACK_ERROR_CODES.POST_FAILED,
        eventId: eventId ?? null,
        channelId,
        threadTs: replyThreadTs ?? null,
        isDm: access.isDm,
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
  } finally {
    await tryRemoveEyesReaction();
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
}): Promise<{ duplicate: boolean; jobId?: string; eyesAdded?: boolean }> {
  const claim = await claimSlackEventReceipt({
    eventId: input.eventId,
    teamId: input.teamId,
    eventType: input.event.type,
    eventTs: input.event.event_ts ?? input.event.ts,
  });

  if (!claim.claimed) {
    return { duplicate: true };
  }

  // Do not enqueue (or react) for events Baxter intentionally ignores.
  if (shouldIgnoreSlackEvent(input.event)) {
    await updateSlackEventReceipt({
      eventId: input.eventId,
      status: "ignored",
      errorCode: SLACK_ERROR_CODES.EVENT_UNSUPPORTED,
    });
    return { duplicate: false };
  }

  const access = evaluateSlackAccess(input.event);
  if (!access.allowed) {
    logIgnoredSlackMention({
      eventType: input.event.type,
      teamId: input.teamId,
      channelId: input.event.channel,
      reason: access.reason ?? access.code ?? "access_denied",
      code: access.code,
    });
    await updateSlackEventReceipt({
      eventId: input.eventId,
      status: "ignored",
      errorCode: access.code,
    });
    return { duplicate: false };
  }

  const job = await enqueueBaxterSlackReply({
    eventId: input.eventId,
    teamId: input.teamId,
    event: input.event,
  });

  // Early 👀 after accept/dedupe — do not delay the Events API response on LLM work.
  let eyesAdded = false;
  const channel = input.event.channel;
  const timestamp = input.event.ts;
  if (channel && timestamp) {
    const reaction = await addProcessingReaction({ channel, timestamp });
    eyesAdded = reaction.ok;
    if (!reaction.ok) {
      console.error("[slack.reaction.add_failed]", {
        channelId: channel,
        timestamp,
        error: reaction.error ?? null,
        phase: "accept",
      });
    }
  }

  return { duplicate: false, jobId: job.id, eyesAdded };
}

/** Best-effort eyes cleanup for terminal slack_baxter_reply job failures. */
export async function cleanupProcessingReactionFromJobMetadata(
  metadata: Record<string, unknown>,
): Promise<void> {
  const event = metadata.event as SlackIncomingEvent | undefined;
  if (!event?.channel || !event.ts) return;
  const result = await removeProcessingReaction({
    channel: event.channel,
    timestamp: event.ts,
  });
  if (!result.ok) {
    console.error("[slack.reaction.remove_failed]", {
      channelId: event.channel,
      timestamp: event.ts,
      error: result.error ?? null,
      phase: "terminal_job_failure",
    });
  }
}
