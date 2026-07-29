import "server-only";

import { callSlackApi } from "./api";
import { upsertSlackChannelProfile, upsertSlackUserProfile } from "@/lib/slack/profiles";
import type { SlackApiCallResult, SlackSearchDeps } from "./types";

const MAX_USER_PAGES = 50;
const MAX_CHANNEL_PAGES = 50;
const PAGE_SIZE = 200;

export type SlackDirectoryRefreshResult = {
  teamId: string;
  usersUpserted: number;
  channelsUpserted: number;
  publicChannels: number;
  privateChannels: number;
  activeHumans: number;
  botsSkipped: number;
  paginationComplete: boolean;
  pagesFetched: { users: number; channels: number };
  errors: string[];
  refreshedAt: string;
};

async function apiCall(
  deps: SlackSearchDeps | undefined,
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SlackApiCallResult> {
  if (deps?.callSlackApi) return deps.callSlackApi(method, { token, body });
  return callSlackApi(method, { token, body });
}

async function loadBotToken(): Promise<string> {
  try {
    const { getEnv } = await import("@/lib/env");
    return getEnv().SLACK_BOT_TOKEN?.trim() ?? "";
  } catch {
    return (process.env.SLACK_BOT_TOKEN ?? "").trim();
  }
}

/**
 * Refresh Slack identity directories via users.list + conversations.list (paginated).
 * Stores identity metadata only — never messages.
 */
export async function refreshSlackWorkspaceDirectory(input: {
  teamId: string;
  token?: string | null;
  deps?: SlackSearchDeps;
}): Promise<SlackDirectoryRefreshResult> {
  const refreshedAt = new Date().toISOString();
  const errors: string[] = [];
  const token = (input.token ?? (await loadBotToken())).trim();
  if (!token) {
    return {
      teamId: input.teamId,
      usersUpserted: 0,
      channelsUpserted: 0,
      publicChannels: 0,
      privateChannels: 0,
      activeHumans: 0,
      botsSkipped: 0,
      paginationComplete: false,
      pagesFetched: { users: 0, channels: 0 },
      errors: ["SLACK_BOT_TOKEN missing — cannot refresh directory"],
      refreshedAt,
    };
  }

  let usersUpserted = 0;
  let activeHumans = 0;
  let botsSkipped = 0;
  let userPages = 0;
  let userCursor: string | undefined;
  let usersComplete = false;

  while (userPages < MAX_USER_PAGES) {
    userPages += 1;
    const body: Record<string, unknown> = { limit: PAGE_SIZE };
    if (userCursor) body.cursor = userCursor;
    const result = await apiCall(input.deps, "users.list", token, body);
    if (!result.ok) {
      errors.push(`users.list: ${result.error ?? "failed"}`);
      break;
    }
    const members = (result.data.members as Array<Record<string, unknown>> | undefined) ?? [];
    for (const member of members) {
      const id = String(member.id ?? "");
      if (!id || id === "USLACKBOT") continue;
      const isBot = Boolean(member.is_bot) || Boolean(member.is_app_user);
      const deleted = Boolean(member.deleted);
      const profile = (member.profile as Record<string, unknown> | undefined) ?? {};
      const displayName =
        String(profile.display_name_normalized || profile.display_name || "").trim() ||
        String(member.real_name || profile.real_name || member.name || "").trim() ||
        null;
      const realName = String(member.real_name || profile.real_name || "").trim() || null;
      const username = String(member.name || "").trim() || null;
      const email = typeof profile.email === "string" ? profile.email : null;

      await upsertSlackUserProfile({
        team_id: input.teamId,
        slack_user_id: id,
        display_name: displayName,
        real_name: realName,
        username,
        email,
        is_bot: isBot,
        is_deleted: deleted,
        last_resolved_at: refreshedAt,
        resolve_error: null,
      });
      usersUpserted += 1;
      if (isBot || deleted) botsSkipped += 1;
      else activeHumans += 1;
    }
    const next = (result.data.response_metadata as { next_cursor?: string } | undefined)
      ?.next_cursor;
    if (!next) {
      usersComplete = true;
      break;
    }
    userCursor = next;
  }

  let channelsUpserted = 0;
  let publicChannels = 0;
  let privateChannels = 0;
  let channelPages = 0;
  let channelCursor: string | undefined;
  let channelsComplete = false;

  while (channelPages < MAX_CHANNEL_PAGES) {
    channelPages += 1;
    const body: Record<string, unknown> = {
      types: "public_channel,private_channel",
      exclude_archived: false,
      limit: PAGE_SIZE,
    };
    if (channelCursor) body.cursor = channelCursor;
    const result = await apiCall(input.deps, "conversations.list", token, body);
    if (!result.ok) {
      errors.push(`conversations.list: ${result.error ?? "failed"}`);
      break;
    }
    const channels = (result.data.channels as Array<Record<string, unknown>> | undefined) ?? [];
    for (const ch of channels) {
      const id = String(ch.id ?? "");
      if (!id) continue;
      const name = String(ch.name || "").trim() || null;
      const isPrivate = Boolean(ch.is_private);
      const isIm = Boolean(ch.is_im);
      const isMpim = Boolean(ch.is_mpim);
      let channelType = "public_channel";
      if (isIm) channelType = "im";
      else if (isMpim) channelType = "mpim";
      else if (isPrivate) channelType = "private_channel";

      await upsertSlackChannelProfile({
        team_id: input.teamId,
        slack_channel_id: id,
        name,
        channel_type: channelType,
        is_private: isPrivate,
        last_resolved_at: refreshedAt,
        resolve_error: null,
      });
      channelsUpserted += 1;
      if (isPrivate) privateChannels += 1;
      else publicChannels += 1;
    }
    const next = (result.data.response_metadata as { next_cursor?: string } | undefined)
      ?.next_cursor;
    if (!next) {
      channelsComplete = true;
      break;
    }
    channelCursor = next;
  }

  return {
    teamId: input.teamId,
    usersUpserted,
    channelsUpserted,
    publicChannels,
    privateChannels,
    activeHumans,
    botsSkipped,
    paginationComplete: usersComplete && channelsComplete,
    pagesFetched: { users: userPages, channels: channelPages },
    errors,
    refreshedAt,
  };
}
