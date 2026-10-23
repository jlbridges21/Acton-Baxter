/**
 * Integration adapters for Sam Operations. Each adapter reports an honest status and
 * executes only approved actions (called from actions.ts after the approval re-check).
 *
 * Verified capabilities (2026-10-22):
 *   BambooHR   REST: GET /api/v1/meta/fields, GET/POST /api/v1/employees/{id} (Basic auth with an
 *              API key). No public API found for Employee Satisfaction (eNPS) surveys → manual.
 *   DocuSign   eSignature REST v2.1 with JWT grant (integration key + user + RSA key, one-time consent).
 *   Google     The existing Baxter connection grants Drive + Sheets. Gmail send and Calendar need
 *              additional scopes (gmail.send, calendar) before those actions can run.
 *   Betterteam No public developer API found → publication is a tracked manual step.
 *   JobTread   Read-only; organization.timeEntries is empty for Acton → timecards are manual.
 *   Slack      Existing bot; DMs go to people whose Slack account is mapped to their Baxter account.
 *
 * Credentials live only in environment variables; nothing secret is stored in the database
 * or returned to the browser.
 */

import "server-only";

import { createSign } from "node:crypto";
import { agentDb, eq, selectOne, usesAgentMemoryStore } from "@/lib/agents/store";
import { getEnv } from "@/lib/env";

export type IntegrationKey =
  | "bamboohr"
  | "google_drive"
  | "gmail"
  | "google_calendar"
  | "docusign"
  | "betterteam"
  | "jobtread"
  | "slack";

export type IntegrationState =
  | "connected"
  | "configured_untested"
  | "missing_credentials"
  | "missing_permission"
  | "unsupported"
  | "error";

export const STATE_LABELS: Record<IntegrationState, string> = {
  connected: "Connected and verified",
  configured_untested: "Configured, not yet tested",
  missing_credentials: "Missing credentials",
  missing_permission: "Needs additional permission",
  unsupported: "No supported API — manual workflow",
  error: "Error",
};

export type IntegrationStatus = {
  key: IntegrationKey;
  label: string;
  state: IntegrationState;
  detail: string;
  nextStep: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
  capabilities: string[];
};

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Thrown when an action can't run automatically; the person gets instructions instead. */
export class ManualRequired extends Error {
  constructor(readonly instructions: string) {
    super(instructions);
  }
}

type SettingsRow = {
  key: string;
  config: Record<string, unknown>;
  last_tested_at: string | null;
  last_status: string | null;
  last_error: string | null;
};

export async function getIntegrationSettings(key: IntegrationKey): Promise<SettingsRow> {
  return (
    (await selectOne<SettingsRow>("ops_integration_settings", { filters: [eq("key", key)] })) ?? {
      key,
      config: {},
      last_tested_at: null,
      last_status: null,
      last_error: null,
    }
  );
}

export async function saveIntegrationSettings(
  key: IntegrationKey,
  patch: Partial<Omit<SettingsRow, "key">>,
  userId: string | null,
) {
  const current = await getIntegrationSettings(key);
  await agentDb().upsert(
    "ops_integration_settings",
    { ...current, ...patch, key, updated_by: userId, updated_at: new Date().toISOString() },
    ["key"],
  );
}

const env = (name: string) => (process.env[name] ?? "").trim();

// ---------------------------------------------------------------------------
// HTTP seam (tests replace it)
// ---------------------------------------------------------------------------
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, { ...init, cache: "no-store" });
export function setOpsFetcherForTests(f: Fetcher | null) {
  fetcher = f ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }));
}

async function call(url: string, init: RequestInit, label: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new IntegrationError(
      `${label} is unreachable (${error instanceof Error ? error.message : "network error"}).`,
      true,
    );
  }
  if (res.ok) return res;
  const text = (await res.text().catch(() => "")).slice(0, 300);
  if (res.status === 401 || res.status === 403)
    throw new IntegrationError(
      `${label} rejected the credentials or permission (${res.status}).`,
      false,
    );
  if (res.status === 429 || res.status >= 500)
    throw new IntegrationError(
      `${label} is temporarily unavailable (${res.status}). Retry later.`,
      true,
    );
  throw new IntegrationError(`${label} refused the request (${res.status}): ${text}`, false);
}

