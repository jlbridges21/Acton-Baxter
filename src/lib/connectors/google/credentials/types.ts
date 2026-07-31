import "server-only";

/**
 * Google OAuth / DWD scopes for Baxter.
 * Full Drive + Sheets enable project-setup writes; Docs stay read-only.
 * A connection granted full scopes also satisfies read features.
 */

export const GOOGLE_DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export const GOOGLE_DOCS_READONLY_SCOPE = "https://www.googleapis.com/auth/documents.readonly";
export const GOOGLE_SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** Scopes requested on connect / reconnect / DWD / service-account JWT. */
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_DOCS_READONLY_SCOPE,
  GOOGLE_SHEETS_SCOPE,
] as const;

/** Drive/Sheets scopes used for domain-wide + service-account JWT claims. */
export const GOOGLE_API_SCOPES = [
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_DOCS_READONLY_SCOPE,
  GOOGLE_SHEETS_SCOPE,
] as const;

export const GOOGLE_OAUTH_SCOPE_REASONS: Record<string, string> = {
  openid: "Identify the Google account securely.",
  email: "Verify the connected account is an allowed Acton address.",
  profile: "Display the connected account name in admin UI.",
  [GOOGLE_DRIVE_SCOPE]:
    "Browse Shared Drives/folders, export files for Knowledge sync, and create project folders/files.",
  [GOOGLE_DOCS_READONLY_SCOPE]: "Export Google Docs text for Knowledge Base sync.",
  [GOOGLE_SHEETS_SCOPE]:
    "Read Google Sheets for Knowledge sync and append Master Project Log rows for new projects.",
  // Legacy labels (still shown if an older connection lists them)
  [GOOGLE_DRIVE_READONLY_SCOPE]:
    "Browse Shared Drives/folders and export/download files read-only.",
  [GOOGLE_SHEETS_READONLY_SCOPE]: "Read Google Sheets values for Knowledge Base sync.",
};

export type GoogleAuthMode =
  "workspace_oauth" | "service_account" | "domain_wide_delegation" | "disconnected";

export type GoogleConnectorIdentity = {
  mode: GoogleAuthMode;
  email: string | null;
  subject: string | null;
  hostedDomain: string | null;
};

export type GoogleCredentialHealth = {
  ok: boolean;
  mode: GoogleAuthMode;
  code: string | null;
  message: string;
  email: string | null;
};

export interface GoogleCredentialProvider {
  mode: Exclude<GoogleAuthMode, "disconnected">;
  getAccessToken(): Promise<string>;
  getIdentity(): Promise<GoogleConnectorIdentity>;
  health(): Promise<GoogleCredentialHealth>;
}

function normalizeScopeSet(granted: string[]): Set<string> {
  return new Set(granted.map((s) => s.trim()).filter(Boolean));
}

/** Drive read is satisfied by drive.readonly OR full drive. */
export function hasDriveReadScope(granted: string[]): boolean {
  const set = normalizeScopeSet(granted);
  return set.has(GOOGLE_DRIVE_SCOPE) || set.has(GOOGLE_DRIVE_READONLY_SCOPE);
}

/** Sheets read is satisfied by spreadsheets.readonly OR full spreadsheets. */
export function hasSheetsReadScope(granted: string[]): boolean {
  const set = normalizeScopeSet(granted);
  return set.has(GOOGLE_SHEETS_SCOPE) || set.has(GOOGLE_SHEETS_READONLY_SCOPE);
}

export function hasDocsReadScope(granted: string[]): boolean {
  return normalizeScopeSet(granted).has(GOOGLE_DOCS_READONLY_SCOPE);
}

export function hasDriveWriteScope(granted: string[]): boolean {
  return normalizeScopeSet(granted).has(GOOGLE_DRIVE_SCOPE);
}

export function hasSheetsWriteScope(granted: string[]): boolean {
  return normalizeScopeSet(granted).has(GOOGLE_SHEETS_SCOPE);
}

/** Both write scopes required for project-setup Google mutation steps. */
export function hasGoogleWriteScopes(granted: string[]): boolean {
  return hasDriveWriteScope(granted) && hasSheetsWriteScope(granted);
}

/**
 * True when the connection can power existing read features.
 * Full write scopes count as satisfying the corresponding read requirements.
 */
export function requiredScopesGranted(granted: string[]): boolean {
  return hasDriveReadScope(granted) && hasDocsReadScope(granted) && hasSheetsReadScope(granted);
}

export type GoogleAccessMode = "read_only" | "read_write" | "unknown";

export function resolveGoogleAccessMode(granted: string[]): GoogleAccessMode {
  if (!granted.length) return "unknown";
  if (hasGoogleWriteScopes(granted)) return "read_write";
  if (requiredScopesGranted(granted)) return "read_only";
  return "unknown";
}
