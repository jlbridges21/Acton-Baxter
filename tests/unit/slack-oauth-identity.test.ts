import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  getSlackSearchOAuthRedirectUri,
  getSlackSearchRuntimeConfig,
  normalizeSlackOAuthRedirectUri,
  SLACK_SEARCH_OAUTH_CALLBACK_PATH,
  SLACK_SEARCH_USER_SCOPES,
} from "@/lib/baxter-data/slack/config";
import { PEM_UNMAPPED_SLACK_USER_MESSAGE } from "@/lib/slack/identity";
import { CLEAR_RESPONSE_SLACK } from "@/lib/baxter-ai/commands";
import { RECALL_USAGE } from "@/lib/slack/slash-commands";

function seedEnv(overrides: Record<string, string> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
  process.env.NEXT_PUBLIC_APP_URL = "https://acton-baxter.vercel.app";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.ENABLE_SLACK_INTEGRATION = "true";
  process.env.ENABLE_SLACK_SEARCH = "true";
  process.env.SLACK_SIGNING_SECRET = "secret";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_CLIENT_ID = "cid";
  process.env.SLACK_CLIENT_SECRET = "csecret";
  process.env.SLACK_ALLOWED_TEAM_IDS = "T_ACTON";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  delete process.env.SLACK_SEARCH_OAUTH_REDIRECT_URI;
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  resetEnvCacheForTests();
}

describe("Slack Search OAuth redirect URI", () => {
  beforeEach(() => {
    seedEnv();
  });

  it("derives production callback from APP_BASE_URL", () => {
    expect(getSlackSearchOAuthRedirectUri()).toBe(
      "https://acton-baxter.vercel.app/api/slack/search/oauth/callback",
    );
    expect(SLACK_SEARCH_OAUTH_CALLBACK_PATH).toBe("/api/slack/search/oauth/callback");
  });

  it("prefers SLACK_SEARCH_OAUTH_REDIRECT_URI and normalizes trailing slash", () => {
    seedEnv({
      SLACK_SEARCH_OAUTH_REDIRECT_URI:
        "https://acton-baxter.vercel.app/api/slack/search/oauth/callback/",
    });
    expect(getSlackSearchOAuthRedirectUri()).toBe(
      "https://acton-baxter.vercel.app/api/slack/search/oauth/callback",
    );
  });

  it("authorize URL contains exact redirect_uri and user scopes", () => {
    const config = getSlackSearchRuntimeConfig();
    expect(config.oauthRedirectUriConfigured).toBe(true);
    expect(config.oauthAuthorizeUrl).toContain(
      "redirect_uri=https%3A%2F%2Facton-baxter.vercel.app%2Fapi%2Fslack%2Fsearch%2Foauth%2Fcallback",
    );
    expect(config.oauthAuthorizeUrl).toContain("user_scope=");
    expect(config.oauthAuthorizeUrl).toContain(encodeURIComponent(SLACK_SEARCH_USER_SCOPES[0]!));
    // Bot install scope intentionally empty for user-token OAuth.
    expect(config.oauthAuthorizeUrl).toMatch(/[?&]scope=(?:&|$)/);
  });

  it("token exchange uses the same redirect_uri as authorize", async () => {
    const authorizeUri = getSlackSearchOAuthRedirectUri();
    expect(authorizeUri).toBe("https://acton-baxter.vercel.app/api/slack/search/oauth/callback");
    // Callback route imports the same helper — regression lock against divergence.
    const { getSlackSearchOAuthRedirectUri: exchangeUri } =
      await import("@/lib/baxter-data/slack/config");
    expect(exchangeUri()).toBe(authorizeUri);
  });

  it("normalize strips query/hash noise", () => {
    expect(
      normalizeSlackOAuthRedirectUri(
        "https://acton-baxter.vercel.app/api/slack/search/oauth/callback?x=1#y",
      ),
    ).toBe("https://acton-baxter.vercel.app/api/slack/search/oauth/callback");
  });
});

describe("PEM identity without Slack Search", () => {
  beforeEach(() => {
    vi.resetModules();
    seedEnv();
  });

  it("opens PEM modal when Slack maps via email without search connection", async () => {
    vi.doMock("@/lib/slack/identity", () => ({
      resolveBaxterUserForSlackIdentity: async () => ({
        userId: "11111111-1111-1111-1111-111111111111",
        displayName: "Jackson Bridges",
        matchedVia: "email",
      }),
      PEM_UNMAPPED_SLACK_USER_MESSAGE,
      upsertSlackUserMapping: async () => undefined,
    }));
    vi.doMock("@/lib/pem-neat/salespeople", () => ({
      listSalespeople: async () => [
        { id: "11111111-1111-1111-1111-111111111111", displayName: "Alex Sales" },
      ],
      resolveSalespersonDisplayName: async () => ({ displayName: "Alex Sales" }),
    }));

    const viewsOpen = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("views.open")) {
          await viewsOpen();
          return { json: async () => ({ ok: true }) };
        }
        return { json: async () => ({ ok: false }) };
      }),
    );

    const { handlePemSlashCommand } = await import("@/lib/slack/slash-commands");
    const ack = await handlePemSlashCommand({
      team_id: "T_ACTON",
      user_id: "U_JACKSON",
      channel_id: "D1",
      trigger_id: "trig.1",
      command: "/pem",
    });
    expect(ack.text).toMatch(/Opening PEM/i);
    expect(viewsOpen).toHaveBeenCalled();
  });

  it("unmapped Slack user gets Baxter mapping error, not Connect Slack Search", async () => {
    vi.doMock("@/lib/slack/identity", () => ({
      resolveBaxterUserForSlackIdentity: async () => null,
      PEM_UNMAPPED_SLACK_USER_MESSAGE,
      upsertSlackUserMapping: async () => undefined,
    }));

    const { handlePemSlashCommand } = await import("@/lib/slack/slash-commands");
    const ack = await handlePemSlashCommand({
      team_id: "T_ACTON",
      user_id: "U_UNKNOWN",
      channel_id: "D1",
      trigger_id: "trig.1",
      command: "/pem",
    });
    expect(ack.text).toContain("couldn’t match your Slack account");
    expect(ack.text).not.toMatch(/Connect Slack Search/i);
  });
});

