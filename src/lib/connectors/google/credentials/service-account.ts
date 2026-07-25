import "server-only";

import { createSign } from "node:crypto";
import { getEnv } from "@/lib/env";
import { GoogleConfigError, GoogleConnectorError } from "../errors";
import { isPrivateKeyFormatValid, normalizePrivateKey } from "../auth-helpers";
import type {
  GoogleCredentialHealth,
  GoogleCredentialProvider,
  GoogleConnectorIdentity,
} from "./types";

function base64Url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

type TokenCache = { accessToken: string; expiresAtMs: number };

const globalSa = globalThis as typeof globalThis & {
  __baxterGoogleSaToken?: TokenCache;
};

export class ServiceAccountCredentialProvider implements GoogleCredentialProvider {
  mode = "service_account" as const;

  async getIdentity(): Promise<GoogleConnectorIdentity> {
    const env = getEnv();
    return {
      mode: "service_account",
      email: env.GOOGLE_CLIENT_EMAIL?.trim() || null,
      subject: null,
      hostedDomain: null,
    };
  }

  async health(): Promise<GoogleCredentialHealth> {
    try {
      const identity = await this.getIdentity();
      if (!identity.email) {
        return {
          ok: false,
          mode: "service_account",
          code: "BAXTER_GOOGLE_NOT_CONFIGURED",
          message: "GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY is missing.",
          email: null,
        };
      }
      await this.getAccessToken();
      return {
        ok: true,
        mode: "service_account",
        code: null,
        message:
          "Service account authenticated. Note: this identity is often external to Acton Workspace and may not access Shared Drives restricted to internal members.",
        email: identity.email,
      };
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "BAXTER_GOOGLE_AUTH_FAILED";
      return {
        ok: false,
        mode: "service_account",
        code,
        message: error instanceof Error ? error.message.slice(0, 200) : "Auth failed",
        email: (await this.getIdentity()).email,
      };
    }
  }

  async getAccessToken(): Promise<string> {
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

    const cached = globalSa.__baxterGoogleSaToken;
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

    globalSa.__baxterGoogleSaToken = {
      accessToken: data.access_token,
      expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  }
}

export function clearServiceAccountTokenCacheForTests() {
  delete globalSa.__baxterGoogleSaToken;
}
