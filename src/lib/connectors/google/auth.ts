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

function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

export function isGoogleWorkspaceConfigured(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY);
  } catch {
    return false;
  }
}

function base64Url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function mintAccessToken(): Promise<string> {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new GoogleConfigError(
      "Set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY for the Baxter service account.",
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
  const signature = base64Url(signer.sign(normalizePrivateKey(env.GOOGLE_PRIVATE_KEY)));
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
      { statusCode: response.status },
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
    throw new GoogleConnectorError(
      `Google API request failed (${response.status}): ${text.slice(0, 200)}`,
      { statusCode: response.status },
    );
  }

  if (init?.rawText) {
    return (await response.text()) as T;
  }
  return (await response.json()) as T;
}
