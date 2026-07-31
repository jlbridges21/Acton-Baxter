import "server-only";

import { createSign } from "node:crypto";
import { getEnv } from "@/lib/env";
import { GoogleConfigError, GoogleConnectorError } from "../errors";
import { isPrivateKeyFormatValid, normalizePrivateKey } from "../auth-helpers";
import {
  GOOGLE_API_SCOPES,
  type GoogleCredentialHealth,
  type GoogleCredentialProvider,
  type GoogleConnectorIdentity,
} from "./types";

function base64Url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Domain-wide delegation only when SA + impersonated Workspace user are configured.
 * Does not claim DWD works merely because env vars exist — token mint must succeed.
 */
export function isDomainWideDelegationConfigured(): boolean {
  try {
    const env = getEnv();
    const subject = (process.env.GOOGLE_IMPERSONATED_USER ?? "").trim();
    return Boolean(
      subject &&
      env.GOOGLE_CLIENT_EMAIL &&
      env.GOOGLE_PRIVATE_KEY &&
      isPrivateKeyFormatValid(env.GOOGLE_PRIVATE_KEY),
    );
  } catch {
    return false;
  }
}

export class DomainWideDelegationCredentialProvider implements GoogleCredentialProvider {
  mode = "domain_wide_delegation" as const;

  async getIdentity(): Promise<GoogleConnectorIdentity> {
    const subject = (process.env.GOOGLE_IMPERSONATED_USER ?? "").trim() || null;
    return {
      mode: "domain_wide_delegation",
      email: subject,
      subject,
      hostedDomain: subject?.includes("@") ? (subject.split("@")[1] ?? null) : null,
    };
  }

  async health(): Promise<GoogleCredentialHealth> {
    if (!isDomainWideDelegationConfigured()) {
      return {
        ok: false,
        mode: "domain_wide_delegation",
        code: "BAXTER_GOOGLE_NOT_CONFIGURED",
        message:
          "Domain-wide delegation is unavailable. Configure GOOGLE_IMPERSONATED_USER plus a service account with Workspace DWD authorized for the required scopes.",
        email: null,
      };
    }
    try {
      const identity = await this.getIdentity();
      await this.getAccessToken();
      return {
        ok: true,
        mode: "domain_wide_delegation",
        code: null,
        message: "Domain-wide delegation token minted successfully.",
        email: identity.email,
      };
    } catch (error) {
      return {
        ok: false,
        mode: "domain_wide_delegation",
        code: "BAXTER_GOOGLE_AUTH_FAILED",
        message: error instanceof Error ? error.message.slice(0, 200) : "DWD auth failed",
        email: (await this.getIdentity()).email,
      };
    }
  }

  async getAccessToken(): Promise<string> {
    if (!isDomainWideDelegationConfigured()) {
      throw new GoogleConfigError(
        "Domain-wide delegation is not fully configured.",
        "BAXTER_GOOGLE_NOT_CONFIGURED",
      );
    }
    const env = getEnv();
    const subject = (process.env.GOOGLE_IMPERSONATED_USER ?? "").trim();
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = base64Url(
      JSON.stringify({
        iss: env.GOOGLE_CLIENT_EMAIL,
        sub: subject,
        scope: GOOGLE_API_SCOPES.join(" "),
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
      signature = base64Url(signer.sign(normalizePrivateKey(env.GOOGLE_PRIVATE_KEY!)));
    } catch {
      throw new GoogleConfigError(
        "GOOGLE_PRIVATE_KEY could not sign a DWD JWT.",
        "BAXTER_GOOGLE_PRIVATE_KEY_INVALID",
      );
    }
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
    });
    const data = (await response.json().catch(() => null)) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    } | null;
    if (!response.ok || !data?.access_token) {
      throw new GoogleConnectorError(
        data?.error_description ||
          data?.error ||
          "Domain-wide delegation token failed. Confirm Workspace admin authorized the scopes.",
        { statusCode: response.status, code: "BAXTER_GOOGLE_AUTH_FAILED", expose: true },
      );
    }
    return data.access_token;
  }
}
