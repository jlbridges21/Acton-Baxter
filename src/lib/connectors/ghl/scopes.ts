/**
 * Planned GoHighLevel scopes for Baxter (Prompt 1).
 * Write scopes may be granted now but are NOT exposed to Baxter conversations yet.
 */

export const EXPECTED_GHL_SCOPES = [
  "businesses.readonly",
  "calendars.readonly",
  "calendars/events.readonly",
  "calendars/groups.readonly",
  "conversations.readonly",
  "conversations/message.readonly",
  "contacts.readonly",
  "contacts.write",
  "locations/customFields.readonly",
  "locations/customFields.write",
  "locations/tags.readonly",
  "opportunities.readonly",
  "opportunities.write",
  "pipelines.readonly",
  "users.readonly",
  "phonenumbers.read",
  "documents_contracts/list.readonly",
  "voice-ai-dashboard.readonly",
  "voice-ai-agents.readonly",
  "knowledge-bases.readonly",
] as const;

export type GhlScope = (typeof EXPECTED_GHL_SCOPES)[number];

export const GHL_SCOPE_REASONS: Record<string, string> = {
  "businesses.readonly": "Read business/company profiles related to the location.",
  "calendars.readonly": "List calendars.",
  "calendars/events.readonly": "Read calendar events/appointments.",
  "calendars/groups.readonly": "Read calendar groups.",
  "conversations.readonly": "List conversations.",
  "conversations/message.readonly": "Read conversation messages.",
  "contacts.readonly": "Read contacts for CRM lookup and Baxter context.",
  "contacts.write": "Update contacts (Prompt 2 — not enabled in Prompt 1).",
  "locations/customFields.readonly": "Map custom field IDs to names.",
  "locations/customFields.write": "Manage custom fields (Prompt 2 — not enabled).",
  "locations/tags.readonly": "Map tag IDs to names.",
  "opportunities.readonly": "Read opportunities/pipeline deals.",
  "opportunities.write": "Update opportunities (Prompt 2 — not enabled).",
  "pipelines.readonly": "Read pipelines and stages.",
  "users.readonly": "Resolve assigned users / owners.",
  "phonenumbers.read": "Read phone numbers configured on the location.",
  "documents_contracts/list.readonly": "List documents/contracts metadata.",
  "voice-ai-dashboard.readonly": "Read Voice AI dashboard data.",
  "voice-ai-agents.readonly": "List Voice AI agents.",
  "knowledge-bases.readonly": "List HighLevel knowledge-base assets (separate from Baxter KB).",
};

/** Scopes required for core Prompt 1 read health. */
export const REQUIRED_READ_SCOPES: string[] = [
  "contacts.readonly",
  "opportunities.readonly",
  "pipelines.readonly",
  "users.readonly",
];

/** Write scopes — granted for future Prompt 2, never claimed as live capabilities in Prompt 1. */
export const WRITE_SCOPES: string[] = [
  "contacts.write",
  "opportunities.write",
  "locations/customFields.write",
];

export const OPTIONAL_READ_SCOPES: string[] = [
  "businesses.readonly",
  "calendars.readonly",
  "calendars/events.readonly",
  "calendars/groups.readonly",
  "conversations.readonly",
  "conversations/message.readonly",
  "locations/customFields.readonly",
  "locations/tags.readonly",
  "phonenumbers.read",
  "documents_contracts/list.readonly",
  "voice-ai-dashboard.readonly",
  "voice-ai-agents.readonly",
  "knowledge-bases.readonly",
];

export function getExpectedScopesFromEnv(): string[] {
  const raw = (process.env.GHL_EXPECTED_SCOPES ?? "").trim();
  if (!raw) return [...EXPECTED_GHL_SCOPES];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeScopeList(scopes: string[] | null | undefined): string[] {
  return Array.from(new Set((scopes ?? []).map((s) => s.trim()).filter(Boolean)));
}

export function getMissingRequiredScopes(granted: string[]): string[] {
  const set = new Set(normalizeScopeList(granted));
  return REQUIRED_READ_SCOPES.filter((s) => !set.has(s));
}

export function getMissingOptionalScopes(granted: string[]): string[] {
  const set = new Set(normalizeScopeList(granted));
  return OPTIONAL_READ_SCOPES.filter((s) => !set.has(s));
}

export function getMissingWriteScopes(granted: string[]): string[] {
  const set = new Set(normalizeScopeList(granted));
  return WRITE_SCOPES.filter((s) => !set.has(s));
}

export function hasRequiredScopes(granted: string[]): boolean {
  return getMissingRequiredScopes(granted).length === 0;
}

export function summarizeScopeStatus(granted: string[]) {
  const normalized = normalizeScopeList(granted);
  const set = new Set(normalized);
  return {
    granted: normalized,
    required: REQUIRED_READ_SCOPES.map((scope) => ({
      scope,
      status: set.has(scope) ? ("granted" as const) : ("missing" as const),
      reason: GHL_SCOPE_REASONS[scope] ?? "",
    })),
    optional: OPTIONAL_READ_SCOPES.map((scope) => ({
      scope,
      status: set.has(scope) ? ("granted" as const) : ("missing" as const),
      reason: GHL_SCOPE_REASONS[scope] ?? "",
    })),
    writePrepared: WRITE_SCOPES.map((scope) => ({
      scope,
      status: set.has(scope) ? ("granted" as const) : ("missing" as const),
      reason: GHL_SCOPE_REASONS[scope] ?? "",
      note: "Write scopes may be granted but Baxter cannot mutate GHL in Prompt 1.",
    })),
  };
}
