/**
 * BambooHR OAuth 2.0 (authorization-code) connection for the "Baxter" developer application.
 *
 * Verified against BambooHR's documentation (Getting Started; Single Sign-On with OpenID Connect):
 *   authorize: https://{companyDomain}.bamboohr.com/authorize.php?request=authorize&state=…&response_type=code&scope=a+b&client_id=…&redirect_uri=…
 *   token:     POST https://{companyDomain}.bamboohr.com/token.php?request=token
 *              {client_id, client_secret, code|refresh_token, grant_type, redirect_uri}
 *              → {access_token, expires_in, token_type, scope (space-separated), refresh_token, id_token, companyDomain}
 *   userinfo:  https://{companyDomain}.bamboohr.com/token.php?request=userInfo (Bearer) → {sub, email, company_id}
 *   A refresh token is returned only when `offline_access` was requested.
 *
 * Tokens are encrypted at rest (AES-256-GCM, src/lib/security/secret-box.ts) and never leave the
 * server. One connection per company domain.
 */

import "server-only";

import { randomBytes } from "node:crypto";
import { recordAudit } from "@/lib/agents/audit";
import { agentDb, eq, selectOne } from "@/lib/agents/store";
import {
  decryptSecret,
  encryptSecret,
  isTokenEncryptionConfigured,
} from "@/lib/security/secret-box";
import { BambooError } from "./errors";
import { missingScopes, scopesFor } from "./scopes";

export type BambooConfig = {
  clientId: string;
  clientSecret: string;
  companyDomain: string;
  redirectUri: string;
};

const env = (n: string) => (process.env[n] ?? "").trim();
const DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

/** Callback path registered in the BambooHR Developer Portal (prefixed with the app's base URL). */
export const CALLBACK_PATH = "/api/integrations/bamboohr/oauth/callback";

export function bambooRedirectUri(): string {
  const explicit = env("BAMBOOHR_REDIRECT_URI");
  if (explicit) return explicit;
  const base = (env("APP_BASE_URL") || env("NEXT_PUBLIC_APP_URL")).replace(/\/+$/, "");
  return base ? `${base}${CALLBACK_PATH}` : "";
}

export function bambooConfig(): BambooConfig | null {
  const clientId = env("BAMBOOHR_CLIENT_ID");
  const clientSecret = env("BAMBOOHR_CLIENT_SECRET");
  const companyDomain = env("BAMBOOHR_COMPANY_DOMAIN").toLowerCase();
  const redirectUri = bambooRedirectUri();
  if (
    !clientId ||
    !clientSecret ||
    !companyDomain ||
    !redirectUri ||
    !DOMAIN_RE.test(companyDomain)
  )
    return null;
  return { clientId, clientSecret, companyDomain, redirectUri };
}

/** What's missing before an administrator can press Connect (names only, never values). */
export function configProblems(): string[] {
  const p: string[] = [];
  if (!env("BAMBOOHR_CLIENT_ID")) p.push("BAMBOOHR_CLIENT_ID");
  if (!env("BAMBOOHR_CLIENT_SECRET")) p.push("BAMBOOHR_CLIENT_SECRET");
  const d = env("BAMBOOHR_COMPANY_DOMAIN");
  if (!d) p.push("BAMBOOHR_COMPANY_DOMAIN");
  else if (!DOMAIN_RE.test(d))
    p.push("BAMBOOHR_COMPANY_DOMAIN (use only the part before .bamboohr.com)");
  if (!bambooRedirectUri()) p.push("BAMBOOHR_REDIRECT_URI (or APP_BASE_URL)");
  if (!isTokenEncryptionConfigured())
    p.push("a token encryption key (GOOGLE_TOKEN_ENCRYPTION_KEY is reused)");
  return p;
}

// ---------------------------------------------------------------------------
// HTTP seam (tests replace it)
// ---------------------------------------------------------------------------
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const defaultFetcher: Fetcher = (url, init) =>
  fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });
