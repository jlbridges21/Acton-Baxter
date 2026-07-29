import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { inferChannelKind } from "./channels";
import type { ResolvedSlackChannel, ResolvedSlackPerson } from "./types";

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
      .limit(2000);
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
      .limit(2000);
    if (teamId) query = query.eq("team_id", teamId);
    const { data, error } = await query;
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((row) => {
      const id = String(row.slack_channel_id);
      const name = String(row.name || id);
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
      };
    });
  } catch {
    return [];
  }
}
