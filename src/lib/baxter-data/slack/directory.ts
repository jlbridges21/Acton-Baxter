import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { inferChannelKind } from "./channels";
import { refreshSlackWorkspaceDirectory } from "./directory-sync";
import type { ResolvedSlackChannel, ResolvedSlackPerson, SlackSearchDeps } from "./types";

/**
 * Load Slack identity directory from existing profile cache tables.
 * Identity metadata only — not message history.
 */
export async function listCachedSlackUsers(teamId: string): Promise<ResolvedSlackPerson[]> {
  try {
    const supabase = createServiceClient();
    let query = supabase
      .from("slack_user_profiles")
      .select("slack_user_id, team_id, display_name, real_name, username, is_bot, is_deleted")
      .eq("is_bot", false)
      .eq("is_deleted", false)
      .order("display_name", { ascending: true })
      .limit(5000);
    if (teamId) query = query.eq("team_id", teamId);
    const { data, error } = await query;
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.slack_user_id),
      displayName: String(row.display_name || row.real_name || row.username || "Slack user"),
      realName: row.real_name ? String(row.real_name) : null,
      username: row.username ? String(row.username) : null,
      teamId: String(row.team_id),
    }));
  } catch {
    return [];
  }
}

export async function listCachedSlackChannels(teamId: string): Promise<ResolvedSlackChannel[]> {
  try {
    const supabase = createServiceClient();
    let query = supabase
      .from("slack_channel_profiles")
      .select("slack_channel_id, team_id, name, channel_type, is_private")
      .order("name", { ascending: true })
      .limit(5000);
    if (teamId) query = query.eq("team_id", teamId);
    const { data, error } = await query;
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>)
      .map((row) => {
        const id = String(row.slack_channel_id);
        const rawName = row.name ? String(row.name).trim() : "";
        // Skip nameless rows — they cannot resolve by human channel names
        if (!rawName) return null;
        const name = rawName;
        const isPrivate = Boolean(row.is_private);
        const kind = inferChannelKind({
          id,
          isPrivate,
          channelType: row.channel_type ? String(row.channel_type) : null,
        });
        return {
          id,
          name,
          displayLabel: `#${name.replace(/^#/, "")}`,
          teamId: String(row.team_id),
          kind,
          isPrivate,
        } satisfies ResolvedSlackChannel;
      })
      .filter((c): c is ResolvedSlackChannel => Boolean(c));
  } catch {
    return [];
  }
}

export type SlackDirectoryHealth = {
  usersCached: number;
  channelsCached: number;
  publicChannels: number;
  privateChannels: number;
  activeHumans: number;
  lastUserResolvedAt: string | null;
  lastChannelResolvedAt: string | null;
};

export async function getSlackDirectoryHealth(teamId: string): Promise<SlackDirectoryHealth> {
  try {
    const supabase = createServiceClient();
    let usersQ = supabase
      .from("slack_user_profiles")
      .select("is_bot, is_deleted, last_resolved_at", { count: "exact" });
    let channelsQ = supabase
      .from("slack_channel_profiles")
      .select("is_private, name, last_resolved_at", { count: "exact" });
    if (teamId) {
      usersQ = usersQ.eq("team_id", teamId);
      channelsQ = channelsQ.eq("team_id", teamId);
    }
    const [usersRes, channelsRes] = await Promise.all([usersQ.limit(5000), channelsQ.limit(5000)]);
    const users = (usersRes.data as Array<Record<string, unknown>> | null) ?? [];
    const channels = (channelsRes.data as Array<Record<string, unknown>> | null) ?? [];
    const activeHumans = users.filter((u) => !u.is_bot && !u.is_deleted).length;
    const publicChannels = channels.filter((c) => !c.is_private && c.name).length;
    const privateChannels = channels.filter((c) => c.is_private && c.name).length;
    const lastUser = users
      .map((u) => (typeof u.last_resolved_at === "string" ? u.last_resolved_at : null))
      .filter(Boolean)
      .sort()
      .at(-1);
    const lastChannel = channels
      .map((c) => (typeof c.last_resolved_at === "string" ? c.last_resolved_at : null))
      .filter(Boolean)
      .sort()
      .at(-1);
    return {
      usersCached: usersRes.count ?? users.length,
      channelsCached: channelsRes.count ?? channels.length,
      publicChannels,
      privateChannels,
      activeHumans,
      lastUserResolvedAt: lastUser ?? null,
      lastChannelResolvedAt: lastChannel ?? null,
    };
  } catch {
    return {
      usersCached: 0,
      channelsCached: 0,
      publicChannels: 0,
      privateChannels: 0,
      activeHumans: 0,
      lastUserResolvedAt: null,
      lastChannelResolvedAt: null,
    };
  }
}

/**
 * Refresh directory from Slack once, then return updated caches.
 * Used on resolution miss — identity metadata only.
 */
export async function refreshAndListDirectory(
  teamId: string,
  deps?: SlackSearchDeps,
): Promise<{
  users: ResolvedSlackPerson[];
  channels: ResolvedSlackChannel[];
  refresh: Awaited<ReturnType<typeof refreshSlackWorkspaceDirectory>>;
}> {
  const refresh = await refreshSlackWorkspaceDirectory({ teamId, deps });
  const [users, channels] = await Promise.all([
    listCachedSlackUsers(teamId),
    listCachedSlackChannels(teamId),
  ]);
  return { users, channels, refresh };
}
