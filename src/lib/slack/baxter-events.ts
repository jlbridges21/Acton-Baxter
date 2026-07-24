import "server-only";

import { getEnv } from "@/lib/env";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import type { BaxterAnswer, BaxterSourceReference } from "@/lib/baxter-ai/types";
import { formatRelativeUpdated } from "@/lib/baxter-ai/citations";
import { postSlackMessage } from "@/lib/slack/client";
import { createServiceClient } from "@/lib/supabase/admin";

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

function stripBotMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, "").trim();
}

export function shouldIgnoreSlackEvent(event: SlackIncomingEvent): boolean {
  if (event.bot_id) return true;
  if (event.subtype === "bot_message") return true;
  if (event.type !== "message" && event.type !== "app_mention") return true;
  if (event.type === "message" && event.subtype && event.subtype !== "file_share") {
    // Ignore message edits/deletes/etc.
    if (event.subtype !== "thread_broadcast") return true;
  }
  return false;
}

export async function claimSlackEvent(eventId: string, eventType?: string, teamId?: string) {
  const memory = globalThis as typeof globalThis & {
    __baxterSlackEvents?: Set<string>;
  };
  if (!memory.__baxterSlackEvents) memory.__baxterSlackEvents = new Set();
  if (memory.__baxterSlackEvents.has(eventId)) return false;

  try {
    const env = getEnv();
    const useMemory = Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
    if (useMemory) {
      memory.__baxterSlackEvents.add(eventId);
      return true;
    }

    const supabase = createServiceClient();
    const { error } = await supabase.from("slack_processed_events").insert({
      event_id: eventId,
      event_type: eventType ?? null,
      team_id: teamId ?? null,
    });
    if (error) {
      if (error.code === "23505") return false; // duplicate
      // Missing table → memory fallback
      memory.__baxterSlackEvents.add(eventId);
      return true;
    }
    return true;
  } catch {
    memory.__baxterSlackEvents.add(eventId);
    return true;
  }
}

export function buildBaxterSlackBlocks(answer: BaxterAnswer): unknown[] {
  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: answer.answer },
    },
  ];

  if (answer.sources.length > 0) {
    const lines = answer.sources.map((source) => formatSlackSourceLine(source));
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Sources*\n${lines.join("\n")}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Confidence: ${answer.confidence}${
          answer.insufficientKnowledge ? " · Insufficient approved knowledge" : ""
        }`,
      },
    ],
  });

  return blocks;
}

function formatSlackSourceLine(source: BaxterSourceReference): string {
  const updated = formatRelativeUpdated(source.lastUpdated);
  const env = (() => {
    try {
      return getEnv();
    } catch {
      return null;
    }
  })();
  const absolute =
    source.sourceUrl && source.sourceUrl.startsWith("/")
      ? `${(env?.APP_BASE_URL ?? "").replace(/\/$/, "")}${source.sourceUrl}`
      : source.sourceUrl;

  if (absolute && source.availability === "available") {
    return `• *${source.citationLabel}* (${updated})\n${absolute}`;
  }
  return `• *${source.citationLabel}* (${updated}) — unavailable`;
}

export async function handleBaxterSlackEvent(event: SlackIncomingEvent): Promise<void> {
  const env = getEnv();
  if (!env.ENABLE_SLACK_INTEGRATION) return;
  if (shouldIgnoreSlackEvent(event)) return;

  const text = stripBotMention(event.text ?? "");
  if (!text) return;

  const channel = event.channel;
  if (!channel) return;

  const threadTs = event.thread_ts || event.ts || null;
  const userId = env.SLACK_REPORT_USER_ID;
  if (!userId) {
    await postSlackMessage({
      channel,
      threadTs: threadTs ?? undefined,
      text: "Baxter is not fully configured (missing SLACK_REPORT_USER_ID).",
    });
    return;
  }

  try {
    const result = await answerBaxterQuestion({
      question: text,
      userId,
      userName: event.user ? `Slack user ${event.user}` : "Slack user",
      channel: "slack",
      externalThreadId: threadTs,
      externalUserId: event.user ?? null,
    });

    await postSlackMessage({
      channel,
      threadTs: threadTs ?? undefined,
      text: result.answer,
      blocks: buildBaxterSlackBlocks(result),
    });
  } catch {
    await postSlackMessage({
      channel,
      threadTs: threadTs ?? undefined,
      text: "Baxter couldn’t answer that right now. Please try again.",
    });
  }
}
