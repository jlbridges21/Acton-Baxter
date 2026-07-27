import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { encryptSecret, decryptSecret } from "@/lib/security/secret-box";
import type { GhlAuthMode, GhlConnectionStatus } from "./types";

export type GhlConnectionRow = {
  id: string;
  auth_mode: GhlAuthMode;
  location_id: string;
  company_id: string | null;
  location_name: string | null;
  location_timezone: string | null;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
  granted_scopes: string[];
  expected_scopes: string[];
  status: GhlConnectionStatus;
  connected_by: string | null;
  connected_at: string | null;
  last_verified_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  last_error_message_safe: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type GhlConnectionPublic = Omit<
  GhlConnectionRow,
  "encrypted_access_token" | "encrypted_refresh_token"
> & {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
};

function toPublic(row: GhlConnectionRow): GhlConnectionPublic {
  const { encrypted_access_token, encrypted_refresh_token, ...rest } = row;
  return {
    ...rest,
    hasAccessToken: Boolean(encrypted_access_token),
    hasRefreshToken: Boolean(encrypted_refresh_token),
  };
}

function normalizeRow(raw: Record<string, unknown>): GhlConnectionRow {
  const grantedScopes = raw.granted_scopes;
  const expectedScopes = raw.expected_scopes;
  return {
    id: String(raw.id),
    auth_mode: raw.auth_mode as GhlAuthMode,
    location_id: String(raw.location_id ?? ""),
    company_id: (raw.company_id as string | null) ?? null,
    location_name: (raw.location_name as string | null) ?? null,
    location_timezone: (raw.location_timezone as string | null) ?? null,
    encrypted_access_token: (raw.encrypted_access_token as string | null) ?? null,
    encrypted_refresh_token: (raw.encrypted_refresh_token as string | null) ?? null,
    token_expires_at: (raw.token_expires_at as string | null) ?? null,
    granted_scopes: Array.isArray(grantedScopes) ? (grantedScopes as string[]) : [],
    expected_scopes: Array.isArray(expectedScopes) ? (expectedScopes as string[]) : [],
    status: raw.status as GhlConnectionStatus,
    connected_by: (raw.connected_by as string | null) ?? null,
    connected_at: (raw.connected_at as string | null) ?? null,
    last_verified_at: (raw.last_verified_at as string | null) ?? null,
    last_success_at: (raw.last_success_at as string | null) ?? null,
    last_error_code: (raw.last_error_code as string | null) ?? null,
    last_error_message_safe: (raw.last_error_message_safe as string | null) ?? null,
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  };
}

export async function getActiveGhlConnection(): Promise<GhlConnectionRow | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("ghl_connections")
      .select("*")
      .in("status", ["connected", "reauthorization_required", "warning", "error", "pending"])
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return normalizeRow(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function getActiveGhlConnectionPublic(): Promise<GhlConnectionPublic | null> {
  const row = await getActiveGhlConnection();
  return row ? toPublic(row) : null;
}

export async function getGhlConnectionById(id: string): Promise<GhlConnectionRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ghl_connections")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeRow(data as Record<string, unknown>);
}

export async function upsertGhlOAuthConnection(input: {
  locationId: string;
  companyId?: string | null;
  locationName?: string | null;
  locationTimezone?: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt?: string | null;
  grantedScopes: string[];
  expectedScopes: string[];
  connectedBy: string;
}): Promise<GhlConnectionPublic> {
  const encryptedAccessToken = encryptSecret(input.accessToken);
  const encryptedRefreshToken = encryptSecret(input.refreshToken);
  const supabase = createServiceClient();

  await supabase
    .from("ghl_connections")
    .update({
      status: "disconnected",
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      last_error_code: null,
      last_error_message_safe: "Superseded by a new GHL connection.",
      updated_at: new Date().toISOString(),
    })
    .neq("status", "disconnected");

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("ghl_connections")
    .insert({
      auth_mode: "oauth",
      location_id: input.locationId,
      company_id: input.companyId ?? null,
      location_name: input.locationName ?? null,
      location_timezone: input.locationTimezone ?? null,
      encrypted_access_token: encryptedAccessToken,
      encrypted_refresh_token: encryptedRefreshToken,
      token_expires_at: input.tokenExpiresAt ?? null,
      granted_scopes: input.grantedScopes,
      expected_scopes: input.expectedScopes,
      status: "connected",
      connected_by: input.connectedBy,
      connected_at: now,
      last_verified_at: now,
      last_success_at: now,
      last_error_code: null,
      last_error_message_safe: null,
      metadata: {},
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to store GHL connection");
  }

  return toPublic(normalizeRow(data as Record<string, unknown>));
}

export async function upsertGhlPrivateIntegrationConnection(input: {
  locationId: string;
  companyId?: string | null;
  locationName?: string | null;
  locationTimezone?: string | null;
  connectedBy: string;
}): Promise<GhlConnectionPublic> {
  const supabase = createServiceClient();

  await supabase
    .from("ghl_connections")
    .update({
      status: "disconnected",
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      last_error_code: null,
      last_error_message_safe: "Superseded by a new GHL connection.",
      updated_at: new Date().toISOString(),
    })
    .neq("status", "disconnected");

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("ghl_connections")
    .insert({
      auth_mode: "private_integration",
      location_id: input.locationId,
      company_id: input.companyId ?? null,
      location_name: input.locationName ?? null,
      location_timezone: input.locationTimezone ?? null,
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      token_expires_at: null,
      granted_scopes: [],
      expected_scopes: [],
      status: "connected",
      connected_by: input.connectedBy,
      connected_at: now,
      last_verified_at: now,
      last_success_at: now,
      last_error_code: null,
      last_error_message_safe: null,
      metadata: {},
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to store GHL connection");
  }

  return toPublic(normalizeRow(data as Record<string, unknown>));
}

export function decryptGhlConnectionAccessToken(row: GhlConnectionRow): string {
  if (!row.encrypted_access_token) {
    throw Object.assign(new Error("Access token missing"), {
      code: "BAXTER_GHL_TOKEN_EXPIRED",
    });
  }
  return decryptSecret(row.encrypted_access_token);
}

export function decryptGhlConnectionRefreshToken(row: GhlConnectionRow): string {
  if (!row.encrypted_refresh_token) {
    throw Object.assign(new Error("Refresh token missing"), {
      code: "BAXTER_GHL_REAUTH_REQUIRED",
    });
  }
  return decryptSecret(row.encrypted_refresh_token);
}

export async function markGhlConnectionReauth(input: {
  connectionId: string;
  code: string;
  message: string;
}): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("ghl_connections")
    .update({
      status: "reauthorization_required",
      last_error_code: input.code,
      last_error_message_safe: input.message.slice(0, 400),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.connectionId);
}

export async function markGhlConnectionSuccess(connectionId: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  await supabase
    .from("ghl_connections")
    .update({
      status: "connected",
      last_verified_at: now,
      last_success_at: now,
      last_error_code: null,
      last_error_message_safe: null,
      updated_at: now,
    })
    .eq("id", connectionId);
}

export async function markGhlConnectionError(input: {
  connectionId: string;
  code: string;
  message: string;
}): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("ghl_connections")
    .update({
      status: "error",
      last_error_code: input.code,
      last_error_message_safe: input.message.slice(0, 400),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.connectionId);
}

export async function updateGhlConnectionTokens(input: {
  connectionId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string | null;
}): Promise<void> {
  const supabase = createServiceClient();
  const updates: Record<string, unknown> = {
    encrypted_access_token: encryptSecret(input.accessToken),
    token_expires_at: input.expiresAt ?? null,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (input.refreshToken) {
    updates.encrypted_refresh_token = encryptSecret(input.refreshToken);
  }

  await supabase.from("ghl_connections").update(updates).eq("id", input.connectionId);
}

export async function disconnectGhlConnection(input: {
  connectionId?: string;
  adminUserId: string;
}): Promise<{ disconnected: true }> {
  const supabase = createServiceClient();
  const active = input.connectionId
    ? (
        await supabase
          .from("ghl_connections")
          .select("*")
          .eq("id", input.connectionId)
          .maybeSingle()
      ).data
    : await getActiveGhlConnection();

  if (active) {
    const row = normalizeRow(active as Record<string, unknown>);
    await supabase
      .from("ghl_connections")
      .update({
        status: "disconnected",
        encrypted_access_token: null,
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

  return { disconnected: true };
}

export async function listGhlConnections(): Promise<GhlConnectionPublic[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ghl_connections")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => toPublic(normalizeRow(row)));
}