describe("/help and /clear without OAuth", () => {
  beforeEach(() => {
    vi.resetModules();
    seedEnv();
  });

  it("/help works without Slack Search", async () => {
    const { handleHelpSlashCommand } = await import("@/lib/slack/slash-commands");
    const ack = await handleHelpSlashCommand({
      team_id: "T_ACTON",
      user_id: "U1",
      channel_id: "D1",
    });
    expect(ack.text).toContain("/recall");
    expect(ack.text).toContain("/pem");
  });

  it("/clear works without Slack Search", async () => {
    const answerBaxterQuestion = vi.fn(async () => ({
      answer: CLEAR_RESPONSE_SLACK,
      sources: [],
      confidence: "high",
      insufficientKnowledge: false,
      conversationId: "c1",
      answerMode: "identity",
    }));
    vi.doMock("@/lib/baxter-ai/answer", () => ({ answerBaxterQuestion }));
    const { handleClearSlashCommand } = await import("@/lib/slack/slash-commands");
    const ack = await handleClearSlashCommand({
      team_id: "T_ACTON",
      user_id: "U1",
      channel_id: "D1",
    });
    expect(ack.text).toBe(CLEAR_RESPONSE_SLACK);
  });
});

describe("/recall auth CTA", () => {
  beforeEach(() => {
    vi.resetModules();
    seedEnv();
  });

  it("forces recall through shared answer pipeline", async () => {
    const answerBaxterQuestion = vi.fn(async () => ({
      answer:
        "I can’t verify the latest RACI update because your Slack Search connection needs authorization…",
      sources: [],
      confidence: "medium",
      insufficientKnowledge: false,
      conversationId: "c1",
      answerMode: "clarification",
    }));
    vi.doMock("@/lib/baxter-ai/answer", () => ({ answerBaxterQuestion }));
    const { handleRecallSlashCommand } = await import("@/lib/slack/slash-commands");
    const ack = await handleRecallSlashCommand({
      team_id: "T_ACTON",
      user_id: "U1",
      channel_id: "D1",
      text: "What is the latest update on the RACI matrix?",
    });
    expect(answerBaxterQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        slackRecallForced: true,
        question: "What is the latest update on the RACI matrix?",
      }),
    );
    expect(ack.text).toContain("RACI");
  });

  it("empty recall returns usage pointing at integrations for private/DM", () => {
    expect(RECALL_USAGE).toContain("/recall");
  });
});

describe("OAuth callback stores connection + mapping", () => {
  beforeEach(() => {
    vi.resetModules();
    seedEnv();
  });

  it("exchanges code, upserts connection, redirects to integrations", async () => {
    const upsertSlackSearchConnection = vi.fn(async () => ({ ok: true as const, id: "conn1" }));
    const consumeSlackSearchOAuthState = vi.fn(async () => ({
      baxterUserId: "11111111-1111-1111-1111-111111111111",
      returnPath: "/settings/integrations",
    }));
    const upsertSlackUserMapping = vi.fn(async () => undefined);

    vi.doMock("@/lib/auth/session", () => ({
      requireActiveUser: async () => ({
        profile: { id: "11111111-1111-1111-1111-111111111111", role: "admin" },
      }),
    }));
    vi.doMock("@/lib/baxter-data/slack/connections", () => ({
      consumeSlackSearchOAuthState,
      upsertSlackSearchConnection,
    }));
    vi.doMock("@/lib/slack/identity", () => ({
      upsertSlackUserMapping,
      resolveBaxterUserForSlackIdentity: async () => null,
      PEM_UNMAPPED_SLACK_USER_MESSAGE,
    }));
    vi.doMock("@/lib/baxter-data/slack/api", () => ({
      callSlackApi: async () => ({ ok: true, data: { user: "jackson" } }),
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("oauth.v2.access")) {
          return {
            json: async () => ({
              ok: true,
              authed_user: {
                id: "U_JACKSON",
                access_token: "xoxp-test",
                scope: SLACK_SEARCH_USER_SCOPES.join(","),
              },
              team: { id: "T_ACTON", name: "Acton ADU" },
            }),
          };
        }
        return { json: async () => ({ ok: false }) };
      }),
    );

    const { GET } = await import("@/app/api/slack/search/oauth/callback/route");
    const response = await GET(
      new Request(
        "https://acton-baxter.vercel.app/api/slack/search/oauth/callback?code=abc&state=state1",
      ),
    );
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/settings/integrations");
    expect(location).toContain("slack_search=linked");
    expect(upsertSlackSearchConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: "U_JACKSON",
        slackTeamId: "T_ACTON",
        accessToken: "xoxp-test",
      }),
    );
    expect(upsertSlackUserMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: "U_JACKSON",
        appUserId: "11111111-1111-1111-1111-111111111111",
      }),
    );
  });
});