let fetcher: Fetcher = defaultFetcher;
export function setBambooFetcherForTests(f: Fetcher | null) {
  fetcher = f ?? defaultFetcher;
}
export function bambooFetch(url: string, init: RequestInit): Promise<Response> {
  return fetcher(url, init);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export type ConnectionRow = {
  id: string;
  company_domain: string;
  company_id: string | null;
  company_name: string | null;
  connected_email: string | null;
  connected_sub: string | null;
  requested_scopes: string[];
  granted_scopes: string[];
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  access_token_expires_at: string | null;
  status: "connected" | "reauthorization_required" | "error" | "disconnected";
  capabilities: Record<string, unknown>;
  capabilities_checked_at: string | null;
  refresh_lock_until: string | null;
  last_refresh_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function getConnection(): Promise<ConnectionRow | null> {
  const cfg = bambooConfig();
  const domain = cfg?.companyDomain ?? env("BAMBOOHR_COMPANY_DOMAIN").toLowerCase();
  if (!domain) return null;
  return selectOne<ConnectionRow>("bamboohr_connections", {
    filters: [eq("company_domain", domain)],
  });
}

/** Safe view for the UI: no tokens, ever. */
export function publicConnection(row: ConnectionRow | null) {
  if (!row) return null;
  return {
    companyDomain: row.company_domain,
    companyName: row.company_name,
    companyId: row.company_id,
    connectedEmail: row.connected_email,
    status: row.status,
    requestedScopes: row.requested_scopes,
    grantedScopes: row.granted_scopes,
    missingScopes: missingScopes(row.requested_scopes, row.granted_scopes),
    hasRefreshToken: Boolean(row.encrypted_refresh_token),
    accessTokenExpiresAt: row.access_token_expires_at,
    lastRefreshAt: row.last_refresh_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    capabilities: row.capabilities,
    capabilitiesCheckedAt: row.capabilities_checked_at,
    updatedAt: row.updated_at,
  };
}
export type PublicConnection = NonNullable<ReturnType<typeof publicConnection>>;

// ---------------------------------------------------------------------------
// Authorization request (CSRF state)
// ---------------------------------------------------------------------------
const STATE_TTL_MS = 15 * 60_000;
type StateRow = {
  id: string;
  state: string;
  user_id: string;
  expires_at: string;
  consumed_at: string | null;
};

export async function startAuthorization(input: {
  userId: string;
  optionalGroups: string[];
}): Promise<{ url: string; scopes: string[] }> {
  const cfg = bambooConfig();
  if (!cfg)
    throw new BambooError(
      `BambooHR isn't configured yet. Missing: ${configProblems().join(", ")}.`,
      "not_configured",
    );
  if (!isTokenEncryptionConfigured())
    throw new BambooError(
      "A token encryption key must be configured before connecting.",
      "not_configured",
    );
  const scopes = scopesFor(input.optionalGroups);
  const state = randomBytes(32).toString("base64url");
  await agentDb().insert("bamboohr_oauth_states", {
    state,
    user_id: input.userId,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  // Remember what was requested so missing grants can be reported after the callback.
  const existing = await getConnection();
  if (existing)
    await agentDb().update("bamboohr_connections", [eq("id", existing.id)], {
      requested_scopes: scopes,
    });
  else pendingScopes.set(input.userId, scopes);
  const q = [
    ["request", "authorize"],
    ["state", state],
    ["response_type", "code"],
    ["client_id", cfg.clientId],
    ["redirect_uri", cfg.redirectUri],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
  // BambooHR documents scopes as "multiple scopes separated by plus +".
  q.push(`scope=${scopes.map(encodeURIComponent).join("+")}`);
  return { url: `https://${cfg.companyDomain}.bamboohr.com/authorize.php?${q.join("&")}`, scopes };
}
const pendingScopes = new Map<string, string[]>();

async function consumeState(state: string, userId: string): Promise<void> {
  if (!state)
    throw new BambooError(
      "The BambooHR response had no state value. Start Connect again.",
      "state_invalid",
    );
  const row = await selectOne<StateRow>("bamboohr_oauth_states", { filters: [eq("state", state)] });
  if (!row)
    throw new BambooError("Unknown connection request. Start Connect again.", "state_invalid");
  if (row.consumed_at)
    throw new BambooError(
      "This connection request was already used. Start Connect again.",
      "state_invalid",
    );
  if (Date.parse(row.expires_at) < Date.now())
    throw new BambooError("The connection request expired. Start Connect again.", "state_invalid");
  if (row.user_id !== userId)
    throw new BambooError(
      "This connection was started by a different Baxter user.",
      "state_invalid",
    );
  const [claimed] = await agentDb().update<StateRow>(
    "bamboohr_oauth_states",
    [eq("id", row.id), { col: "consumed_at", op: "is_null" }],
    { consumed_at: new Date().toISOString() },
  );
  if (!claimed)
    throw new BambooError(
      "This connection request was already used. Start Connect again.",
      "state_invalid",
    );
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------
type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  refresh_token?: string;
  id_token?: string;
  companyDomain?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  cfg: BambooConfig,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const url = `https://${cfg.companyDomain}.bamboohr.com/token.php?request=token`;
  const full = {
    ...body,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
  };
  // The OAuth guide shows a JSON body; the OpenID Connect page shows form encoding. Try JSON first.
  let res = await bambooFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(full),
  });
  if (res.status === 400 || res.status === 415) {
    const retry = await bambooFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(full).toString(),
    });
    if (retry.ok || retry.status !== 400) res = retry;
  }
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    const reason = json.error_description || json.error || `HTTP ${res.status}`;
    if (res.status === 400 || res.status === 401)
      throw new BambooError(
        `BambooHR refused the authorization (${reason.slice(0, 120)}).`,
        "reauthorize",
      );
    throw new BambooError(
      `BambooHR's token service is unavailable (${reason.slice(0, 120)}). Try again shortly.`,
      "temporary",
      true,
    );
  }
  return json;
}

