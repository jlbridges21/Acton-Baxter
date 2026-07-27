import "server-only";

import {
  listMessagesForConversation,
  listRecentConversations,
} from "@/lib/baxter-ai/conversations";
import type { BaxterConversation, BaxterMessage } from "@/lib/baxter-ai/types";
import { parseSlackExternalThreadId, slackUserFallbackLabel } from "./display-names";
import {
  ensureSlackIdentitiesForKeys,
  formatResolvedChannelLabel,
  formatResolvedUserLabel,
  getCachedSlackChannelProfile,
  getCachedSlackUserProfile,
  listAllSlackChannelProfiles,
  listAllSlackUserProfiles,
  type SlackChannelProfileRecord,
  type SlackUserProfileRecord,
} from "./profiles";

export type SlackActivityFilters = {
  q?: string;
  kind?: "all" | "dm" | "channels" | "errors" | "recent";
  range?: "all" | "today" | "7d" | "30d";
  sort?: "recent" | "name" | "conversations" | "messages";
};

export type SlackConversationSummary = {
  conversationId: string;
  slackUserId: string | null;
  teamId: string | null;
  channelId: string | null;
  isDm: boolean;
  userLabel: string;
  channelLabel: string;
  avatarUrl: string | null;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  userMessageCount: number;
  firstQuestion: string;
  status: "answered" | "pending" | "error" | "reset";
  needsAttention: boolean;
  errorCode: string | null;
  sourceCount: number;
};

export type SlackUserActivitySummary = {
  slackUserId: string;
  teamId: string;
  displayName: string;
  avatarUrl: string | null;
  conversationCount: number;
  messageCount: number;
  lastActiveAt: string | null;
  firstActiveAt: string | null;
  channels: string[];
  needsAttention: boolean;
};

export type SlackChannelActivitySummary = {
  channelId: string;
  teamId: string;
  label: string;
  isDm: boolean;
  conversationCount: number;
  userCount: number;
  messageCount: number;
  lastActiveAt: string | null;
  needsAttention: boolean;
};

function inRange(iso: string, range: SlackActivityFilters["range"]): boolean {
  if (!range || range === "all") return true;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  const now = Date.now();
  if (range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return t >= start.getTime();
  }
  const days = range === "7d" ? 7 : 30;
  return now - t <= days * 24 * 60 * 60 * 1000;
}

function isResetAssistant(message: BaxterMessage): boolean {
  return (
    message.role === "assistant" &&
    (message.model_provider === "command" || /conversation cleared/i.test(message.content))
  );
}

async function summarizeConversation(
  conversation: BaxterConversation,
  usersByKey: Map<string, SlackUserProfileRecord>,
  channelsByKey: Map<string, SlackChannelProfileRecord>,
): Promise<SlackConversationSummary> {
  const parsed = parseSlackExternalThreadId(conversation.external_thread_id);
  const teamId = parsed.teamId;
  const channelId = parsed.channelId;
  const slackUserId = conversation.external_user_id;
  const messages = await listMessagesForConversation(conversation.id);

  const userProfile =
    teamId && slackUserId
      ? (usersByKey.get(`${teamId}:${slackUserId}`) ??
        (await getCachedSlackUserProfile(teamId, slackUserId)))
      : null;
  const channelProfile =
    teamId && channelId
      ? (channelsByKey.get(`${teamId}:${channelId}`) ??
        (await getCachedSlackChannelProfile(teamId, channelId)))
      : null;

  const firstUser = messages.find((m) => m.role === "user");
  const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const hasError = messages.some((m) => Boolean(m.error_code));
  const onlyReset =
    messages.length > 0 &&
    messages.every((m) => m.role !== "user" || false) === false &&
    latestAssistant &&
    isResetAssistant(latestAssistant) &&
    messages.filter((m) => m.role === "user").length === 0;

  const sources =
    latestAssistant && Array.isArray((latestAssistant.metadata as { sources?: unknown }).sources)
      ? ((latestAssistant.metadata as { sources: unknown[] }).sources ?? [])
      : [];

  let status: SlackConversationSummary["status"] = "pending";
  if (hasError) status = "error";
  else if (onlyReset || (latestAssistant && isResetAssistant(latestAssistant) && !firstUser))
    status = "reset";
  else if (latestAssistant) status = "answered";

  return {
    conversationId: conversation.id,
    slackUserId,
    teamId,
    channelId,
    isDm: parsed.isDmKey,
    userLabel: formatResolvedUserLabel(userProfile, slackUserId),
    channelLabel: formatResolvedChannelLabel(channelProfile, channelId),
    avatarUrl: userProfile?.avatar_url ?? null,
    startedAt: conversation.created_at,
    lastActivityAt: conversation.last_message_at ?? conversation.created_at,
    messageCount: messages.length,
    userMessageCount: messages.filter((m) => m.role === "user").length,
    firstQuestion: (firstUser?.content ?? "").slice(0, 180),
    status,
    needsAttention: hasError,
    errorCode: messages.find((m) => m.error_code)?.error_code ?? null,
    sourceCount: sources.length,
  };
}

