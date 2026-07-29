import { inferChannelKind } from "./channels";
import {
  SLACK_SOURCE_TYPE,
  type SlackChannelKind,
  type SlackContextMessage,
  type SlackConversationCluster,
  type SlackMessageEvidence,
} from "./types";

function tsToIso(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const seconds = Number(String(ts).split(".")[0]);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function clusterKey(channelId: string, threadTs: string | null, messageTs: string): string {
  return `${channelId}:${threadTs ?? messageTs}`;
}

export function normalizeSearchMessage(raw: Record<string, unknown>): SlackMessageEvidence | null {
  const messageTs = String(raw.message_ts ?? raw.ts ?? "");
  const channelId = String(raw.channel_id ?? raw.channel ?? "");
  if (!messageTs || !channelId) return null;

  const threadTsRaw = raw.thread_ts ? String(raw.thread_ts) : null;
  const text = String(raw.content ?? raw.text ?? "");
  const authorId = raw.author_user_id
    ? String(raw.author_user_id)
    : raw.user
      ? String(raw.user)
      : null;
  const authorName = raw.author_name ? String(raw.author_name) : null;
  const channelName = raw.channel_name ? String(raw.channel_name) : null;
  const permalink = raw.permalink ? String(raw.permalink) : null;
  const channelKind = inferChannelKind({
    id: channelId,
    isPrivate: Boolean(raw.is_private),
    channelType: raw.channel_type ? String(raw.channel_type) : null,
  });

  const contextMessages: SlackContextMessage[] = [];
  const ctx = raw.context_messages as
    { before?: Array<Record<string, unknown>>; after?: Array<Record<string, unknown>> } | undefined;
  if (ctx?.before) {
    for (const m of ctx.before) {
      contextMessages.push({
        messageTs: String(m.ts ?? ""),
        authorId: m.user_id ? String(m.user_id) : m["user_id:"] ? String(m["user_id:"]) : null,
        authorName: null,
        text: String(m.text ?? ""),
        timestamp: tsToIso(String(m.ts ?? "")),
      });
    }
  }
  if (ctx?.after) {
    for (const m of ctx.after) {
      contextMessages.push({
        messageTs: String(m.ts ?? ""),
        authorId: m.user_id ? String(m.user_id) : m["user_id:"] ? String(m["user_id:"]) : null,
        authorName: null,
        text: String(m.text ?? ""),
        timestamp: tsToIso(String(m.ts ?? "")),
      });
    }
  }

  const isThreadReply = Boolean(threadTsRaw && threadTsRaw !== messageTs);

  return {
    sourceType: SLACK_SOURCE_TYPE,
    messageTs,
    threadTs: threadTsRaw,
    channelId,
    channelName,
    channelKind,
    authorId,
    authorName,
    timestamp: tsToIso(messageTs),
    text,
    permalink,
    isThreadReply,
    relevance: typeof raw.score === "number" ? raw.score : null,
    contextMessages: contextMessages.filter((m) => m.messageTs && m.text),
    clusterKey: clusterKey(channelId, threadTsRaw, messageTs),
  };
}

export function normalizeHistoryMessage(input: {
  message: Record<string, unknown>;
  channelId: string;
  channelName?: string | null;
  channelKind?: SlackChannelKind | null;
  permalink?: string | null;
}): SlackMessageEvidence | null {
  const message = input.message;
  const messageTs = String(message.ts ?? "");
  if (!messageTs) return null;
  const threadTs = message.thread_ts ? String(message.thread_ts) : null;
  return {
    sourceType: SLACK_SOURCE_TYPE,
    messageTs,
    threadTs,
    channelId: input.channelId,
    channelName: input.channelName ?? null,
    channelKind: input.channelKind ?? inferChannelKind({ id: input.channelId }),
    authorId: message.user ? String(message.user) : null,
    authorName: null,
    timestamp: tsToIso(messageTs),
    text: String(message.text ?? ""),
    permalink: input.permalink ?? null,
    isThreadReply: Boolean(threadTs && threadTs !== messageTs),
    relevance: null,
    contextMessages: [],
    clusterKey: clusterKey(input.channelId, threadTs, messageTs),
  };
}

export function groupEvidenceIntoClusters(
  results: SlackMessageEvidence[],
): SlackConversationCluster[] {
  const map = new Map<string, SlackConversationCluster>();
  for (const item of results) {
    const key = item.clusterKey;
    const existing = map.get(key);
    if (existing) {
      existing.messages.push(item);
      continue;
    }
    map.set(key, {
      clusterKey: key,
      channelId: item.channelId,
      channelName: item.channelName,
      threadTs: item.threadTs,
      dateLabel: item.timestamp ? item.timestamp.slice(0, 10) : null,
      messages: [item],
    });
  }
  return [...map.values()].map((cluster) => ({
    ...cluster,
    messages: [...cluster.messages].sort((a, b) =>
      String(a.messageTs).localeCompare(String(b.messageTs)),
    ),
  }));
}

export function groupEvidenceByAuthor(
  results: SlackMessageEvidence[],
): Map<string, SlackMessageEvidence[]> {
  const map = new Map<string, SlackMessageEvidence[]>();
  for (const item of results) {
    const key = item.authorName || item.authorId || "unknown";
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}
