import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import {
  decryptSecret,
  encryptSecret,
  isTokenEncryptionConfigured,
} from "@/lib/security/secret-box";
import { capabilitiesFromScopes } from "./permissions";
import type { SlackCredentialResolution, SlackRequester } from "./types";

type ConnectionRow = {
  id: string;
  baxter_user_id: string;
  slack_user_id: string;
  slack_team_id: string;
  slack_user_name: string | null;
  encrypted_access_token: string;
  granted_scopes: unknown;
  status: string;
};

function parseScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export async function loadUserSearchCredential(
  requester: SlackRequester,
): Promise<SlackCredentialResolution | null> {
  if (!isTokenEncryptionConfigured()) return null;

  try {
    const supabase = createServiceClient();
    let query = supabase
      .from("slack_search_connections")
      .select(
        "id, baxter_user_id, slack_user_id, slack_team_id, slack_user_name, encrypted_access_token, granted_scopes, status",
      )
      .eq("status", "connected")
      .limit(1);

    if (requester.baxterUserId) {
      query = query.eq("baxter_user_id", requester.baxterUserId);
    } else if (requester.slackUserId) {
      query = query.eq("slack_user_id", requester.slackUserId);
      if (requester.slackTeamId) query = query.eq("slack_team_id", requester.slackTeamId);
    } else {
      return null;
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;

    const row = data as ConnectionRow;
    // If both IDs present, require they match the stored mapping.
    if (
      requester.slackUserId &&
      requester.baxterUserId &&
      (row.slack_user_id !== requester.slackUserId || row.baxter_user_id !== requester.baxterUserId)
    ) {
      return null;
    }

    const token = decryptSecret(row.encrypted_access_token);
    const scopes = parseScopes(row.granted_scopes);
    return {
      token,
      tokenKind: "user",
      slackUserId: row.slack_user_id,
      slackTeamId: row.slack_team_id,
      scopes,
      capabilities: capabilitiesFromScopes(scopes, "user", "configured"),
    };
  } catch {
    return null;
  }
}

export async function upsertSlackSearchConnection(input: {
  baxterUserId: string;
  slackUserId: string;
  slackTeamId: string;
  slackUserName?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  scopes: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isTokenEncryptionConfigured()) {
    return { ok: false, error: "token_encryption_not_configured" };
  }
  try {
    const supabase = createServiceClient();
    const encrypted = encryptSecret(input.accessToken);
    const encryptedRefresh = input.refreshToken ? encryptSecret(input.refreshToken) : null;
    const { data, error } = await supabase
      .from("slack_search_connections")
      .upsert(
        {
          baxter_user_id: input.baxterUserId,
          slack_user_id: input.slackUserId,
          slack_team_id: input.slackTeamId,
          slack_user_name: input.slackUserName ?? null,
          encrypted_access_token: encrypted,
          encrypted_refresh_token: encryptedRefresh,
          granted_scopes: input.scopes,
          status: "connected",
          last_verified_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          last_error_code: null,
          last_error_message_safe: null,
        },
        { onConflict: "baxter_user_id,slack_team_id" },
      )
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "upsert_failed" };
    return { ok: true, id: (data as { id: string }).id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "upsert_failed" };
  }
}

export async function getSlackSearchConnectionMetadata(baxterUserId: string): Promise<{
  linked: boolean;
  slackUserId: string | null;
  slackTeamId: string | null;
  slackUserName: string | null;
  scopes: string[];
  status: string | null;
} | null> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("slack_search_connections")
      .select("slack_user_id, slack_team_id, slack_user_name, granted_scopes, status")
      .eq("baxter_user_id", baxterUserId)
      .maybeSingle();
    if (!data) {
      return {
        linked: false,
        slackUserId: null,
        slackTeamId: null,
        slackUserName: null,
        scopes: [],
        status: null,
      };
    }
    const row = data as {
      slack_user_id: string;
      slack_team_id: string;
      slack_user_name: string | null;
      granted_scopes: unknown;
      status: string;
    };
    return {
      linked: row.status === "connected",
      slackUserId: row.slack_user_id,
      slackTeamId: row.slack_team_id,
      slackUserName: row.slack_user_name,
      scopes: parseScopes(row.granted_scopes),
      status: row.status,
    };
  } catch {
    return null;
  }
}

export async function createSlackSearchOAuthState(input: {
  baxterUserId: string;
  returnPath?: string;
}): Promise<{ state: string } | null> {
  try {
    const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const supabase = createServiceClient();
    const { error } = await supabase.from("slack_search_oauth_states").insert({
      state,
      baxter_user_id: input.baxterUserId,
      return_path: input.returnPath ?? "/settings/integrations",
      expires_at: expires,
    });
    if (error) return null;
    return { state };
  } catch {
    return null;
  }
}

export async function consumeSlackSearchOAuthState(state: string): Promise<{
  baxterUserId: string;
  returnPath: string;
} | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("slack_search_oauth_states")
      .select("baxter_user_id, return_path, expires_at, consumed_at")
      .eq("state", state)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      baxter_user_id: string;
      return_path: string;
      expires_at: string;
      consumed_at: string | null;
    };
    if (row.consumed_at) return null;
    if (Date.parse(row.expires_at) < Date.now()) return null;
    await supabase
      .from("slack_search_oauth_states")
      .update({ consumed_at: new Date().toISOString() })
      .eq("state", state);
    return { baxterUserId: row.baxter_user_id, returnPath: row.return_path };
  } catch {
    return null;
  }
}
