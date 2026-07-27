/**
 * Centralized HighLevel API Version header registry.
 *
 * Official marketplace docs (2026) use Version: v3 for CRM resource families.
 * Do not hardcode Version on every call — resolve via resource family.
 *
 * @see https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity
 */

export type GhlApiResource =
  | "contacts"
  | "opportunities"
  | "pipelines"
  | "calendars"
  | "calendarEvents"
  | "conversations"
  | "messages"
  | "users"
  | "locations"
  | "customFields"
  | "tags"
  | "phoneNumbers"
  | "documents"
  | "voiceAi"
  | "knowledgeBases"
  | "businesses"
  | "default";

/** Default when resource is unknown — prefer current marketplace default. */
export const GHL_DEFAULT_API_VERSION = "v3";

/**
 * Legacy date-style version previously used across Baxter.
 * Kept only for explicit overrides / diagnostics — not the default.
 */
export const GHL_LEGACY_API_VERSION = "2021-07-28";

export const GHL_API_VERSIONS: Record<GhlApiResource, string> = {
  contacts: "v3",
  opportunities: "v3",
  pipelines: "v3",
  calendars: "v3",
  calendarEvents: "v3",
  conversations: "v3",
  messages: "v3",
  users: "v3",
  locations: "v3",
  customFields: "v3",
  tags: "v3",
  phoneNumbers: "v3",
  documents: "v3",
  voiceAi: "v3",
  knowledgeBases: "v3",
  businesses: "v3",
  default: GHL_DEFAULT_API_VERSION,
};

export function resolveGhlApiVersion(resource?: GhlApiResource | null): string {
  if (!resource) return GHL_DEFAULT_API_VERSION;
  return GHL_API_VERSIONS[resource] ?? GHL_DEFAULT_API_VERSION;
}

/**
 * Infer resource family from a path for version resolution.
 */
export function inferGhlResourceFromPath(path: string): GhlApiResource {
  const p = path.toLowerCase();
  if (p.includes("/opportunities/pipelines") || p.endsWith("/pipelines")) return "pipelines";
  if (p.includes("/opportunities")) return "opportunities";
  if (p.includes("/contacts")) return "contacts";
  if (p.includes("/calendars/events")) return "calendarEvents";
  if (p.includes("/calendars")) return "calendars";
  if (p.includes("/conversations") && p.includes("/messages")) return "messages";
  if (p.includes("/conversations")) return "conversations";
  if (p.includes("/users")) return "users";
  if (p.includes("/customfields") || p.includes("/custom-fields")) return "customFields";
  if (p.includes("/tags")) return "tags";
  if (p.includes("/phone")) return "phoneNumbers";
  if (p.includes("/documents") || p.includes("/contracts")) return "documents";
  if (p.includes("/voice")) return "voiceAi";
  if (p.includes("/knowledge")) return "knowledgeBases";
  if (p.includes("/businesses")) return "businesses";
  if (p.includes("/locations")) return "locations";
  return "default";
}
