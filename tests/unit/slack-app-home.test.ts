/**
 * Slack App Home tab — registry-derived capabilities, slash-command catalog,
 * per-user Slack Search connection status.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { BAXTER_SLACK_SLASH_COMMANDS } from "@/lib/slack/slash-command-catalog";
import { buildAppHomeView, isAppHomeOpenedEvent } from "@/lib/slack/app-home-view";
import { groupHomeCapabilities } from "@/lib/slack/app-home-capabilities";
import type { BaxterCapability } from "@/lib/baxter/capability-registry";
import { deriveClaimedCapabilitiesFromCatalog } from "@/lib/baxter-ai/governance/capabilities";

function envForSlack() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.ENABLE_SLACK_INTEGRATION = "true";
  process.env.SLACK_SIGNING_SECRET = "secret";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_ALLOWED_TEAM_IDS = "T123";
  process.env.SLACK_ALLOWED_USER_IDS = "";
  resetEnvCacheForTests();
}

function fixtureCap(overrides: Partial<BaxterCapability> = {}): BaxterCapability {
  return {
    key: "web_chat",
    name: "Baxter web chat",
    shortDescription: "Ask Baxter questions in the Acton Baxter web app.",
    detailedDescription: "Test.",
    category: "assistant",
    audience: ["employee", "admin"],
    rolesAllowed: ["*"],
    status: "available",
    enabled: true,
    webRoute: "/",
    createRoute: null,
    adminRoute: null,
    supportedActions: [],
    limitations: [],
    helpTopics: [],
    synonyms: [],
    sourceOfTruth: "runtime",
    ...overrides,
  };
}

function flattenViewText(view: { blocks: Array<Record<string, unknown>> }): string {
  return JSON.stringify(view);
}

describe("slash-command catalog matches registered sources", () => {
  it("matches docs/slack-app-manifest.yaml commands", () => {
    const manifest = readFileSync(join(process.cwd(), "docs/slack-app-manifest.yaml"), "utf8");
    const yamlCommands = [...manifest.matchAll(/^\s+-\s+command:\s+(\/\S+)/gm)].map((m) => m[1]);
    expect(BAXTER_SLACK_SLASH_COMMANDS.map((c) => c.command)).toEqual(yamlCommands);
    expect(manifest).toContain("app_home_opened");
    expect(manifest).toContain("home_tab_enabled: true");
  });

  it("matches src/app/api/slack/commands route folders", () => {
    const dir = join(process.cwd(), "src/app/api/slack/commands");
    const routes = readdirSync(dir).filter((name) =>
      readdirSync(join(dir, name)).includes("route.ts"),
    );
    expect(BAXTER_SLACK_SLASH_COMMANDS.map((c) => c.routeSegment).sort()).toEqual(
      [...routes].sort(),
    );
  });
});

describe("App Home view builder", () => {
  it("isAppHomeOpenedEvent requires home tab + user", () => {
    expect(isAppHomeOpenedEvent({ type: "app_home_opened", user: "U1", tab: "home" })).toBe(true);
    expect(isAppHomeOpenedEvent({ type: "app_home_opened", user: "U1" })).toBe(true);
    expect(isAppHomeOpenedEvent({ type: "app_home_opened", user: "U1", tab: "messages" })).toBe(
      false,
    );
    expect(isAppHomeOpenedEvent({ type: "app_mention", user: "U1" })).toBe(false);
    expect(isAppHomeOpenedEvent({ type: "app_home_opened", tab: "home" })).toBe(false);
  });

  it("shows connected vs disconnected Slack Search sections", () => {
    const connected = buildAppHomeView({
      webAppUrl: "https://example.com/",
      integrationsUrl: "https://example.com/settings/integrations",
      slackSearch: "connected",
      capabilityGroups: [{ heading: "Ask Baxter", lines: ["Ask questions."] }],
    });
    const disconnected = buildAppHomeView({
      webAppUrl: "https://example.com/",
      integrationsUrl: "https://example.com/settings/integrations",
      slackSearch: "disconnected",
      capabilityGroups: [{ heading: "Ask Baxter", lines: ["Ask questions."] }],
    });

    const c = flattenViewText(connected);
    const d = flattenViewText(disconnected);
    expect(c).toMatch(/Slack Search is connected/);
    expect(c).not.toMatch(/Connect Slack Search/);
    expect(d).toMatch(/Connect Slack Search/);
    expect(d).toContain("https://example.com/settings/integrations");
    expect(c).toContain("/clear");
    expect(c).toContain("/new-project");
    expect(c).toContain("Open Baxter");
    expect(c).not.toMatch(/work in progress/i);
  });

  it("capability content reflects the registry — extra fixture line appears", () => {
    const base = [
      fixtureCap(),
      fixtureCap({
        key: "pem_neat",
        category: "pem_neat",
        shortDescription: "Generate PEM NEATs.",
      }),
    ];
    const extra = fixtureCap({
      key: "test_widget",
      name: "Test Widget",
      shortDescription: "Do the test widget thing on Home.",
      category: "assistant",
    });

    const without = groupHomeCapabilities(base);
    const withExtra = groupHomeCapabilities([...base, extra]);
    const viewWithout = buildAppHomeView({
      webAppUrl: "https://example.com/",
      integrationsUrl: "https://example.com/settings/integrations",
      capabilityGroups: without,
      slackSearch: "connected",
    });
    const viewWith = buildAppHomeView({
      webAppUrl: "https://example.com/",
      integrationsUrl: "https://example.com/settings/integrations",
      capabilityGroups: withExtra,
      slackSearch: "connected",
    });

    expect(flattenViewText(viewWithout)).not.toContain("Do the test widget thing on Home.");
    expect(flattenViewText(viewWith)).toContain("Do the test widget thing on Home.");
    expect(deriveClaimedCapabilitiesFromCatalog([...base, extra]).capabilities).toContain(
      "Do the test widget thing on Home.",
    );
    expect(flattenViewText(viewWith)).toContain("/recall");
  });

  it("omits capability and connection sections when those values are absent", () => {
    const view = buildAppHomeView({
      webAppUrl: "https://example.com/",
      integrationsUrl: "https://example.com/settings/integrations",
      capabilityGroups: null,
      slackSearch: null,
    });
    const text = flattenViewText(view);
    expect(text).toContain("Acton ADU");
    expect(text).not.toContain("What Baxter can currently do");
    expect(text).not.toContain("Connect Slack Search");
    expect(text).not.toContain("Slack Search is connected");
    expect(text).toContain("Open Baxter");
  });
});

describe("handleAppHomeOpened", () => {
  beforeEach(() => {
    envForSlack();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes a connected Home view", async () => {
    const { handleAppHomeOpened } = await import("@/lib/slack/app-home");
    const publishView = vi.fn().mockResolvedValue({ ok: true });

    const result = await handleAppHomeOpened(
      { type: "app_home_opened", user: "U_CONN", tab: "home" },
      "T123",
      {
        loadCatalog: async () => [
          fixtureCap(),
          fixtureCap({
            key: "pem_neat",
            category: "pem_neat",
            shortDescription: "Generate PEM NEATs.",
          }),
        ],
        loadConnection: async ({ slackUserId, slackTeamId }) => {
          expect(slackUserId).toBe("U_CONN");
          expect(slackTeamId).toBe("T123");
          return {
            linked: true,
            slackUserId: "U_CONN",
            slackTeamId: "T123",
            slackUserName: "Pat",
            scopes: [],
            status: "connected",
            baxterUserId: "profile-1",
            resolvedVia: "slack_user_id",
          };
        },
        publishView,
        getBaseUrl: () => "https://example.com",
      },
    );

    expect(result.published).toBe(true);
    expect(result.slackSearch).toBe("connected");
    expect(publishView).toHaveBeenCalledTimes(1);
    const payload = publishView.mock.calls[0]![0] as {
      userId: string;
      view: { type: string; blocks: unknown[] };
    };
    expect(payload.userId).toBe("U_CONN");
    expect(payload.view.type).toBe("home");
    const text = JSON.stringify(payload.view);
    expect(text).toMatch(/Slack Search is connected/);
    expect(text).toContain("Ask Baxter questions in the Acton Baxter web app.");
    expect(text).not.toContain("Connect Slack Search");
  });

  it("publishes an unconnected Home view with Connect button", async () => {
    const { handleAppHomeOpened } = await import("@/lib/slack/app-home");
    const publishView = vi.fn().mockResolvedValue({ ok: true });

    const result = await handleAppHomeOpened(
      { type: "app_home_opened", user: "U_NO", tab: "home" },
      "T123",
      {
        loadCatalog: async () => [fixtureCap()],
        loadConnection: async () => ({
          linked: false,
          slackUserId: null,
          slackTeamId: null,
          slackUserName: null,
          scopes: [],
          status: null,
          baxterUserId: null,
          resolvedVia: null,
        }),
        publishView,
        getBaseUrl: () => "https://example.com",
      },
    );

    expect(result.published).toBe(true);
    expect(result.slackSearch).toBe("disconnected");
    const text = JSON.stringify(publishView.mock.calls[0]![0].view);
    expect(text).toMatch(/Connect Slack Search/);
    expect(text).toContain("https://example.com/settings/integrations");
    expect(text).not.toMatch(/Slack Search is connected/);
  });

  it("still publishes when capability lookup throws", async () => {
    const { handleAppHomeOpened } = await import("@/lib/slack/app-home");
    const publishView = vi.fn().mockResolvedValue({ ok: true });

    const result = await handleAppHomeOpened(
      { type: "app_home_opened", user: "U1", tab: "home" },
      "T123",
      {
        loadCatalog: async () => {
          throw new Error("catalog boom");
        },
        loadConnection: async () => ({
          linked: true,
          slackUserId: "U1",
          slackTeamId: "T123",
          slackUserName: null,
          scopes: [],
          status: "connected",
          baxterUserId: null,
          resolvedVia: "slack_user_id",
        }),
        publishView,
        getBaseUrl: () => "https://example.com",
      },
    );

    expect(result.published).toBe(true);
    expect(result.omitted).toContain("capabilities");
    const text = JSON.stringify(publishView.mock.calls[0]![0].view);
    expect(text).not.toContain("What Baxter can currently do");
    expect(text).toMatch(/Slack Search is connected/);
    expect(text).toContain("Acton ADU");
  });

  it("still publishes when connection check throws", async () => {
    const { handleAppHomeOpened } = await import("@/lib/slack/app-home");
    const publishView = vi.fn().mockResolvedValue({ ok: true });

    const result = await handleAppHomeOpened(
      { type: "app_home_opened", user: "U1", tab: "home" },
      "T123",
      {
        loadCatalog: async () => [fixtureCap()],
        loadConnection: async () => {
          throw new Error("connection boom");
        },
        publishView,
        getBaseUrl: () => "https://example.com",
      },
    );

    expect(result.published).toBe(true);
    expect(result.omitted).toContain("slack_search");
    const text = JSON.stringify(publishView.mock.calls[0]![0].view);
    expect(text).not.toContain("Connect Slack Search");
    expect(text).not.toContain("Slack Search is connected");
    expect(text).toContain("Ask Baxter questions in the Acton Baxter web app.");
  });

  it("logs views.publish ok:false instead of swallowing it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { handleAppHomeOpened } = await import("@/lib/slack/app-home");
    const publishView = vi.fn().mockResolvedValue({ ok: false, error: "not_allowed" });

    const result = await handleAppHomeOpened(
      { type: "app_home_opened", user: "U1", tab: "home" },
      "T123",
      {
        loadCatalog: async () => [fixtureCap()],
        loadConnection: async () => ({
          linked: true,
          slackUserId: "U1",
          slackTeamId: "T123",
          slackUserName: null,
          scopes: [],
          status: "connected",
          baxterUserId: null,
          resolvedVia: "slack_user_id",
        }),
        publishView,
        getBaseUrl: () => "https://example.com",
      },
    );

    expect(result.published).toBe(false);
    expect(result.skipped).toBe("publish_failed");
    expect(errorSpy).toHaveBeenCalledWith(
      "[slack.app_home.publish_failed]",
      expect.objectContaining({ slackUserId: "U1", error: "not_allowed" }),
    );
  });
});

describe("publishSlackHomeView ok:false convention", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    envForSlack();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("treats HTTP 200 + {ok:false} as failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: false, error: "not_allowed" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { publishSlackHomeView } = await import("@/lib/slack/client");
    const result = await publishSlackHomeView({
      userId: "U1",
      view: { type: "home", blocks: [] },
    });
    expect(result).toEqual({ ok: false, error: "not_allowed" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/views.publish",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("App Home events route stays off the Q&A path", () => {
  it("events route handles app_home_opened without importing the answer pipeline at top level", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/slack/events/route.ts"), "utf8");
    expect(route).toContain("app_home_opened");
    expect(route).toContain('await import("@/lib/slack/app-home")');
    expect(route).not.toMatch(/from ["']@\/lib\/slack\/app-home["']/);
    expect(route).not.toMatch(/from ["']@\/lib\/baxter\/capability-registry["']/);
  });

  it("Q&A ignore list still excludes app_home_opened", async () => {
    const { shouldIgnoreSlackEvent } = await import("@/lib/slack/baxter-events");
    expect(shouldIgnoreSlackEvent({ type: "app_home_opened", user: "U1" })).toBe(true);
  });
});