export async function listSlackConversationSummaries(
  filters: SlackActivityFilters = {},
): Promise<SlackConversationSummary[]> {
  const conversations = (await listRecentConversations(200)).filter((c) => c.channel === "slack");

  const usersToResolve: Array<{ teamId: string; slackUserId: string }> = [];
  const channelsToResolve: Array<{ teamId: string; slackChannelId: string }> = [];
  const seenUsers = new Set<string>();
  const seenChannels = new Set<string>();
  for (const conversation of conversations) {
    const parsed = parseSlackExternalThreadId(conversation.external_thread_id);
    if (parsed.teamId && conversation.external_user_id) {
      const key = `${parsed.teamId}:${conversation.external_user_id}`;
      if (!seenUsers.has(key)) {
        seenUsers.add(key);
        usersToResolve.push({
          teamId: parsed.teamId,
          slackUserId: conversation.external_user_id,
        });
      }
    }
    if (parsed.teamId && parsed.channelId) {
      const key = `${parsed.teamId}:${parsed.channelId}`;
      if (!seenChannels.has(key)) {
        seenChannels.add(key);
        channelsToResolve.push({
          teamId: parsed.teamId,
          slackChannelId: parsed.channelId,
        });
      }
    }
  }
  await ensureSlackIdentitiesForKeys({
    users: usersToResolve,
    channels: channelsToResolve,
    limit: 40,
  });

  const users = await listAllSlackUserProfiles();
  const channels = await listAllSlackChannelProfiles();
  const usersByKey = new Map(users.map((u) => [`${u.team_id}:${u.slack_user_id}`, u]));
  const channelsByKey = new Map(channels.map((c) => [`${c.team_id}:${c.slack_channel_id}`, c]));

  const summaries: SlackConversationSummary[] = [];
  for (const conversation of conversations) {
    summaries.push(await summarizeConversation(conversation, usersByKey, channelsByKey));
  }

  const q = filters.q?.trim().toLowerCase() ?? "";
  let filtered = summaries.filter((s) => inRange(s.lastActivityAt, filters.range));

  if (filters.kind === "dm") filtered = filtered.filter((s) => s.isDm);
  if (filters.kind === "channels") filtered = filtered.filter((s) => !s.isDm);
  if (filters.kind === "errors") filtered = filtered.filter((s) => s.needsAttention);
  if (filters.kind === "recent") {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((s) => Date.parse(s.lastActivityAt) >= weekAgo);
  }

  if (q) {
    filtered = filtered.filter(
      (s) =>
        s.userLabel.toLowerCase().includes(q) ||
        s.channelLabel.toLowerCase().includes(q) ||
        s.firstQuestion.toLowerCase().includes(q) ||
        (s.slackUserId ?? "").toLowerCase().includes(q) ||
        (s.channelId ?? "").toLowerCase().includes(q),
    );
  }

  filtered.sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  return filtered;
}

