import "server-only";

import { createSign } from "node:crypto";
import { getEnv } from "@/lib/env";
import { GoogleConfigError, GoogleConnectorError } from "./errors";

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

const globalToken = globalThis as typeof globalThis & {
  __baxterGoogleToken?: TokenCache;
};

/**
 * Normalize private keys pasted into Vercel env (literal \\n, quotes, CRLF).
 */
export function normalizePrivateKey(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  value = value.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
  return value;
}

export function isPrivateKeyFormatValid(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const normalized = normalizePrivateKey(raw);
  return (
    normalized.includes("-----BEGIN PRIVATE KEY-----") &&
    normalized.includes("-----END PRIVATE KEY-----")
  );
}

export function isGoogleWorkspaceConfigured(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY);
  } catch {
    return false;
  }
}

export function getGoogleCredentialStatus(): {
  configured: boolean;
  projectIdPresent: boolean;
  clientEmail: string | null;
  privateKeyFormatValid: boolean;
  rootFolderConfigured: boolean;
  rootFolderRaw: string | null;
} {
  try {
    const env = getEnv();
    return {
      configured: Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY),
      projectIdPresent: Boolean(env.GOOGLE_PROJECT_ID?.trim()),
      clientEmail: env.GOOGLE_CLIENT_EMAIL?.trim() || null,
      privateKeyFormatValid: isPrivateKeyFormatValid(env.GOOGLE_PRIVATE_KEY),
      rootFolderConfigured: Boolean(env.GOOGLE_DRIVE_ROOT_FOLDER?.trim()),
      rootFolderRaw: env.GOOGLE_DRIVE_ROOT_FOLDER?.trim() || null,
    };
  } catch {
    return {
      configured: false,
      projectIdPresent: false,
      clientEmail: null,
      privateKeyFormatValid: false,
      rootFolderConfigured: false,
      rootFolderRaw: null,
    };
  }
}

function base64Url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function mintAccessToken(): Promise<string> {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new GoogleConfigError(
      "Set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY for the Baxter service account.",
      "BAXTER_GOOGLE_NOT_CONFIGURED",
    );
  }

  if (!isPrivateKeyFormatValid(env.GOOGLE_PRIVATE_KEY)) {
    throw new GoogleConfigError(
      "GOOGLE_PRIVATE_KEY is missing BEGIN/END markers or is malformed.",
      "BAXTER_GOOGLE_PRIVATE_KEY_INVALID",
    );
  }

  const cached = globalToken.__baxterGoogleToken;
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: env.GOOGLE_CLIENT_EMAIL,
      scope: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ].join(" "),
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();

  let signature: string;
  try {
    signature = base64Url(signer.sign(normalizePrivateKey(env.GOOGLE_PRIVATE_KEY)));
  } catch {
    throw new GoogleConfigError(
      "GOOGLE_PRIVATE_KEY could not be used to sign a JWT.",
      "BAXTER_GOOGLE_PRIVATE_KEY_INVALID",
    );
  }
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !data?.access_token) {
    throw new GoogleConnectorError(
      data?.error_description || data?.error || "Failed to obtain Google access token",
      {
        statusCode: response.status,
        code: "BAXTER_GOOGLE_AUTH_FAILED",
      },
    );
  }

  globalToken.__baxterGoogleToken = {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

export async function googleFetch<T>(
  url: string,
  init?: RequestInit & { rawText?: boolean },
): Promise<T> {
  const token = await mintAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const lower = text.toLowerCase();
    let code = "BAXTER_GOOGLE_SYNC_FAILED";
    if (response.status === 404) code = "BAXTER_GOOGLE_FOLDER_NOT_FOUND";
    else if (response.status === 403) {
      code = lower.includes("shared drive")
        ? "BAXTER_GOOGLE_SHARED_DRIVE_ACCESS_DENIED"
        : "BAXTER_GOOGLE_FOLDER_ACCESS_DENIED";
    } else if (response.status === 401) code = "BAXTER_GOOGLE_AUTH_FAILED";
    else if (lower.includes("access_not_configured") || lower.includes("api has not been used")) {
      code = "BAXTER_GOOGLE_API_DISABLED";
    }

    throw new GoogleConnectorError(
      `Google API request failed (${response.status}): ${text.slice(0, 200)}`,
      { statusCode: response.status, code },
    );
  }

  if (init?.rawText) {
    return (await response.text()) as T;
  }
  return (await response.json()) as T;
}

export function clearGoogleTokenCacheForTests() {
  delete globalToken.__baxterGoogleToken;
}