async function userInfo(
  cfg: BambooConfig,
  accessToken: string,
): Promise<{ sub: string | null; email: string | null; companyId: string | null }> {
  try {
    const res = await bambooFetch(
      `https://${cfg.companyDomain}.bamboohr.com/token.php?request=userInfo`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      },
    );
    if (!res.ok) return { sub: null, email: null, companyId: null };
    const j = (await res.json()) as {
      sub?: string | number;
      email?: string;
      company_id?: string | number;
    };
    return {
      sub: j.sub != null ? String(j.sub) : null,
      email: j.email ?? null,
      companyId: j.company_id != null ? String(j.company_id) : null,
    };
  } catch {
    return { sub: null, email: null, companyId: null };
  }
}

/** OAuth callback: verify state, exchange the code, verify the company, store encrypted tokens. */
export async function completeAuthorization(input: {
  code: string;
  state: string;
  userId: string;
  actorLabel: string;
}): Promise<ConnectionRow> {
  const cfg = bambooConfig();
  if (!cfg) throw new BambooError("BambooHR isn't configured.", "not_configured");
  await consumeState(input.state, input.userId);
  const tokens = await tokenRequest(cfg, { grant_type: "authorization_code", code: input.code });
  if (tokens.companyDomain && tokens.companyDomain.toLowerCase() !== cfg.companyDomain) {
    throw new BambooError(
      `You authorized "${tokens.companyDomain}", but Baxter is configured for "${cfg.companyDomain}". Nothing was saved.`,
      "wrong_company",
    );
  }
  const granted = (tokens.scope ?? "").split(/[\s+]+/).filter(Boolean);
  const who = await userInfo(cfg, tokens.access_token!);
  const existing = await getConnection();
  const requested = existing?.requested_scopes?.length
    ? existing.requested_scopes
    : (pendingScopes.get(input.userId) ?? scopesFor([]));
  pendingScopes.delete(input.userId);
  const patch = {
    company_domain: cfg.companyDomain,
    company_id: who.companyId ?? existing?.company_id ?? null,
    connected_email: who.email,
    connected_sub: who.sub,
    requested_scopes: requested,
    granted_scopes: granted,
    encrypted_access_token: encryptSecret(tokens.access_token!),
    // Keep the previous refresh token if BambooHR didn't send a new one on re-consent.
    encrypted_refresh_token: tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : (existing?.encrypted_refresh_token ?? null),
    access_token_expires_at: new Date(
      Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ).toISOString(),
    status: "connected",
    last_refresh_at: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
    last_error:
      tokens.refresh_token || existing?.encrypted_refresh_token
        ? null
        : "No refresh token was issued (offline_access not granted). The connection will need to be renewed when the access token expires.",
    last_error_at: null,
    connected_by: input.userId,
    capabilities: {},
    capabilities_checked_at: null,
  };
  const [row] = existing
    ? await agentDb().update<ConnectionRow>("bamboohr_connections", [eq("id", existing.id)], patch)
    : await agentDb().insert<ConnectionRow>("bamboohr_connections", patch);
  await recordAudit({
    actor: { userId: input.userId, label: input.actorLabel },
    action: "bamboohr.connected",
    targetType: "ops_integration",
    targetId: null,
    summary: `Connected BambooHR (${cfg.companyDomain}) with ${granted.length} scope(s).`,
    details: {
      grantedScopes: granted,
      missingScopes: missingScopes(requested, granted),
      refreshToken: Boolean(patch.encrypted_refresh_token),
    },
  });
  return row!;
}