export async function getSlackActivityOverview(filters: SlackActivityFilters = {}) {
  const conversations = await listSlackConversationSummaries(filters);
  const userMap = new Map<string, SlackUserActivitySummary>();
  const channelMap = new Map<string, SlackChannelActivitySummary>();

  for (const c of conversations) {
    if (c.slackUserId && c.teamId) {
      const key = `${c.teamId}:${c.slackUserId}`;
      const existing = userMap.get(key);
      if (!existing) {
        userMap.set(key, {
          slackUserId: c.slackUserId,
          teamId: c.teamId,
          displayName: c.userLabel,
          avatarUrl: c.avatarUrl,
          conversationCount: 1,
          messageCount: c.messageCount,
          lastActiveAt: c.lastActivityAt,
          firstActiveAt: c.startedAt,
          channels: [c.channelLabel],
          needsAttention: c.needsAttention,
        });
      } else {
        existing.conversationCount += 1;
        existing.messageCount += c.messageCount;
        existing.needsAttention = existing.needsAttention || c.needsAttention;
        if (!existing.channels.includes(c.channelLabel)) existing.channels.push(c.channelLabel);
        if (
          !existing.lastActiveAt ||
          Date.parse(c.lastActivityAt) > Date.parse(existing.lastActiveAt)
        ) {
          existing.lastActiveAt = c.lastActivityAt;
          existing.displayName = c.userLabel;
          existing.avatarUrl = c.avatarUrl ?? existing.avatarUrl;
        }
        if (
          !existing.firstActiveAt ||
          Date.parse(c.startedAt) < Date.parse(existing.firstActiveAt)
        ) {
          existing.firstActiveAt = c.startedAt;
        }
      }
    }

    if (c.channelId && c.teamId) {
      const key = `${c.teamId}:${c.channelId}`;
      const existing = channelMap.get(key);
      if (!existing) {
        channelMap.set(key, {
          channelId: c.channelId,
          teamId: c.teamId,
          label: c.channelLabel,
          isDm: c.isDm,
          conversationCount: 1,
          userCount: c.slackUserId ? 1 : 0,
          messageCount: c.messageCount,
          lastActiveAt: c.lastActivityAt,
          needsAttention: c.needsAttention,
        });
      } else {
        existing.conversationCount += 1;
        existing.messageCount += c.messageCount;
        existing.needsAttention = existing.needsAttention || c.needsAttention;
        if (
          !existing.lastActiveAt ||
          Date.parse(c.lastActivityAt) > Date.parse(existing.lastActiveAt)
        ) {
          existing.lastActiveAt = c.lastActivityAt;
          existing.label = c.channelLabel;
        }
      }
    }
  }

  // Fix user counts on channels
  for (const ch of channelMap.values()) {
    const users = new Set(
      conversations
        .filter((c) => c.channelId === ch.channelId && c.teamId === ch.teamId && c.slackUserId)
        .map((c) => c.slackUserId!),
    );
    ch.userCount = users.size;
  }

  const users = Array.from(userMap.values());
  const sort = filters.sort ?? "recent";
  if (sort === "name") {
    users.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } else if (sort === "conversations") {
    users.sort((a, b) => b.conversationCount - a.conversationCount);
  } else if (sort === "messages") {
    users.sort((a, b) => b.messageCount - a.messageCount);
  } else {
    users.sort((a, b) => Date.parse(b.lastActiveAt ?? "0") - Date.parse(a.lastActiveAt ?? "0"));
  }

  const channels = Array.from(channelMap.values()).sort(
    (a, b) => Date.parse(b.lastActiveAt ?? "0") - Date.parse(a.lastActiveAt ?? "0"),
  );

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const errors24h = conversations.filter(
    (c) => c.needsAttention && Date.parse(c.lastActivityAt) >= dayAgo,
  ).length;

  return {
    cards: {
      activeUsers: users.length,
      conversations: conversations.length,
      messages: conversations.reduce((sum, c) => sum + c.messageCount, 0),
      activeChannels:
        channels.filter((c) => !c.isDm).length + (channels.some((c) => c.isDm) ? 1 : 0),
      errors24h,
    },
    users,
    channels,
    conversations,
  };
}

export async function getSlackUserActivityDetail(teamId: string, slackUserId: string) {
  const overview = await getSlackActivityOverview({});
  const user = overview.users.find((u) => u.teamId === teamId && u.slackUserId === slackUserId);
  const conversations = overview.conversations.filter(
    (c) => c.teamId === teamId && c.slackUserId === slackUserId,
  );

  const byChannel = new Map<string, SlackConversationSummary[]>();
  for (const c of conversations) {
    const key = c.channelLabel;
    const list = byChannel.get(key) ?? [];
    list.push(c);
    byChannel.set(key, list);
  }

  return {
    user: user ?? {
      slackUserId,
      teamId,
      displayName: slackUserFallbackLabel(slackUserId),
      avatarUrl: null,
      conversationCount: conversations.length,
      messageCount: conversations.reduce((s, c) => s + c.messageCount, 0),
      lastActiveAt: conversations[0]?.lastActivityAt ?? null,
      firstActiveAt: conversations.at(-1)?.startedAt ?? null,
      channels: Array.from(byChannel.keys()),
      needsAttention: conversations.some((c) => c.needsAttention),
    },
    groups: Array.from(byChannel.entries()).map(([label, items]) => ({
      channelLabel: label,
      conversations: items.sort(
        (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
      ),
    })),
  };
}

export async function getSlackChannelActivityDetail(teamId: string, channelId: string) {
  const overview = await getSlackActivityOverview({});
  const channel = overview.channels.find((c) => c.teamId === teamId && c.channelId === channelId);
  const conversations = overview.conversations.filter(
    (c) => c.teamId === teamId && c.channelId === channelId,
  );
  const participants = Array.from(
    new Map(
      conversations
        .filter((c) => c.slackUserId)
        .map((c) => [c.slackUserId!, { id: c.slackUserId!, label: c.userLabel }]),
    ).values(),
  );

  return {
    channel: channel ?? {
      channelId,
      teamId,
      label: formatResolvedChannelLabel(null, channelId),
      isDm: channelId.startsWith("D"),
      conversationCount: conversations.length,
      userCount: participants.length,
      messageCount: conversations.reduce((s, c) => s + c.messageCount, 0),
      lastActiveAt: conversations[0]?.lastActivityAt ?? null,
      needsAttention: conversations.some((c) => c.needsAttention),
    },
    participants,
    conversations: conversations.sort(
      (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
    ),
  };
}
