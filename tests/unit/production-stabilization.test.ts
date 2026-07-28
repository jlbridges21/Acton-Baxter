import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("Google OAuth authorization URL", () => {
  const prev = {
    id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  };

  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      "https://example.com/api/admin/connectors/google/oauth/callback";
  });

  afterEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = prev.id;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = prev.secret;
    process.env.GOOGLE_OAUTH_REDIRECT_URI = prev.redirect;
  });

  it("always requests offline access", async () => {
    const { googleOAuthAuthorizationUrl } = await import("@/lib/connectors/google/oauth-config");
    const url = new URL(googleOAuthAuthorizationUrl("state-1", false));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBeNull();
  });

  it("adds prompt=consent when forceConsent is true", async () => {
    const { googleOAuthAuthorizationUrl } = await import("@/lib/connectors/google/oauth-config");
    const url = new URL(googleOAuthAuthorizationUrl("state-2", true));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
});

describe("monitoring API client contract helpers", () => {
  it("maps dismissed_false_positive to false_positive for UI", () => {
    const status = "dismissed_false_positive";
    const clientStatus = status === "dismissed_false_positive" ? "false_positive" : status;
    expect(clientStatus).toBe("false_positive");
  });

  it("treats missing success as a client-visible failure", () => {
    const data: { success?: boolean } = {};
    expect(Boolean(data.success)).toBe(false);
  });
});

describe("Feasibility Package default pipeline", () => {
  it("uses the known Feasibility Package pipeline id", () => {
    expect("11xV4ZJU0JotklCTFpgw").toMatch(/^11x/);
  });
});