// ---------------------------------------------------------------------------
// Access tokens (refresh with a lock so concurrent requests don't race)
// ---------------------------------------------------------------------------
async function markError(row: ConnectionRow, message: string, reauthorize: boolean) {
  await agentDb().update("bamboohr_connections", [eq("id", row.id)], {
    status: reauthorize
      ? "reauthorization_required"
      : row.status === "disconnected"
        ? "disconnected"
        : "error",
    last_error: message.slice(0, 500),
    last_error_at: new Date().toISOString(),
    refresh_lock_until: null,
  });
}

export async function refreshAccessToken(row: ConnectionRow, force = false): Promise<string> {
  const cfg = bambooConfig();
  if (!cfg) throw new BambooError("BambooHR isn't configured.", "not_configured");
  if (!row.encrypted_refresh_token) {
    await markError(
      row,
      "The access token expired and no refresh token is stored. Reconnect BambooHR.",
      true,
    );
    throw new BambooError("Your BambooHR connection needs to be reauthorized.", "reauthorize");
  }
  // Claim the refresh lock only if nobody holds it (or theirs expired).
  const lock = { refresh_lock_until: new Date(Date.now() + 30_000).toISOString() };
  let [locked] = await agentDb().update<ConnectionRow>(
    "bamboohr_connections",
    [eq("id", row.id), { col: "refresh_lock_until", op: "is_null" }],
    lock,
  );
  if (!locked)
    [locked] = await agentDb().update<ConnectionRow>(
      "bamboohr_connections",
      [eq("id", row.id), { col: "refresh_lock_until", op: "lt", value: new Date().toISOString() }],
      lock,
    );
  if (!locked && force)
    [locked] = await agentDb().update<ConnectionRow>(
      "bamboohr_connections",
      [eq("id", row.id)],
      lock,
    );
  if (!locked) {
    // Someone else is refreshing; wait briefly and use their token.
    await new Promise((r) => setTimeout(r, 1500));
    const fresh = await getConnection();
    if (
      fresh?.encrypted_access_token &&
      fresh.access_token_expires_at &&
      Date.parse(fresh.access_token_expires_at) > Date.now() + 60_000
    )
      return decryptSecret(fresh.encrypted_access_token);
    throw new BambooError(
      "BambooHR is refreshing its connection. Try again in a moment.",
      "temporary",
      true,
    );
  }
  try {
    const tokens = await tokenRequest(cfg, {
      grant_type: "refresh_token",
      refresh_token: decryptSecret(row.encrypted_refresh_token),
    });
    await agentDb().update("bamboohr_connections", [eq("id", row.id)], {
      encrypted_access_token: encryptSecret(tokens.access_token!),
      encrypted_refresh_token: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : row.encrypted_refresh_token,
      access_token_expires_at: new Date(
        Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ).toISOString(),
      granted_scopes: tokens.scope
        ? tokens.scope.split(/[\s+]+/).filter(Boolean)
        : row.granted_scopes,
      status: "connected",
      last_refresh_at: new Date().toISOString(),
      refresh_lock_until: null,
      last_error: null,
    });
    return tokens.access_token!;
  } catch (error) {
    const reauth = error instanceof BambooError && error.reason === "reauthorize";
    await markError(
      row,
      reauth
        ? "BambooHR rejected the refresh token. Reconnect BambooHR."
        : error instanceof Error
          ? error.message
          : "Token refresh failed.",
      reauth,
    );
    throw reauth
      ? new BambooError("Your BambooHR connection needs to be reauthorized.", "reauthorize")
      : error;
  }
}

