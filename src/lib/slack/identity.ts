import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { isAppAccessRole } from "@/lib/auth/roles";
import { resolveSlackUserProfile } from "@/lib/slack/profiles";

export type SlackBaxterIdentityMatch = {
  userId: string;
  displayName: string | null;
  /** How the Slack user was matched to Baxter — never Slack Search OAuth alone. */
  matchedVia: "slack_search_connection" | "slack_user_mapping" | "email";
};

/**
 * Resolve a Slack slash-command user to an existing Baxter profile.
 * Does NOT require Slack Search OAuth — PEM/clear identity must work without it.
 *
 * Order:
 * 1. Existing Slack Search connection (incidental link)
 * 2. slack_user_mappings (admin or prior OAuth mapping)
 * 3. Slack profile email → auth.users email → profiles with app access
 */
export async function resolveBaxterUserForSlackIdentity(input: {
  slackUserId: string;
  slackTeamId: string;
}): Promise<SlackBaxterIdentityMatch | null> {
  const supabase = createServiceClient();

  // 1) Optional: already linked via Slack Search (same workspace user).
  const { data: linked } = await supabase
    .from("slack_search_connections")
    .select("baxter_user_id")
    .eq("slack_user_id", input.slackUserId)
    .eq("slack_team_id", input.slackTeamId)
    .eq("status", "connected")
    .maybeSingle();

  if (linked?.baxter_user_id) {
    const profile = await loadAppAccessProfile(String(linked.baxter_user_id));
    if (profile) {
      return {
        userId: profile.id,
        displayName: profile.full_name,
        matchedVia: "slack_search_connection",
      };
    }
  }

  // 2) Explicit Slack ↔ Baxter mapping table (no Search token required).
  const { data: mapping } = await supabase
    .from("slack_user_mappings")
    .select("app_user_id")
    .eq("slack_user_id", input.slackUserId)
    .eq("slack_team_id", input.slackTeamId)
    .maybeSingle();

  if (mapping?.app_user_id) {
    const profile = await loadAppAccessProfile(String(mapping.app_user_id));
    if (profile) {
      return {
        userId: profile.id,
        displayName: profile.full_name,
        matchedVia: "slack_user_mapping",
      };
    }
  }

  // 3) Email match via bot users.info → auth.users.
  const slackProfile = await resolveSlackUserProfile({
    teamId: input.slackTeamId,
    slackUserId: input.slackUserId,
  }).catch(() => null);

  const email = slackProfile?.email?.trim().toLowerCase() ?? null;
  if (!email) return null;

  const matchedUserId = await findAuthUserIdByEmail(email);
  if (!matchedUserId) return null;

  const profile = await loadAppAccessProfile(matchedUserId);
  if (!profile) return null;

  // Persist mapping for next time (service role; ignore failures).
  await upsertSlackUserMapping({
    slackTeamId: input.slackTeamId,
    slackUserId: input.slackUserId,
    appUserId: profile.id,
  }).catch(() => undefined);

  return {
    userId: profile.id,
    displayName: profile.full_name,
    matchedVia: "email",
  };
}

export async function upsertSlackUserMapping(input: {
  slackTeamId: string;
  slackUserId: string;
  appUserId: string;
}): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from("slack_user_mappings").upsert(
    {
      slack_team_id: input.slackTeamId,
      slack_user_id: input.slackUserId,
      app_user_id: input.appUserId,
    },
    { onConflict: "slack_team_id,slack_user_id" },
  );
}

async function loadAppAccessProfile(
  userId: string,
): Promise<{ id: string; full_name: string | null } | null> {
  const supabase = createServiceClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || !isAppAccessRole(profile.role)) return null;
  return { id: String(profile.id), full_name: profile.full_name ?? null };
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const supabase = createServiceClient();
  // Prefer exact lookup when available on the admin API.
  const admin = supabase.auth.admin as {
    getUserByEmail?: (
      email: string,
    ) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    listUsers: (args: {
      page: number;
      perPage: number;
    }) => Promise<{ data: { users: Array<{ id: string; email?: string }> }; error: unknown }>;
  };

  if (typeof admin.getUserByEmail === "function") {
    const { data, error } = await admin.getUserByEmail(email);
    if (!error && data.user?.id) return data.user.id;
  }

  // Fallback: scan first pages (Acton workspace is small).
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    const hit = data.users.find((u) => (u.email ?? "").trim().toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

export const PEM_UNMAPPED_SLACK_USER_MESSAGE =
  "Baxter couldn’t match your Slack account to an Acton Baxter user. Ask an admin to make sure your Baxter account email matches your Slack email, or create the PEM at the web app.";

/** Canonical name used by slash-command / PEM identity resolution. */
export const resolveBaxterProfileForSlackUser = resolveBaxterUserForSlackIdentity;
