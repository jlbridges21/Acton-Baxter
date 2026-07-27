import "server-only";

import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  isSlackDmChannelId,
  isSlackProfileStale,
  pickSlackChannelLabel,
  pickSlackDisplayName,
} from "./display-names";

export type SlackUserProfileRecord = {
  slack_user_id: string;
  team_id: string;
  display_name: string | null;
  real_name: string | null;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  is_bot: boolean;
  is_deleted: boolean;
  last_resolved_at: string | null;
  last_seen_at: string | null;
  resolve_error: string | null;
  created_at: string;
  updated_at: string;
};

export type SlackChannelProfileRecord = {
  slack_channel_id: string;
  team_id: string;
  name: string | null;
  channel_type: string | null;
  is_private: boolean;
  last_resolved_at: string | null;
  last_seen_at: string | null;
  resolve_error: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryState = {
  users: Map<string, SlackUserProfileRecord>;
  channels: Map<string, SlackChannelProfileRecord>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterSlackProfiles?: MemoryState;
};

function getMemory(): MemoryState {
  if (!globalMemory.__baxterSlackProfiles) {
    globalMemory.__baxterSlackProfiles = { users: new Map(), channels: new Map() };
  }
  return globalMemory.__baxterSlackProfiles;
}

export function resetSlackProfilesMemoryForTests() {
  globalMemory.__baxterSlackProfiles = { users: new Map(), channels: new Map() };
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

function userKey(teamId: string, userId: string) {
  return `${teamId}:${userId}`;
}

function channelKey(teamId: string, channelId: string) {
  return `${teamId}:${channelId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function slackApiGet(
  method: string,
  params: Record<string, string>,
): Promise<{
  ok: boolean;
  error?: string;
  data: Record<string, unknown>;
  retryAfter?: number | null;
}> {
  let token: string | undefined;
  try {
    token = getEnv().SLACK_BOT_TOKEN;
  } catch {
    token = process.env.SLACK_BOT_TOKEN;
  }
  if (!token) {
    return { ok: false, error: "missing_bot_token", data: {} };
  }
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const retryAfterHeader = response.headers.get("Retry-After");
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    ok?: boolean;
    error?: string;
  };

  if (response.status === 429 || data.error === "ratelimited") {
    return {
      ok: false,
      error: "ratelimited",
      data,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : 3,
    };
  }

  return { ok: Boolean(data.ok), error: data.error, data };
}

export async function getCachedSlackUserProfile(
  teamId: string,
  slackUserId: string,
): Promise<SlackUserProfileRecord | null> {
  if (shouldUseMemory()) {
    return getMemory().users.get(userKey(teamId, slackUserId)) ?? null;
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("slack_user_profiles")
      .select("*")
      .eq("team_id", teamId)
      .eq("slack_user_id", slackUserId)
      .maybeSingle();
    if (error || !data) return null;
    return data as SlackUserProfileRecord;
  } catch {
    return null;
  }
}

export async function getCachedSlackChannelProfile(
  teamId: string,
  slackChannelId: string,
): Promise<SlackChannelProfileRecord | null> {
  if (shouldUseMemory()) {
    return getMemory().channels.get(channelKey(teamId, slackChannelId)) ?? null;
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("slack_channel_profiles")
      .select("*")
      .eq("team_id", teamId)
      .eq("slack_channel_id", slackChannelId)
      .maybeSingle();
    if (error || !data) return null;
    return data as SlackChannelProfileRecord;
  } catch {
    return null;
  }
}

export async function upsertSlackUserProfile(
  input: Partial<SlackUserProfileRecord> & { team_id: string; slack_user_id: string },
): Promise<SlackUserProfileRecord> {
  const existing = await getCachedSlackUserProfile(input.team_id, input.slack_user_id);
  const now = nowIso();
  const record: SlackUserProfileRecord = {
    slack_user_id: input.slack_user_id,
    team_id: input.team_id,
    display_name: input.display_name ?? existing?.display_name ?? null,
    real_name: input.real_name ?? existing?.real_name ?? null,
    username: input.username ?? existing?.username ?? null,
    email: input.email ?? existing?.email ?? null,
    avatar_url: input.avatar_url ?? existing?.avatar_url ?? null,
    is_bot: input.is_bot ?? existing?.is_bot ?? false,
    is_deleted: input.is_deleted ?? existing?.is_deleted ?? false,
    last_resolved_at: input.last_resolved_at ?? existing?.last_resolved_at ?? null,
    last_seen_at: input.last_seen_at ?? existing?.last_seen_at ?? null,
    resolve_error:
      input.resolve_error === undefined ? (existing?.resolve_error ?? null) : input.resolve_error,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  if (shouldUseMemory()) {
    getMemory().users.set(userKey(record.team_id, record.slack_user_id), record);
    return record;
  }

  try {
    const supabase = createServiceClient();
    await supabase.from("slack_user_profiles").upsert(record, {
      onConflict: "team_id,slack_user_id",
    });
  } catch {
    // table may be missing until migration 019
  }
  return record;
}

export async function upsertSlackChannelProfile(
  input: Partial<SlackChannelProfileRecord> & { team_id: string; slack_channel_id: string },
): Promise<SlackChannelProfileRecord> {
  const existing = await getCachedSlackChannelProfile(input.team_id, input.slack_channel_id);
  const now = nowIso();
  const record: SlackChannelProfileRecord = {
    slack_channel_id: input.slack_channel_id,
    team_id: input.team_id,
    name: input.name ?? existing?.name ?? null,
    channel_type: input.channel_type ?? existing?.channel_type ?? null,
    is_private: input.is_private ?? existing?.is_private ?? false,
    last_resolved_at: input.last_resolved_at ?? existing?.last_resolved_at ?? null,
    last_seen_at: input.last_seen_at ?? existing?.last_seen_at ?? null,
    resolve_error:
      input.resolve_error === undefined ? (existing?.resolve_error ?? null) : input.resolve_error,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  if (shouldUseMemory()) {
    getMemory().channels.set(channelKey(record.team_id, record.slack_channel_id), record);
    return record;
  }

  try {
    const supabase = createServiceClient();
    await supabase.from("slack_channel_profiles").upsert(record, {
      onConflict: "team_id,slack_channel_id",
    });
  } catch {
    // table may be missing until migration 019
  }
  return record;
}

export async function resolveSlackUserProfile(input: {
  teamId: string;
  slackUserId: string;
  force?: boolean;
  touchSeen?: boolean;
}): Promise<SlackUserProfileRecord> {
  const cached = await getCachedSlackUserProfile(input.teamId, input.slackUserId);
  const seenAt = input.touchSeen ? nowIso() : (cached?.last_seen_at ?? nowIso());

  if (
    cached &&
    !input.force &&
    !isSlackProfileStale(cached.last_resolved_at) &&
    (cached.display_name || cached.real_name || cached.username)
  ) {
    if (input.touchSeen) {
      return upsertSlackUserProfile({
        team_id: input.teamId,
        slack_user_id: input.slackUserId,
        last_seen_at: seenAt,
      });
    }
    return cached;
  }

  if (!cached) {
    await upsertSlackUserProfile({
      team_id: input.teamId,
      slack_user_id: input.slackUserId,
      last_seen_at: seenAt,
    });
  }

  let attempt = 0;
  while (attempt < 2) {
    attempt += 1;
    const result = await slackApiGet("users.info", { user: input.slackUserId });
    if (result.error === "ratelimited") {
      await sleep(Math.min((result.retryAfter ?? 2) * 1000, 8000));
      continue;
    }
    if (!result.ok) {
      return upsertSlackUserProfile({
        team_id: input.teamId,
        slack_user_id: input.slackUserId,
        last_seen_at: seenAt,
        last_resolved_at: nowIso(),
        resolve_error: result.error ?? "users_info_failed",
      });
    }

    const user = (result.data.user ?? {}) as Record<string, unknown>;
    const profile = (user.profile ?? {}) as Record<string, unknown>;
    return upsertSlackUserProfile({
      team_id: input.teamId,
      slack_user_id: input.slackUserId,
      display_name: (profile.display_name as string | undefined)?.trim() || null,
      real_name:
        (profile.real_name as string | undefined)?.trim() ||
        (user.real_name as string | undefined)?.trim() ||
        null,
      username: (user.name as string | undefined)?.trim() || null,
      email: null,
      avatar_url: (profile.image_48 as string | undefined) || null,
      is_bot: Boolean(user.is_bot),
      is_deleted: Boolean(user.deleted),
      last_resolved_at: nowIso(),
      last_seen_at: seenAt,
      resolve_error: null,
    });
  }

  return upsertSlackUserProfile({
    team_id: input.teamId,
    slack_user_id: input.slackUserId,
    last_seen_at: seenAt,
    last_resolved_at: nowIso(),
    resolve_error: "ratelimited",
  });
}

export async function resolveSlackChannelProfile(input: {
  teamId: string;
  slackChannelId: string;
  force?: boolean;
  touchSeen?: boolean;
}): Promise<SlackChannelProfileRecord> {
  const channelId = input.slackChannelId;
  const cached = await getCachedSlackChannelProfile(input.teamId, channelId);
  const seenAt = input.touchSeen ? nowIso() : (cached?.last_seen_at ?? nowIso());

  if (isSlackDmChannelId(channelId)) {
    return upsertSlackChannelProfile({
      team_id: input.teamId,
      slack_channel_id: channelId,
      name: null,
      channel_type: "im",
      is_private: true,
      last_resolved_at: nowIso(),
      last_seen_at: seenAt,
      resolve_error: null,
    });
  }

  if (cached && !input.force && !isSlackProfileStale(cached.last_resolved_at) && cached.name) {
    if (input.touchSeen) {
      return upsertSlackChannelProfile({
        team_id: input.teamId,
        slack_channel_id: channelId,
        last_seen_at: seenAt,
      });
    }
    return cached;
  }

  let attempt = 0;
  while (attempt < 2) {
    attempt += 1;
    const result = await slackApiGet("conversations.info", { channel: channelId });
    if (result.error === "ratelimited") {
      await sleep(Math.min((result.retryAfter ?? 2) * 1000, 8000));
      continue;
    }
    if (!result.ok) {
      return upsertSlackChannelProfile({
        team_id: input.teamId,
        slack_channel_id: channelId,
        channel_type: channelId.startsWith("G") ? "private_channel" : "channel",
        is_private: channelId.startsWith("G"),
        last_resolved_at: nowIso(),
        last_seen_at: seenAt,
        resolve_error: result.error ?? "conversations_info_failed",
      });
    }

    const channel = (result.data.channel ?? {}) as Record<string, unknown>;
    return upsertSlackChannelProfile({
      team_id: input.teamId,
      slack_channel_id: channelId,
      name: (channel.name as string | undefined)?.trim() || null,
      channel_type: channel.is_im ? "im" : channel.is_private ? "private_channel" : "channel",
      is_private: Boolean(channel.is_private || channel.is_im),
      last_resolved_at: nowIso(),
      last_seen_at: seenAt,
      resolve_error: null,
    });
  }

  return upsertSlackChannelProfile({
    team_id: input.teamId,
    slack_channel_id: channelId,
    last_seen_at: seenAt,
    last_resolved_at: nowIso(),
    resolve_error: "ratelimited",
  });
}

export function formatResolvedUserLabel(
  profile: SlackUserProfileRecord | null,
  _slackUserId: string | null,
) {
  if (profile) return pickSlackDisplayName(profile);
  return "Unknown Slack user";
}

export function formatResolvedChannelLabel(
  profile: SlackChannelProfileRecord | null,
  slackChannelId: string | null,
) {
  if (profile) return pickSlackChannelLabel(profile);
  if (!slackChannelId) return "Unknown channel";
  return pickSlackChannelLabel({ slack_channel_id: slackChannelId });
}

export async function observeSlackIdentities(input: {
  teamId: string;
  slackUserId?: string | null;
  slackChannelId?: string | null;
}): Promise<{ userLabel: string; channelLabel: string }> {
  let userLabel = "Unknown Slack user";
  let channelLabel = "Unknown channel";

  try {
    if (input.slackUserId) {
      const user = await resolveSlackUserProfile({
        teamId: input.teamId,
        slackUserId: input.slackUserId,
        touchSeen: true,
      });
      userLabel = formatResolvedUserLabel(user, input.slackUserId);
    }
  } catch {
    // never block messaging
  }

  try {
    if (input.slackChannelId) {
      const channel = await resolveSlackChannelProfile({
        teamId: input.teamId,
        slackChannelId: input.slackChannelId,
        touchSeen: true,
      });
      channelLabel = formatResolvedChannelLabel(channel, input.slackChannelId);
    }
  } catch {
    // never block messaging
  }

  return { userLabel, channelLabel };
}

export async function listAllSlackUserProfiles(): Promise<SlackUserProfileRecord[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().users.values());
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.from("slack_user_profiles").select("*");
    if (error || !data) return [];
    return data as SlackUserProfileRecord[];
  } catch {
    return [];
  }
}

export async function listAllSlackChannelProfiles(): Promise<SlackChannelProfileRecord[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().channels.values());
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.from("slack_channel_profiles").select("*");
    if (error || !data) return [];
    return data as SlackChannelProfileRecord[];
  } catch {
    return [];
  }
}

export async function backfillSlackDisplayNames(options?: {
  limit?: number;
}): Promise<{ usersResolved: number; channelsResolved: number; errors: string[] }> {
  const { listRecentConversations } = await import("@/lib/baxter-ai/conversations");
  const { parseSlackExternalThreadId } = await import("./display-names");
  const limit = options?.limit ?? 40;
  const conversations = (await listRecentConversations(200)).filter((c) => c.channel === "slack");

  const userIds = new Map<string, string>();
  const channelIds = new Map<string, string>();

  for (const c of conversations) {
    const parsed = parseSlackExternalThreadId(c.external_thread_id);
    if (parsed.teamId && c.external_user_id) {
      userIds.set(`${parsed.teamId}:${c.external_user_id}`, parsed.teamId);
    }
    if (parsed.teamId && parsed.channelId) {
      channelIds.set(`${parsed.teamId}:${parsed.channelId}`, parsed.teamId);
    }
  }

  const errors: string[] = [];
  let usersResolved = 0;
  let channelsResolved = 0;

  for (const [key, teamId] of Array.from(userIds.entries()).slice(0, limit)) {
    const slackUserId = key.split(":")[1]!;
    try {
      await resolveSlackUserProfile({ teamId, slackUserId, force: false, touchSeen: false });
      usersResolved += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "user_resolve_failed");
    }
  }

  for (const [key, teamId] of Array.from(channelIds.entries()).slice(0, limit)) {
    const slackChannelId = key.split(":")[1]!;
    try {
      await resolveSlackChannelProfile({
        teamId,
        slackChannelId,
        force: false,
        touchSeen: false,
      });
      channelsResolved += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "channel_resolve_failed");
    }
  }

  return { usersResolved, channelsResolved, errors: errors.slice(0, 10) };
}