/** A valid access token, refreshing if it expires within a minute. */
export async function accessToken(): Promise<{ token: string; row: ConnectionRow }> {
  const row = await getConnection();
  if (!row || row.status === "disconnected")
    throw new BambooError("BambooHR isn't connected.", "not_connected");
  if (row.status === "reauthorization_required")
    throw new BambooError("Your BambooHR connection needs to be reauthorized.", "reauthorize");
  if (
    row.encrypted_access_token &&
    row.access_token_expires_at &&
    Date.parse(row.access_token_expires_at) > Date.now() + 60_000
  ) {
    return { token: decryptSecret(row.encrypted_access_token), row };
  }
  return { token: await refreshAccessToken(row), row };
}

export async function recordSuccess(row: ConnectionRow) {
  // Throttle writes: at most once a minute.
  if (
    row.last_success_at &&
    Date.now() - Date.parse(row.last_success_at) < 60_000 &&
    row.status === "connected"
  )
    return;
  await agentDb().update("bamboohr_connections", [eq("id", row.id)], {
    last_success_at: new Date().toISOString(),
    status: "connected",
  });
}
export async function recordFailure(row: ConnectionRow, message: string, reauthorize = false) {
  await markError(row, message, reauthorize);
}

/** Disconnect: forget tokens locally. (BambooHR documents no revocation endpoint; also remove the app in BambooHR if needed.) */
export async function disconnect(input: { userId: string; actorLabel: string }) {
  const row = await getConnection();
  if (!row) return;
  await agentDb().update("bamboohr_connections", [eq("id", row.id)], {
    encrypted_access_token: null,
    encrypted_refresh_token: null,
    access_token_expires_at: null,
    status: "disconnected",
    capabilities: {},
    capabilities_checked_at: null,
  });
  await recordAudit({
    actor: { userId: input.userId, label: input.actorLabel },
    action: "bamboohr.disconnected",
    targetType: "ops_integration",
    targetId: null,
    summary: `Disconnected BambooHR (${row.company_domain}); stored tokens deleted.`,
  });
}

/** Called by the background sweep: keep the refresh token exercised so nobody has to reconnect. */
export async function keepAlive(): Promise<"skipped" | "refreshed" | "failed"> {
  const row = await getConnection();
  if (!row || row.status !== "connected" || !row.encrypted_refresh_token) return "skipped";
  if (row.last_refresh_at && Date.now() - Date.parse(row.last_refresh_at) < 20 * 3600_000)
    return "skipped";
  try {
    await refreshAccessToken(row);
    return "refreshed";
  } catch {
    return "failed";
  }
}
