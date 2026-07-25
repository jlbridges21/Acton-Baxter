import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/security/secret-box";
import type { GoogleAuthMode } from "./credentials/types";

export type GoogleConnectionStatus =
  "pending" | "connected" | "reauthorization_required" | "invalid" | "disconnected" | "error";

export type GoogleConnectionRow = {
  id: string;
  auth_mode: Exclude<GoogleAuthMode, "disconnected">;
  google_account_email: string | null;
  google_account_subject: string | null;
  hosted_domain: string | null;
  encrypted_refresh_token: string | null;
  access_token_expires_at: string | null;
  granted_scopes: string[];
  status: GoogleConnectionStatus;
  connected_by: string | null;
  connected_at: string | null;
  last_refreshed_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  last_error_message_safe: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/** Safe fields only — never include encrypted_refresh_token. */
export type GoogleConnectionPublic = Omit<GoogleConnectionRow, "encrypted_refresh_token"> & {
  hasRefreshToken: boolean;
};

function toPublic(row: GoogleConnectionRow): GoogleConnectionPublic {
  const { encrypted_refresh_token, ...rest } = row;
  return {
    ...rest,
    hasRefreshToken: Boolean(encrypted_refresh_token),
  };
}

function normalizeRow(raw: Record<string, unknown>): GoogleConnectionRow {
  const scopes = raw.granted_scopes;
  return {
    id: String(raw.id),
    auth_mode: raw.auth_mode as GoogleConnectionRow["auth_mode"],
    google_account_email: (raw.google_account_email as string | null) ?? null,
    google_account_subject: (raw.google_account_subject as string | null) ?? null,
    hosted_domain: (raw.hosted_domain as string | null) ?? null,
    encrypted_refresh_token: (raw.encrypted_refresh_token as string | null) ?? null,
    access_token_expires_at: (raw.access_token_expires_at as string | null) ?? null,
    granted_scopes: Array.isArray(scopes) ? (scopes as string[]) : [],
    status: raw.status as GoogleConnectionStatus,
    connected_by: (raw.connected_by as string | null) ?? null,
    connected_at: (raw.connected_at as string | null) ?? null,
    last_refreshed_at: (raw.last_refreshed_at as string | null) ?? null,
    last_success_at: (raw.last_success_at as string | null) ?? null,
    last_error_code: (raw.last_error_code as string | null) ?? null,
    last_error_message_safe: (raw.last_error_message_safe as string | null) ?? null,
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  };
}

export async function getActiveGoogleConnection(): Promise<GoogleConnectionRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("google_connections")
    .select("*")
    .in("status", ["connected", "reauthorization_required", "error", "pending"])
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return normalizeRow(data as Record<string, unknown>);
}

export async function getActiveGoogleConnectionPublic(): Promise<GoogleConnectionPublic | null> {
  const row = await getActiveGoogleConnection();
  return row ? toPublic(row) : null;
}

export async function upsertWorkspaceOauthConnection(input: {
  email: string;
  subject?: string | null;
  hostedDomain?: string | null;
  refreshToken: string;
  grantedScopes: string[];
  connectedBy: string;
  accessTokenExpiresAt?: string | null;
}): Promise<GoogleConnectionPublic> {
  const encrypted = encryptSecret(input.refreshToken);
  const supabase = createServiceClient();

  // Disconnect any prior active connections (keep history rows as disconnected).
  await supabase
    .from("google_connections")
    .update({
      status: "disconnected",
      encrypted_refresh_token: null,
      last_error_code: null,
      last_error_message_safe: "Superseded by a new Google Workspace connection.",
      updated_at: new Date().toISOString(),
    })
    .neq("status", "disconnected");

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("google_connections")
    .insert({
      auth_mode: "workspace_oauth",
      google_account_email: input.email.toLowerCase(),
      google_account_subject: input.subject ?? null,
      hosted_domain: input.hostedDomain ?? null,
      encrypted_refresh_token: encrypted,
      access_token_expires_at: input.accessTokenExpiresAt ?? null,
      granted_scopes: input.grantedScopes,
      status: "connected",
      connected_by: input.connectedBy,
      connected_at: now,
      last_refreshed_at: now,
      last_success_at: now,
      last_error_code: null,
      last_error_message_safe: null,
      metadata: {},
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to store Google connection");
  }
  return toPublic(normalizeRow(data as Record<string, unknown>));
}

export function decryptConnectionRefreshToken(row: GoogleConnectionRow): string {
  if (!row.encrypted_refresh_token) {
    throw Object.assign(new Error("Refresh token missing"), {
      code: "BAXTER_GOOGLE_REFRESH_TOKEN_MISSING",
    });
  }
  return decryptSecret(row.encrypted_refresh_token);
}

export async function markGoogleConnectionReauth(input: {
  connectionId: string;
  code: string;
  message: string;
}): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("google_connections")
    .update({
      status: "reauthorization_required",
      last_error_code: input.code,
      last_error_message_safe: input.message.slice(0, 400),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.connectionId);
}

export async function markGoogleConnectionSuccess(connectionId: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  await supabase
    .from("google_connections")
    .update({
      status: "connected",
      last_refreshed_at: now,
      last_success_at: now,
      last_error_code: null,
      last_error_message_safe: null,
      updated_at: now,
    })
    .eq("id", connectionId);
}

export async function updateConnectionAccessExpiry(
  connectionId: string,
  expiresAt: string,
): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("google_connections")
    .update({
      access_token_expires_at: expiresAt,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
}

export async function disconnectGoogleConnection(input: {
  connectionId?: string;
  archiveKnowledge?: boolean;
  adminUserId: string;
}): Promise<{ disconnected: true; archivedCount: number }> {
  const supabase = createServiceClient();
  const active = input.connectionId
    ? (
        await supabase
          .from("google_connections")
          .select("*")
          .eq("id", input.connectionId)
          .maybeSingle()
      ).data
    : await getActiveGoogleConnection();

  let archivedCount = 0;
  if (active) {
    const row = normalizeRow(active as Record<string, unknown>);
    await supabase
      .from("google_connections")
      .update({
        status: "disconnected",
        encrypted_refresh_token: null,
        last_error_code: null,
        last_error_message_safe: "Disconnected by admin.",
        metadata: {
          ...row.metadata,
          disconnected_by: input.adminUserId,
          disconnected_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }

  if (input.archiveKnowledge) {
    const { listAllKnowledgeEntriesForRetrieval, setKnowledgeEntryStatus } =
      await import("@/lib/knowledge/store");
    const entries = await listAllKnowledgeEntriesForRetrieval();
    for (const entry of entries) {
      if (entry.source_type === "Google Drive" && entry.status === "approved") {
        await setKnowledgeEntryStatus(entry.id, "archived", input.adminUserId);
        archivedCount += 1;
      }
    }
  }

  return { disconnected: true, archivedCount };
}

export async function revokeGoogleRefreshToken(refreshToken: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch {
    // Best-effort revoke
  }
}