// ---------------------------------------------------------------------------
// BambooHR
// ---------------------------------------------------------------------------

/** Never writable through Sam, regardless of configuration (pay, identity, lifecycle). */
export const BAMBOOHR_BLOCKED_FIELDS =
  /(pay|salary|wage|compensation|bonus|commission|ssn|socialinsurance|taxid|tax|bank|routing|account|dateofbirth|birth|gender|ethnicity|employmenttype|terminationdate|status|password)/i;

function bamboo() {
  const subdomain = env("BAMBOOHR_SUBDOMAIN");
  const key = env("BAMBOOHR_API_KEY");
  if (!subdomain || !key) return null;
  return {
    base: `https://${subdomain}.bamboohr.com/api/v1`,
    auth: `Basic ${Buffer.from(`${key}:x`).toString("base64")}`,
  };
}

export async function bambooListFields(): Promise<
  Array<{ id: string; name: string; type: string; alias?: string }>
> {
  const b = bamboo();
  if (!b)
    throw new ManualRequired(
      "BambooHR isn't connected (BAMBOOHR_SUBDOMAIN and BAMBOOHR_API_KEY). Make the change in BambooHR by hand.",
    );
  const res = await call(
    `${b.base}/meta/fields`,
    { headers: { Authorization: b.auth, Accept: "application/json" } },
    "BambooHR",
  );
  const rows = (await res.json()) as Array<{
    id: string | number;
    name: string;
    type: string;
    alias?: string;
  }>;
  return rows.map((r) => ({ id: String(r.id), name: r.name, type: r.type, alias: r.alias }));
}

export async function bambooGetEmployee(
  employeeId: string,
  fields: string[],
): Promise<Record<string, unknown>> {
  const b = bamboo();
  if (!b) throw new ManualRequired("BambooHR isn't connected.");
  if (!/^\d{1,12}$/.test(employeeId))
    throw new IntegrationError("BambooHR employee ids are numeric.", false);
  const res = await call(
    `${b.base}/employees/${employeeId}?fields=${encodeURIComponent(fields.join(","))}`,
    { headers: { Authorization: b.auth, Accept: "application/json" } },
    "BambooHR",
  );
  return (await res.json()) as Record<string, unknown>;
}

/** Approved update + read-back verification. Fields must be on the admin allowlist. */
export async function bambooUpdateEmployee(
  employeeId: string,
  changes: Record<string, string>,
): Promise<{ verified: Record<string, unknown> }> {
  const b = bamboo();
  if (!b)
    throw new ManualRequired(
      `BambooHR isn't connected. Update employee ${employeeId} by hand: ${Object.entries(changes)
        .map(([k, v]) => `${k} = ${v}`)
        .join("; ")}.`,
    );
  const allowed = new Set(
    ((await getIntegrationSettings("bamboohr")).config.writableFields as string[] | undefined) ??
      [],
  );
  for (const field of Object.keys(changes)) {
    if (BAMBOOHR_BLOCKED_FIELDS.test(field) || !allowed.has(field))
      throw new IntegrationError(
        `"${field}" isn't an approved BambooHR field for Sam to update.`,
        false,
      );
  }
  await call(
    `${b.base}/employees/${employeeId}`,
    {
      method: "POST",
      headers: {
        Authorization: b.auth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(changes),
    },
    "BambooHR",
  );
  const verified = await bambooGetEmployee(employeeId, Object.keys(changes));
  const mismatch = Object.entries(changes).filter(([k, v]) => String(verified[k] ?? "") !== v);
  if (mismatch.length)
    throw new IntegrationError(
      `BambooHR accepted the update but read-back differs for ${mismatch.map(([k]) => k).join(", ")}.`,
      false,
    );
  return { verified };
}

// ---------------------------------------------------------------------------
// Google (Drive / Gmail / Calendar) via the existing Baxter connection
// ---------------------------------------------------------------------------
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

export async function googleScopes(): Promise<{ configured: boolean; scopes: string[] | null }> {
  // Sandbox/test mode has no Google connection table to query.
  if (usesAgentMemoryStore()) return { configured: false, scopes: null };
  try {
    const { isGoogleWorkspaceConfigured } = await import("@/lib/connectors/google/auth");
    if (!isGoogleWorkspaceConfigured()) return { configured: false, scopes: null };
    const { getActiveGoogleConnection } = await import("@/lib/connectors/google/connections");
    const conn = await getActiveGoogleConnection().catch(() => null);
    return { configured: true, scopes: conn ? conn.granted_scopes : null };
  } catch {
    return { configured: false, scopes: null };
  }
}

async function gFetch<T>(url: string, init: RequestInit): Promise<T> {
  const { mintAccessToken } = await import("@/lib/connectors/google/auth");
  const token = await mintAccessToken();
  const res = await call(
    url,
    { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } },
    "Google",
  );
  return (await res.json()) as T;
}

