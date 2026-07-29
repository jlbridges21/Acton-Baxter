import "server-only";

import { listAllSlackChannelProfiles, listAllSlackUserProfiles } from "@/lib/slack/profiles";
import { inferChannelKind } from "./channels";
import { refreshSlackWorkspaceDirectory } from "./directory-sync";
import type { ResolvedSlackChannel, ResolvedSlackPerson, SlackSearchDeps } from "./types";

/**
 * Load Slack identity directory from existing profile cache tables.
 * Identity metadata only — not message history.
 */
export async function listCachedSlackUsers(teamId: string): Promise<ResolvedSlackPerson[]> {
  try {
    const rows = await listAllSlackUserProfiles();
    return rows
      .filter((row) => (!teamId || row.team_id === teamId) && !row.is_bot && !row.is_deleted)
      .slice(0, 5000)
      .map((row) => ({
        id: row.slack_user_id,
        displayName: row.display_name || row.real_name || row.username || "Slack user",
        realName: row.real_name,
        username: row.username,
        teamId: row.team_id,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch {
    return [];
  }
}

export async function listCachedSlackChannels(teamId: string): Promise<ResolvedSlackChannel[]> {
  try {
    const rows = await listAllSlackChannelProfiles();
    const mapped: ResolvedSlackChannel[] = [];
    for (const row of rows) {
      if (teamId && row.team_id !== teamId) continue;
      const rawName = row.name?.trim() ?? "";
      if (!rawName) continue;
      const isPrivate = Boolean(row.is_private);
      const isArchived = Boolean(row.is_archived);
      const kind = inferChannelKind({
        id: row.slack_channel_id,
        isPrivate,
        channelType: row.channel_type,
      });
      mapped.push({
        id: row.slack_channel_id,
        name: rawName,
        displayLabel: `#${rawName.replace(/^#/, "")}`,
        teamId: row.team_id,
        kind,
        isPrivate,
        isArchived,
        isMember: row.is_member ?? null,
      });
    }
    return mapped
      .sort((a, b) => {
        const aArch = a.isArchived ? 1 : 0;
        const bArch = b.isArchived ? 1 : 0;
        if (aArch !== bArch) return aArch - bArch;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 5000);
  } catch {
    return [];
  }
}

export type SlackDirectoryHealth = {
  usersCached: number;
  channelsCached: number;
  /** Non-archived public channels with names */
  publicChannels: number;
  /** Non-archived private channels with names */
  privateChannels: number;
  archivedChannels: number;
  activeHumans: number;
  lastUserResolvedAt: string | null;
  lastChannelResolvedAt: string | null;
};

export async function getSlackDirectoryHealth(teamId: string): Promise<SlackDirectoryHealth> {
  try {
    const [allUsers, allChannels] = await Promise.all([
      listAllSlackUserProfiles(),
      listAllSlackChannelProfiles(),
    ]);
    const users = allUsers.filter((u) => !teamId || u.team_id === teamId);
    const channels = allChannels.filter((c) => !teamId || c.team_id === teamId);
    const activeHumans = users.filter((u) => !u.is_bot && !u.is_deleted).length;
    const archivedChannels = channels.filter((c) => c.is_archived && c.name).length;
    const publicChannels = channels.filter((c) => !c.is_private && !c.is_archived && c.name).length;
    const privateChannels = channels.filter((c) => c.is_private && !c.is_archived && c.name).length;
    const lastUser = users
      .map((u) => u.last_resolved_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1);
    const lastChannel = channels
      .map((c) => c.last_resolved_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1);
    return {
      usersCached: users.length,
      channelsCached: channels.length,
      publicChannels,
      privateChannels,
      archivedChannels,
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
      archivedChannels: 0,
      activeHumans: 0,
      lastUserResolvedAt: null,
      lastChannelResolvedAt: null,
    };
  }
}

/**
 * Refresh directory from Slack once, then return updated caches.
 * Used on resolution miss — identity metadata only.
 * Prefer mode "fast" inside answer jobs so refresh cannot stall replies.
 */
export async function refreshAndListDirectory(
  teamId: string,
  deps?: SlackSearchDeps,
  options?: { mode?: "full" | "fast" },
): Promise<{
  users: ResolvedSlackPerson[];
  channels: ResolvedSlackChannel[];
  refresh: Awaited<ReturnType<typeof refreshSlackWorkspaceDirectory>>;
}> {
  const refresh = await refreshSlackWorkspaceDirectory({
    teamId,
    deps,
    mode: options?.mode ?? "full",
  });
  const [users, channels] = await Promise.all([
    listCachedSlackUsers(teamId),
    listCachedSlackChannels(teamId),
  ]);
  return { users, channels, refresh };
}
