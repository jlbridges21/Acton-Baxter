/**
 * Pure helpers for Slack display labels (no I/O).
 */

export type SlackUserProfileLike = {
  slack_user_id: string;
  display_name?: string | null;
  real_name?: string | null;
  username?: string | null;
};

export type SlackChannelProfileLike = {
  slack_channel_id: string;
  name?: string | null;
  channel_type?: string | null;
  is_private?: boolean | null;
  /** When set for DMs, prefer "Direct Message with {name}". */
  peer_display_name?: string | null;
};

/** Preferred: display_name → real_name → username → Slack user <id>. */
export function pickSlackDisplayName(profile: SlackUserProfileLike): string {
  const display = profile.display_name?.trim();
  if (display) return display;
  const real = profile.real_name?.trim();
  if (real) return real;
  const username = profile.username?.trim();
  if (username) return username;
  return slackUserFallbackLabel(profile.slack_user_id);
}

/** Prefer a useful ID over opaque "Unknown" when lookup failed. */
export function slackUserFallbackLabel(slackUserId: string | null | undefined): string {
  if (!slackUserId) return "Unknown Slack user";
  return `Slack user ${slackUserId}`;
}

export function isSlackDmChannelId(channelId: string | null | undefined): boolean {
  return Boolean(channelId && channelId.startsWith("D"));
}

export function isSlackPrivateChannelId(channelId: string | null | undefined): boolean {
  return Boolean(channelId && channelId.startsWith("G"));
}

/** Human-readable channel title for admin UI. */
export function pickSlackChannelLabel(profile: SlackChannelProfileLike): string {
  const id = profile.slack_channel_id;
  if (isSlackDmChannelId(id) || profile.channel_type === "im") {
    const peer = profile.peer_display_name?.trim();
    if (peer) return `Direct Message with ${peer}`;
    return "Direct Message";
  }
  const name = profile.name?.trim();
  if (name) {
    return name.startsWith("#") ? name : `#${name}`;
  }
  if (
    profile.is_private ||
    isSlackPrivateChannelId(id) ||
    profile.channel_type === "private_channel"
  ) {
    return "Private channel";
  }
  if (id) return "Unknown Channel";
  return "Unknown Channel";
}

export function parseSlackExternalThreadId(externalThreadId: string | null | undefined): {
  teamId: string | null;
  channelId: string | null;
  threadOrUserKey: string | null;
  isDmKey: boolean;
} {
  if (!externalThreadId) {
    return { teamId: null, channelId: null, threadOrUserKey: null, isDmKey: false };
  }
  const parts = externalThreadId.split(":");
  const teamId = parts[0] ?? null;
  const channelId = parts[1] ?? null;
  const threadOrUserKey = parts[2] ?? null;
  const isDmKey = Boolean(channelId && channelId.startsWith("D"));
  return { teamId, channelId, threadOrUserKey, isDmKey };
}

/** Cache freshness window for Slack profile lookups. */
export const SLACK_PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function isSlackProfileStale(
  lastResolvedAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastResolvedAt) return true;
  const then = Date.parse(lastResolvedAt);
  if (!Number.isFinite(then)) return true;
  return now - then > SLACK_PROFILE_CACHE_TTL_MS;
}