export async function driveUpload(input: {
  folderId: string;
  name: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ id: string; webViewLink?: string }> {
  const { configured } = await googleScopes();
  if (!configured)
    throw new ManualRequired(
      `Google Drive isn't connected. Upload "${input.name}" to the designated folder by hand.`,
    );
  if (!/^[A-Za-z0-9_-]{10,}$/.test(input.folderId))
    throw new IntegrationError(
      "The Drive folder isn't configured for this document type and entity.",
      false,
    );
  const boundary = `ops${Date.now()}`;
  const meta = JSON.stringify({ name: input.name, parents: [input.folderId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
    ),
    input.bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const file = await gFetch<{ id: string; webViewLink?: string; parents?: string[] }>(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink,parents",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    },
  );
  // Verify the resulting file reference landed in the approved folder.
  if (!file.parents?.includes(input.folderId))
    throw new IntegrationError("Drive created the file outside the approved folder.", false);
  return { id: file.id, webViewLink: file.webViewLink };
}

export async function gmailSend(input: {
  to: string;
  subject: string;
  body: string;
  from?: string;
}): Promise<{ id: string; threadId: string }> {
  const { configured, scopes } = await googleScopes();
  if (!configured || !scopes?.includes(GMAIL_SCOPE)) {
    throw new ManualRequired(
      `Gmail sending isn't enabled for Sam yet. Send this email yourself:\nTo: ${input.to}\nSubject: ${input.subject}\n\n${input.body}`,
    );
  }
  const raw = Buffer.from(
    [
      `To: ${input.to}`,
      ...(input.from ? [`From: ${input.from}`] : []),
      `Subject: ${input.subject.replace(/[\r\n]/g, " ")}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      input.body,
    ].join("\r\n"),
  ).toString("base64url");
  return gFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
}

export async function calendarFreeBusy(input: {
  calendars: string[];
  timeMin: string;
  timeMax: string;
  timeZone: string;
}): Promise<Record<string, Array<{ start: string; end: string }>>> {
  const { configured, scopes } = await googleScopes();
  if (!configured || !scopes?.some((s) => CALENDAR_SCOPES.includes(s)))
    throw new ManualRequired(
      "Calendar access isn't enabled for Sam yet, so availability can't be checked automatically.",
    );
  const data = await gFetch<{
    calendars: Record<string, { busy: Array<{ start: string; end: string }>; errors?: unknown[] }>;
  }>("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      timeZone: input.timeZone,
      items: input.calendars.map((id) => ({ id })),
    }),
  });
  for (const [id, c] of Object.entries(data.calendars))
    if (c.errors?.length)
      throw new IntegrationError(`Couldn't read the calendar for ${id}.`, false);
  return Object.fromEntries(Object.entries(data.calendars).map(([id, c]) => [id, c.busy]));
}

export async function calendarCreateEvent(input: {
  calendarId: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
  attendees: string[];
  requestId: string;
}): Promise<{ id: string; htmlLink?: string }> {
  const { configured, scopes } = await googleScopes();
  if (!configured || !scopes?.some((s) => CALENDAR_SCOPES.includes(s))) {
    throw new ManualRequired(
      `Calendar access isn't enabled for Sam yet. Create this invitation yourself: "${input.summary}" ${input.start} – ${input.end} (${input.timeZone}) with ${input.attendees.join(", ")}.`,
    );
  }
  // Re-check for conflicts right before creating (availability may have changed since approval).
  const busy = await calendarFreeBusy({
    calendars: [input.calendarId],
    timeMin: input.start,
    timeMax: input.end,
    timeZone: input.timeZone,
  });
  if ((busy[input.calendarId] ?? []).length)
    throw new IntegrationError(
      "The organizer's calendar is no longer free at that time. Propose a new time.",
      false,
    );
  return gFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Deterministic event id (base32hex) makes retries idempotent: Google rejects a duplicate id.
      body: JSON.stringify({
        id: Buffer.from(input.requestId)
          .toString("hex")
          .replace(/[^a-v0-9]/g, "")
          .slice(0, 60)
          .padEnd(5, "0"),
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start, timeZone: input.timeZone },
        end: { dateTime: input.end, timeZone: input.timeZone },
        attendees: input.attendees.map((email) => ({ email })),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// DocuSign (JWT grant)
// ---------------------------------------------------------------------------
function docusignConfig() {
  const integrationKey = env("DOCUSIGN_INTEGRATION_KEY");
  const userId = env("DOCUSIGN_USER_ID");
  const accountId = env("DOCUSIGN_ACCOUNT_ID");
  const privateKey = env("DOCUSIGN_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!integrationKey || !userId || !accountId || !privateKey) return null;
  const production = env("DOCUSIGN_ENVIRONMENT") === "production";
  return {
    integrationKey,
    userId,
    accountId,
    privateKey,
    authHost: production ? "account.docusign.com" : "account-d.docusign.com",
    baseUri: env("DOCUSIGN_BASE_URI") || (production ? "" : "https://demo.docusign.net"),
  };
}

async function docusignToken(cfg: NonNullable<ReturnType<typeof docusignConfig>>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: cfg.integrationKey, sub: cfg.userId, aud: cfg.authHost, iat: now, exp: now + 3600, scope: "signature impersonation" })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(cfg.privateKey)
    .toString("base64url");
  const res = await call(
    `https://${cfg.authHost}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }).toString(),
    },
    "DocuSign",
  ).catch((error: unknown) => {
    throw error instanceof IntegrationError && /rejected/.test(error.message)
      ? new IntegrationError(
          "DocuSign refused the login. Grant one-time consent for the integration key, then retry.",
          false,
        )
      : error;
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function docusignSend(input: {
  emailSubject: string;
  document: { name: string; base64: string; extension: string };
  signers: Array<{ name: string; email: string; routingOrder?: number }>;
  requestId: string;
}): Promise<{ envelopeId: string; status: string }> {
  const cfg = docusignConfig();
  if (!cfg || !cfg.baseUri)
    throw new ManualRequired(
      `DocuSign isn't connected. Send "${input.document.name}" for signature by hand to ${input.signers.map((s) => `${s.name} <${s.email}>`).join(", ")}.`,
    );
  const token = await docusignToken(cfg);
  const res = await call(
    `${cfg.baseUri}/restapi/v2.1/accounts/${cfg.accountId}/envelopes`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        emailSubject: input.emailSubject.slice(0, 100),
        documents: [
          {
            documentId: "1",
            name: input.document.name,
            fileExtension: input.document.extension,
            documentBase64: input.document.base64,
          },
        ],
        recipients: {
          signers: input.signers.map((s, i) => ({
            recipientId: String(i + 1),
            routingOrder: String(s.routingOrder ?? i + 1),
            name: s.name,
            email: s.email,
          })),
        },
        // Our idempotency key travels with the envelope so a retry can be reconciled.
        customFields: {
          textCustomFields: [{ name: "baxter_request_id", value: input.requestId, show: "false" }],
        },
        status: "sent",
      }),
    },
    "DocuSign",
  );
  const body = (await res.json()) as { envelopeId: string; status: string };
  return { envelopeId: body.envelopeId, status: body.status };
}

export async function docusignStatus(
  envelopeId: string,
): Promise<{ status: string; completedAt: string | null }> {
  const cfg = docusignConfig();
  if (!cfg || !cfg.baseUri) throw new ManualRequired("DocuSign isn't connected.");
  const token = await docusignToken(cfg);
  const res = await call(
    `${cfg.baseUri}/restapi/v2.1/accounts/${cfg.accountId}/envelopes/${encodeURIComponent(envelopeId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    "DocuSign",
  );
  const body = (await res.json()) as { status: string; completedDateTime?: string };
  return { status: body.status, completedAt: body.completedDateTime ?? null };
}

export async function docusignCompletedDocument(envelopeId: string): Promise<Buffer> {
  const cfg = docusignConfig();
  if (!cfg || !cfg.baseUri) throw new ManualRequired("DocuSign isn't connected.");
  const token = await docusignToken(cfg);
  const res = await call(
    `${cfg.baseUri}/restapi/v2.1/accounts/${cfg.accountId}/envelopes/${encodeURIComponent(envelopeId)}/documents/combined`,
    { headers: { Authorization: `Bearer ${token}` } },
    "DocuSign",
  );
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Slack (existing bot)
// ---------------------------------------------------------------------------
async function slackUserFor(profileId: string): Promise<string | null> {
  if (usesAgentMemoryStore()) return null;
  const { createServiceClient } = await import("@/lib/supabase/admin");
  const { data } = await createServiceClient()
    .from("slack_user_mappings")
    .select("slack_user_id")
    .eq("app_user_id", profileId)
    .limit(1)
    .maybeSingle();
  return (data?.slack_user_id as string | undefined) ?? null;
}

export async function slackDm(input: {
  profileId: string;
  text: string;
}): Promise<{ ts?: string }> {
  if (!getEnv().SLACK_BOT_TOKEN)
    throw new ManualRequired(`Slack isn't connected. Send this message yourself:\n${input.text}`);
  const slackUser = await slackUserFor(input.profileId);
  if (!slackUser)
    throw new ManualRequired(
      `This person's Slack account isn't linked to Baxter. Send this message yourself:\n${input.text}`,
    );
  const { openSlackDm } = await import("@/lib/slack/provisioning");
  const { postSlackMessage } = await import("@/lib/slack/client");
  const { channelId } = await openSlackDm(slackUser);
  return postSlackMessage({ channel: channelId, text: input.text.slice(0, 3500) });
}

// ---------------------------------------------------------------------------
// JobTread timecards (read-only)
// ---------------------------------------------------------------------------
export async function jobtreadTimeEntryCount(): Promise<number | null> {
  const { isJobTreadConfigured, pave, getJobTreadConfig } = await import("@/lib/jobtread/client");
  if (!isJobTreadConfigured()) return null;
  const res = await pave<{ organization: { timeEntries: { count: number } } }>({
    organization: { $: { id: getJobTreadConfig()!.organizationId }, timeEntries: { count: {} } },
  });
  return res.organization.timeEntries.count;
}

// ---------------------------------------------------------------------------
// Status & tests
// ---------------------------------------------------------------------------
export async function integrationStatuses(): Promise<IntegrationStatus[]> {
  const settings = new Map(
    (await agentDb().select<SettingsRow>("ops_integration_settings", {})).map((r) => [r.key, r]),
  );
  const s = (key: IntegrationKey) => settings.get(key);
  const tested = (key: IntegrationKey, base: IntegrationState): IntegrationState => {
    const row = s(key);
    if (base !== "configured_untested") return base;
    if (row?.last_status === "connected") return "connected";
    if (row?.last_status === "error") return "error";
    return base;
  };
  const g = await googleScopes();
  const ds = docusignConfig();
  const out: IntegrationStatus[] = [
    {
      key: "bamboohr",
      label: "BambooHR",
      state: tested("bamboohr", bamboo() ? "configured_untested" : "missing_credentials"),
      detail:
        "Employee record reads and approved field updates (read back to verify). Surveys: no public API found — tracked manually.",
      nextStep: bamboo()
        ? "Run a connection test, then choose the fields Sam may propose updates for."
        : "Add BAMBOOHR_SUBDOMAIN and BAMBOOHR_API_KEY (a dedicated integration user's key) in Vercel.",
      lastTestedAt: s("bamboohr")?.last_tested_at ?? null,
      lastError: s("bamboohr")?.last_error ?? null,
      capabilities: [
        "List fields",
        "Read employee",
        "Update allowlisted fields (approved)",
        "Surveys: manual",
      ],
    },
    {
      key: "google_drive",
      label: "Google Drive",
      state: tested("google_drive", g.configured ? "configured_untested" : "missing_credentials"),
      detail: "Filing approved documents into designated folders, verified after upload.",
      nextStep: g.configured
        ? "Set the designated folders per entity, then test."
        : "Connect Google Workspace in Admin → Connectors.",
      lastTestedAt: s("google_drive")?.last_tested_at ?? null,
      lastError: s("google_drive")?.last_error ?? null,
      capabilities: ["Upload to configured folder", "Verify file location"],
    },
    {
      key: "gmail",
      label: "Gmail",
      state: !g.configured
        ? "missing_credentials"
        : g.scopes?.includes(GMAIL_SCOPE)
          ? tested("gmail", "configured_untested")
          : "missing_permission",
      detail:
        "Sending approved emails from Sam's configured identity. Until enabled, approved emails become a 'send it yourself' task.",
      nextStep: g.scopes?.includes(GMAIL_SCOPE)
        ? null
        : "Reconnect Google with the gmail.send permission for Sam's mailbox.",
      lastTestedAt: s("gmail")?.last_tested_at ?? null,
      lastError: s("gmail")?.last_error ?? null,
      capabilities: ["Send approved email"],
    },
    {
      key: "google_calendar",
      label: "Google Calendar",
      state: !g.configured
        ? "missing_credentials"
        : g.scopes?.some((x) => CALENDAR_SCOPES.includes(x))
          ? tested("google_calendar", "configured_untested")
          : "missing_permission",
      detail:
        "Availability checks and approved interview invitations (conflicts re-checked before creating).",
      nextStep: g.scopes?.some((x) => CALENDAR_SCOPES.includes(x))
        ? null
        : "Reconnect Google with Calendar permission for the involved employees' calendars.",
      lastTestedAt: s("google_calendar")?.last_tested_at ?? null,
      lastError: s("google_calendar")?.last_error ?? null,
      capabilities: ["Free/busy", "Create approved event", "Reschedule/cancel (approved)"],
    },
    {
      key: "docusign",
      label: "DocuSign",
      state: tested("docusign", ds && ds.baseUri ? "configured_untested" : "missing_credentials"),
      detail:
        "Approved signature requests, status tracking, and completed-document retrieval. DocuSign MSP involvement still to be confirmed.",
      nextStep: ds
        ? "Grant one-time consent for the integration key, then test."
        : "Add DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_ACCOUNT_ID, DOCUSIGN_PRIVATE_KEY (and DOCUSIGN_BASE_URI for production).",
      lastTestedAt: s("docusign")?.last_tested_at ?? null,
      lastError: s("docusign")?.last_error ?? null,
      capabilities: ["Send envelope (approved)", "Status", "Download completed"],
    },
    {
      key: "betterteam",
      label: "BetterTeams",
      state: "unsupported",
      detail:
        "No public developer API was found. Sam prepares publication-ready listings; a person publishes and confirms the posting URL.",
      nextStep:
        "Ask BetterTeams whether a partner API exists; until then publication stays manual.",
      lastTestedAt: null,
      lastError: null,
      capabilities: ["Prepare listing", "Track manual publication"],
    },
    {
      key: "jobtread",
      label: "JobTread timecards",
      state:
        s("jobtread")?.last_status === "connected"
          ? "connected"
          : s("jobtread")?.last_status === "unsupported"
            ? "unsupported"
            : "configured_untested",
      detail:
        "Read-only check of time entries. Acton's JobTread had 0 time entries on 2026-10-22, so completeness can't be checked automatically yet.",
      nextStep:
        "Confirm whether crews will log time in JobTread and what 'complete' means for a week.",
      lastTestedAt: s("jobtread")?.last_tested_at ?? null,
      lastError: s("jobtread")?.last_error ?? null,
      capabilities: ["Count time entries", "Weekly check (manual until data exists)"],
    },
    {
      key: "slack",
      label: "Slack",
      state: getEnvSafe("SLACK_BOT_TOKEN")
        ? tested("slack", "configured_untested")
        : "missing_credentials",
      detail:
        "Approved DMs to people whose Slack account is linked to their Baxter account; CEO/COO talk to Sam through Baxter's Slack app.",
      nextStep: "Confirm the CEO's and COO's Slack accounts are linked (Admin → Slack).",
      lastTestedAt: s("slack")?.last_tested_at ?? null,
      lastError: s("slack")?.last_error ?? null,
      capabilities: ["Approved DMs", "Leadership routing via Baxter"],
    },
  ];
  return out;
}

function getEnvSafe(name: "SLACK_BOT_TOKEN"): string {
  try {
    return getEnv()[name] ?? "";
  } catch {
    return "";
  }
}

/** Read-only connectivity test; records the result. */
export async function testIntegration(
  key: IntegrationKey,
  userId: string | null,
): Promise<{ ok: boolean; message: string }> {
  let ok = false;
  let message = "";
  let status = "error";
  try {
    if (key === "bamboohr") {
      const fields = await bambooListFields();
      ok = true;
      message = `Connected — ${fields.length} fields available.`;
      await saveIntegrationSettings(
        "bamboohr",
        {
          config: {
            ...(await getIntegrationSettings("bamboohr")).config,
            availableFields: fields.map((f) => ({
              id: f.alias ?? f.id,
              name: f.name,
              type: f.type,
            })),
          },
        },
        userId,
      );
    } else if (key === "docusign") {
      const cfg = docusignConfig();
      if (!cfg) throw new ManualRequired("DocuSign credentials are missing.");
      await docusignToken(cfg);
      ok = true;
      message = "Connected — DocuSign accepted the integration's login.";
    } else if (key === "jobtread") {
      const count = await jobtreadTimeEntryCount();
      if (count === null) throw new ManualRequired("JobTread isn't connected.");
      ok = count > 0;
      status = count > 0 ? "connected" : "unsupported";
      message =
        count > 0
          ? `${count} time entries found.`
          : "JobTread has 0 time entries, so timecards stay manual.";
    } else if (key === "google_drive" || key === "gmail" || key === "google_calendar") {
      const g = await googleScopes();
      if (!g.configured) throw new ManualRequired("Google Workspace isn't connected.");
      await gFetch("https://www.googleapis.com/drive/v3/about?fields=user", { method: "GET" });
      ok =
        key === "google_drive" ||
        (key === "gmail"
          ? Boolean(g.scopes?.includes(GMAIL_SCOPE))
          : Boolean(g.scopes?.some((x) => CALENDAR_SCOPES.includes(x))));
      message = ok ? "Connected." : "Google is connected, but this permission hasn't been granted.";
    } else if (key === "slack") {
      ok = Boolean(getEnvSafe("SLACK_BOT_TOKEN"));
      message = ok ? "Slack bot token present." : "SLACK_BOT_TOKEN is missing.";
    } else {
      message = "No supported API to test.";
      status = "unsupported";
    }
    if (ok) status = "connected";
  } catch (error) {
    message = error instanceof Error ? error.message : "Test failed.";
  }
  await saveIntegrationSettings(
    key,
    {
      last_tested_at: new Date().toISOString(),
      last_status: status,
      last_error: ok ? null : message.slice(0, 300),
    },
    userId,
  );
  return { ok, message };
}
