export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
] as const;

export const GOOGLE_OAUTH_SCOPE_REASONS: Record<string, string> = {
  openid: "Identify the Google account securely.",
  email: "Verify the connected account is an allowed Acton address.",
  profile: "Display the connected account name in admin UI.",
  "https://www.googleapis.com/auth/drive.readonly":
    "Browse Shared Drives/folders and export/download files read-only.",
  "https://www.googleapis.com/auth/documents.readonly":
    "Export Google Docs text for Knowledge Base sync.",
  "https://www.googleapis.com/auth/spreadsheets.readonly":
    "Read Google Sheets values for Knowledge Base sync.",
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
