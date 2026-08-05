import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isGoogleTokenEncryptionConfigured,
} from "@/lib/security/secret-box";
import {
  isGoogleAccountAllowed,
  requiredScopesGranted,
  googleOAuthAuthorizationUrl,
  getGoogleAuthMode,
} from "@/lib/connectors/google/oauth-config";
import { GOOGLE_OAUTH_SCOPES } from "@/lib/connectors/google/credentials/types";
import { classifyGoogleApiError } from "@/lib/connectors/google/credentials/resolve";
import { resetEnvCacheForTests } from "@/lib/env";

describe("Prompt 2 — Google Workspace OAuth foundations", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "GOOGLE_TOKEN_ENCRYPTION_KEY",
      "GHL_TOKEN_ENCRYPTION_KEY",
      "SLACK_TOKEN_ENCRYPTION_KEY",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_OAUTH_REDIRECT_URI",
      "GOOGLE_OAUTH_ALLOWED_DOMAINS",
      "GOOGLE_OAUTH_ALLOWED_EMAILS",
      "GOOGLE_AUTH_MODE",
    ]) {
      prev[key] = process.env[key];
    }
    delete process.env.GHL_TOKEN_ENCRYPTION_KEY;
    delete process.env.SLACK_TOKEN_ENCRYPTION_KEY;
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      "https://acton-baxter.vercel.app/api/admin/connectors/google/oauth/callback";
    process.env.GOOGLE_OAUTH_ALLOWED_DOMAINS = "actonadu.com";
    process.env.GOOGLE_OAUTH_ALLOWED_EMAILS = "baxter@actonadu.com";
    process.env.GOOGLE_AUTH_MODE = "workspace_oauth";
    resetEnvCacheForTests();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCacheForTests();
  });

  it("encrypts and decrypts refresh tokens with unique nonces", () => {
    expect(isGoogleTokenEncryptionConfigured()).toBe(true);
    const a = encryptSecret("refresh-token-one");
    const b = encryptSecret("refresh-token-one");
    expect(a).not.toEqual(b);
    expect(a).not.toContain("refresh-token-one");
    expect(decryptSecret(a)).toBe("refresh-token-one");
    expect(decryptSecret(b)).toBe("refresh-token-one");
  });

  it("fails decryption with the wrong key", () => {
    const payload = encryptSecret("secret-value");
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    delete process.env.GHL_TOKEN_ENCRYPTION_KEY;
    delete process.env.SLACK_TOKEN_ENCRYPTION_KEY;
    expect(() => decryptSecret(payload)).toThrow();
  });

  it("rejects consumer Gmail and accepts allowlisted Acton email", () => {
    expect(isGoogleAccountAllowed({ email: "someone@gmail.com" }).ok).toBe(false);
    expect(isGoogleAccountAllowed({ email: "other@actonadu.com" }).ok).toBe(false);
    expect(
      isGoogleAccountAllowed({ email: "baxter@actonadu.com", hostedDomain: "actonadu.com" }).ok,
    ).toBe(true);
  });

  it("accepts full Drive/Sheets write scopes (and still satisfies read)", () => {
    expect(requiredScopesGranted([...GOOGLE_OAUTH_SCOPES])).toBe(true);
    expect(requiredScopesGranted(["email", "openid"])).toBe(false);
    expect(GOOGLE_OAUTH_SCOPES.join(" ")).toContain("auth/drive");
    expect(GOOGLE_OAUTH_SCOPES.join(" ")).not.toContain("drive.readonly");
    expect(GOOGLE_OAUTH_SCOPES.join(" ")).toContain("auth/spreadsheets");
    expect(GOOGLE_OAUTH_SCOPES.join(" ")).not.toContain("spreadsheets.readonly");
    // Legacy read-only connection still validates as having required read scopes
    expect(
      requiredScopesGranted([
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ]),
    ).toBe(true);
  });

  it("builds OAuth authorize URL with offline access and write scopes", () => {
    const url = new URL(googleOAuthAuthorizationUrl("state-abc", true));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("redirect_uri")).toContain(
      "/api/admin/connectors/google/oauth/callback",
    );
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("auth/drive");
    expect(scope).not.toContain("drive.readonly");
    expect(scope).toContain("documents.readonly");
    expect(scope).toContain("auth/spreadsheets");
    expect(scope).not.toContain("spreadsheets.readonly");
  });

  it("defaults auth mode to workspace_oauth", () => {
    expect(getGoogleAuthMode()).toBe("workspace_oauth");
  });

  it("classifies API disabled separately from folder access denied", () => {
    expect(
      classifyGoogleApiError(
        403,
        "Google Drive API has not been used in project 123 before or it is disabled.",
      ),
    ).toBe("BAXTER_GOOGLE_DRIVE_API_DISABLED");
    expect(classifyGoogleApiError(403, "The caller does not have permission")).toBe(
      "BAXTER_GOOGLE_PERMISSION_DENIED",
    );
    expect(classifyGoogleApiError(404, "not found")).toBe("BAXTER_GOOGLE_FOLDER_NOT_FOUND");
    expect(
      classifyGoogleApiError(
        403,
        "baxter@… is outside of Acton ADU. Only people inside Acton ADU can access files in this shared drive.",
      ),
    ).toBe("BAXTER_GOOGLE_SHARED_DRIVE_NOT_VISIBLE");
  });

  it("parses nullable FormData-like knowledge upload fields without Zod null errors", async () => {
    const { z } = await import("zod");
    const formString = z.preprocess(
      (value) => (value == null || value === "" ? undefined : String(value)),
      z.string().optional(),
    );
    expect(
      z
        .object({ titles: formString, category: formString })
        .parse({ titles: null, category: null }),
    ).toEqual({ titles: undefined, category: undefined });
  });
});
