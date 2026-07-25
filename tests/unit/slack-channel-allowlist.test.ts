import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { evaluateSlackAccess } from "@/lib/slack/baxter-events";
import { isSlackChannelAllowed } from "@/lib/slack/config";

function setSlackBaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.ENABLE_SLACK_INTEGRATION = "true";
  process.env.SLACK_SIGNING_SECRET = "secret";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_ALLOWED_TEAM_IDS = "T123";
  process.env.SLACK_ENABLE_DMS = "true";
  process.env.SLACK_ENABLE_CHANNEL_MENTIONS = "true";
  delete process.env.SLACK_ALLOWED_USER_IDS;
}

describe("Slack channel allowlist (empty = all channels)", () => {
  beforeEach(() => {
    setSlackBaseEnv();
    resetEnvCacheForTests();
  });

  it("allows channel mentions when SLACK_ALLOWED_CHANNEL_IDS is unset", () => {
    delete process.env.SLACK_ALLOWED_CHANNEL_IDS;
    resetEnvCacheForTests();
    expect(isSlackChannelAllowed("Cany")).toBe(true);
    expect(
      evaluateSlackAccess({
        type: "app_mention",
        channel: "Cany",
        user: "U1",
        text: "<@B> hello",
      }).allowed,
    ).toBe(true);
  });

  it("allows channel mentions when SLACK_ALLOWED_CHANNEL_IDS is blank/whitespace", () => {
    process.env.SLACK_ALLOWED_CHANNEL_IDS = "   ";
    resetEnvCacheForTests();
    expect(isSlackChannelAllowed("Cblank")).toBe(true);
    expect(
      evaluateSlackAccess({
        type: "app_mention",
        channel: "Cblank",
        user: "U1",
        text: "<@B> hello",
      }).allowed,
    ).toBe(true);
  });

  it("allows matching configured channel", () => {
    process.env.SLACK_ALLOWED_CHANNEL_IDS = "C111, C222";
    resetEnvCacheForTests();
    expect(isSlackChannelAllowed("C111")).toBe(true);
    expect(
      evaluateSlackAccess({
        type: "app_mention",
        channel: "C222",
        user: "U1",
        text: "<@B> hello",
      }).allowed,
    ).toBe(true);
  });

  it("denies nonmatching configured channel", () => {
    process.env.SLACK_ALLOWED_CHANNEL_IDS = "C111";
    resetEnvCacheForTests();
    expect(isSlackChannelAllowed("C999")).toBe(false);
    const access = evaluateSlackAccess({
      type: "app_mention",
      channel: "C999",
      user: "U1",
      text: "<@B> hello",
    });
    expect(access.allowed).toBe(false);
    expect(access.code).toBe("BAXTER_SLACK_CHANNEL_NOT_ALLOWED");
    expect(access.reason).toBe("channel_not_in_allowlist");
  });

  it("denies channel mentions when SLACK_ENABLE_CHANNEL_MENTIONS=false", () => {
    delete process.env.SLACK_ALLOWED_CHANNEL_IDS;
    process.env.SLACK_ENABLE_CHANNEL_MENTIONS = "false";
    resetEnvCacheForTests();
    const access = evaluateSlackAccess({
      type: "app_mention",
      channel: "Cany",
      user: "U1",
      text: "<@B> hello",
    });
    expect(access.allowed).toBe(false);
    expect(access.code).toBe("BAXTER_SLACK_MENTIONS_DISABLED");
    expect(access.reason).toBe("channel_mentions_disabled");
  });

  it("leaves DMs unaffected by channel allowlist and mention toggle", () => {
    process.env.SLACK_ALLOWED_CHANNEL_IDS = "C111";
    process.env.SLACK_ENABLE_CHANNEL_MENTIONS = "false";
    resetEnvCacheForTests();
    expect(
      evaluateSlackAccess({
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        text: "hi from dm",
      }).allowed,
    ).toBe(true);
  });

  it("logs ignored mentions without message content", async () => {
    const { logIgnoredSlackMention } = await import("@/lib/slack/baxter-events");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logIgnoredSlackMention({
      eventType: "app_mention",
      teamId: "T123",
      channelId: "C999",
      reason: "channel_not_in_allowlist",
      code: "BAXTER_SLACK_CHANNEL_NOT_ALLOWED",
    });
    const logged = spy.mock.calls.map((call) => JSON.stringify(call)).join("\n");
    expect(logged).toContain("app_mention");
    expect(logged).toContain("T123");
    expect(logged).toContain("C999");
    expect(logged).toContain("channel_not_in_allowlist");
    expect(logged).not.toContain("secret message body");
    spy.mockRestore();
  });
});
