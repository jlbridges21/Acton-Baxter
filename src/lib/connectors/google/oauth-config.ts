import "server-only";

import { getEnv } from "@/lib/env";
import { GOOGLE_OAUTH_SCOPES, type GoogleAuthMode } from "./credentials/types";
import { isGoogleTokenEncryptionConfigured } from "@/lib/security/secret-box";

export type GoogleOAuthEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedDomains: string[];
  allowedEmails: string[];
};

function splitList(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function getGoogleAuthMode(): GoogleAuthMode {
  try {
    const mode = (process.env.GOOGLE_AUTH_MODE ?? getEnv().GOOGLE_AUTH_MODE ?? "workspace_oauth")
      .trim()
      .toLowerCase();
    if (
      mode === "workspace_oauth" ||
      mode === "service_account" ||
      mode === "domain_wide_delegation" ||
      mode === "disconnected"
    ) {
      return mode;
    }
    return "workspace_oauth";
  } catch {
    const mode = (process.env.GOOGLE_AUTH_MODE ?? "workspace_oauth").trim().toLowerCase();
    if (
      mode === "workspace_oauth" ||
      mode === "service_account" ||
      mode === "domain_wide_delegation" ||
      mode === "disconnected"
    ) {
      return mode as GoogleAuthMode;
    }
    return "workspace_oauth";
  }
}

export function getGoogleOAuthEnv(): GoogleOAuthEnv | null {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  const redirectUri = (process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "").trim() || defaultRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    clientId,
    clientSecret,
    redirectUri,
    allowedDomains: splitList(process.env.GOOGLE_OAUTH_ALLOWED_DOMAINS) || ["actonadu.com"],
    allowedEmails: splitList(process.env.GOOGLE_OAUTH_ALLOWED_EMAILS),
  };
}

function defaultRedirectUri(): string {
  const base =
    (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") ||
    "https://acton-baxter.vercel.app";
  return `${base}/api/admin/connectors/google/oauth/callback`;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(getGoogleOAuthEnv()) && isGoogleTokenEncryptionConfigured();
}

export function googleOAuthAuthorizationUrl(state: string, promptConsent = false): string {
  const oauth = getGoogleOAuthEnv();
  if (!oauth) {
    throw new Error("Google OAuth is not configured");
  }
  const params = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    state,
  });
  if (promptConsent) params.set("prompt", "consent");
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function isGoogleAccountAllowed(input: {
  email: string;
  hostedDomain?: string | null;
}): { ok: true } | { ok: false; code: string; message: string } {
  const oauth = getGoogleOAuthEnv();
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return {
      ok: false,
      code: "BAXTER_GOOGLE_ACCOUNT_NOT_ALLOWED",
      message: "Google did not return a usable email address.",
    };
  }
  const domain = email.split("@")[1] ?? "";
  const hd = (input.hostedDomain ?? "").trim().toLowerCase();

  // Reject consumer Gmail / Googlemail unless explicitly allowlisted by email.
  const consumer = domain === "gmail.com" || domain === "googlemail.com";
  const allowEmails = oauth?.allowedEmails ?? [];
  const allowDomains = oauth?.allowedDomains?.length ? oauth.allowedDomains : ["actonadu.com"];

  if (allowEmails.length > 0 && allowEmails.includes(email)) {
    return { ok: true };
  }

  if (consumer) {
    return {
      ok: false,
      code: "BAXTER_GOOGLE_ACCOUNT_NOT_ALLOWED",
      message:
        "Personal Gmail accounts cannot connect Baxter. Sign in as an Acton ADU Workspace user (for example baxter@actonadu.com).",
    };
  }

  if (!allowDomains.includes(domain) && !(hd && allowDomains.includes(hd))) {
    return {
      ok: false,
      code: "BAXTER_GOOGLE_ACCOUNT_NOT_ALLOWED",
      message: `Only Acton Workspace accounts (${allowDomains.join(", ")}) may connect. Connected: ${email}.`,
    };
  }

  if (allowEmails.length > 0 && !allowEmails.includes(email)) {
    return {
      ok: false,
      code: "BAXTER_GOOGLE_ACCOUNT_NOT_ALLOWED",
      message: `This rollout only allows: ${allowEmails.join(", ")}. Connected: ${email}.`,
    };
  }

  return { ok: true };
}

export function requiredScopesGranted(granted: string[]): boolean {
  const set = new Set(granted.map((s) => s.trim()));
  const required = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/documents.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ];
  return required.every((scope) => set.has(scope));
}
