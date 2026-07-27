import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isSlackDmChannelId,
  isSlackProfileStale,
  pickSlackChannelLabel,
  pickSlackDisplayName,
  parseSlackExternalThreadId,
  slackUserFallbackLabel,
  SLACK_PROFILE_CACHE_TTL_MS,
} from "@/lib/slack/display-names";
import { getAdminNavLinks } from "@/lib/baxter/admin-nav";

describe("admin nav cleanup", () => {
  it("links Integrations to /admin/connectors and removes Uploads + Google Workspace + Slack top-level", () => {
    const links = getAdminNavLinks();
    expect(links.some((l) => l.label === "Uploads")).toBe(false);
    expect(links.some((l) => l.href === "/admin/knowledge/upload")).toBe(false);
    expect(links.some((l) => l.label === "Google Workspace")).toBe(false);
    expect(links.some((l) => l.label === "Slack")).toBe(false);
    expect(links.some((l) => l.href === "/admin/slack")).toBe(false);

    const integrations = links.find((l) => l.label === "Integrations");
    expect(integrations?.href).toBe("/admin/connectors");
    expect(integrations?.match?.("/admin/connectors")).toBe(true);
    expect(integrations?.match?.("/admin/connectors/google")).toBe(true);
  });

  it("keeps /admin/slack as a valid admin route (not removed from product)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const page = path.join(process.cwd(), "src/app/admin/slack/page.tsx");
    expect(fs.existsSync(page)).toBe(true);
    const connectors = fs.readFileSync(
      path.join(process.cwd(), "src/components/admin/connectors-dashboard-client.tsx"),
      "utf8",
    );
    expect(connectors).toContain('href="/admin/slack"');
  });
});

describe("Slack display name helpers", () => {
  it("prefers display_name then real_name then username", () => {
    expect(
      pickSlackDisplayName({
        slack_user_id: "U1",
        display_name: "Jackson Bridges",
        real_name: "Jackson",
        username: "jackson",
      }),
    ).toBe("Jackson Bridges");
    expect(
      pickSlackDisplayName({
        slack_user_id: "U1",
        display_name: null,
        real_name: "Jackson Bridges",
        username: "jackson",
      }),
    ).toBe("Jackson Bridges");
    expect(
      pickSlackDisplayName({
        slack_user_id: "U1",
        display_name: "",
        real_name: null,
        username: "jackson",
      }),
    ).toBe("jackson");
  });

  it("falls back to Slack user <ID> when unresolved (not opaque Unknown)", () => {
    expect(pickSlackDisplayName({ slack_user_id: "U042090LDFC" })).toBe("Slack user U042090LDFC");
    expect(slackUserFallbackLabel("U042090LDFC")).toBe("Slack user U042090LDFC");
    expect(slackUserFallbackLabel(null)).toBe("Unknown Slack user");
  });

  it("labels DMs and public channels; unresolved channel keeps ID", () => {
    expect(isSlackDmChannelId("D123")).toBe(true);
    expect(pickSlackChannelLabel({ slack_channel_id: "D123", channel_type: "im" })).toBe(
      "Direct Message",
    );
    expect(pickSlackChannelLabel({ slack_channel_id: "C123", name: "baxter-pilot" })).toBe(
      "#baxter-pilot",
    );
    expect(pickSlackChannelLabel({ slack_channel_id: "C0BDX025ALW" })).toBe("Channel C0BDX025ALW");
    expect(pickSlackChannelLabel({ slack_channel_id: "G123", is_private: true })).toBe(
      "Private channel",
    );
  });

  it("parses external thread ids", () => {
    const dm = parseSlackExternalThreadId("T1:D9:U1");
    expect(dm.isDmKey).toBe(true);
    expect(dm.channelId).toBe("D9");
    const ch = parseSlackExternalThreadId("T1:C9:123.456");
    expect(ch.isDmKey).toBe(false);
    expect(ch.channelId).toBe("C9");
  });

  it("marks profiles stale after TTL", () => {
    const now = Date.now();
    expect(isSlackProfileStale(null, now)).toBe(true);
    expect(isSlackProfileStale(new Date(now - 1000).toISOString(), now)).toBe(false);
    expect(
      isSlackProfileStale(new Date(now - SLACK_PROFILE_CACHE_TTL_MS - 1).toISOString(), now),
    ).toBe(true);
  });
});

describe("Slack profile cache", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ENABLE_MOCK_RESEARCH = "true";
  });

  it("caches user profiles and avoids repeated API lookups when fresh", async () => {
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const { resetSlackProfilesMemoryForTests, resolveSlackUserProfile, upsertSlackUserProfile } =
      await import("@/lib/slack/profiles");
    resetSlackProfilesMemoryForTests();

    await upsertSlackUserProfile({
      team_id: "T1",
      slack_user_id: "U42",
      display_name: "Jackson Bridges",
      last_resolved_at: new Date().toISOString(),
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const again = await resolveSlackUserProfile({ teamId: "T1", slackUserId: "U42" });
    expect(again.display_name).toBe("Jackson Bridges");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("getSlackUser returns normalized display fields", async () => {
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const { resetSlackProfilesMemoryForTests, upsertSlackUserProfile, getSlackUser } =
      await import("@/lib/slack/profiles");
    resetSlackProfilesMemoryForTests();
    await upsertSlackUserProfile({
      team_id: "T1",
      slack_user_id: "U42",
      display_name: "Jackson Bridges",
      real_name: "Jackson",
      avatar_url: "https://example.com/a.png",
      last_resolved_at: new Date().toISOString(),
    });
    const user = await getSlackUser("T1", "U42");
    expect(user).toEqual({
      id: "U42",
      displayName: "Jackson Bridges",
      realName: "Jackson",
      imageUrl: "https://example.com/a.png",
    });
  });

  it("getSlackChannel returns #name for public channels and Direct Message for DMs", async () => {
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const { resetSlackProfilesMemoryForTests, upsertSlackChannelProfile, getSlackChannel } =
      await import("@/lib/slack/profiles");
    resetSlackProfilesMemoryForTests();
    await upsertSlackChannelProfile({
      team_id: "T1",
      slack_channel_id: "C9",
      name: "sales",
      channel_type: "channel",
      last_resolved_at: new Date().toISOString(),
    });
    const channel = await getSlackChannel("T1", "C9");
    expect(channel.displayName).toBe("#sales");
    const dm = await getSlackChannel("T1", "D9");
    expect(dm.displayName).toBe("Direct Message");
  });

  it("handles missing bot token gracefully for channel resolve", async () => {
    const { resetEnvCacheForTests } = await import("@/lib/env");
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.SLACK_BOT_TOKEN = "";
    resetEnvCacheForTests();
    const { resetSlackProfilesMemoryForTests, resolveSlackChannelProfile } =
      await import("@/lib/slack/profiles");
    resetSlackProfilesMemoryForTests();
    const channel = await resolveSlackChannelProfile({
      teamId: "T1",
      slackChannelId: "C123",
      force: true,
    });
    expect(channel.resolve_error).toBe("missing_bot_token");
  });

  it("historical conversation labels use cached metadata by ID", async () => {
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const {
      resetSlackProfilesMemoryForTests,
      upsertSlackUserProfile,
      upsertSlackChannelProfile,
      formatResolvedUserLabel,
      formatResolvedChannelLabel,
      getCachedSlackUserProfile,
      getCachedSlackChannelProfile,
    } = await import("@/lib/slack/profiles");
    resetSlackProfilesMemoryForTests();

    await upsertSlackUserProfile({
      team_id: "T1",
      slack_user_id: "U042090LDFC",
      display_name: "Jackson Bridges",
      last_resolved_at: new Date().toISOString(),
    });
    await upsertSlackChannelProfile({
      team_id: "T1",
      slack_channel_id: "C0BDX025ALW",
      name: "general",
      last_resolved_at: new Date().toISOString(),
    });

    const user = await getCachedSlackUserProfile("T1", "U042090LDFC");
    const channel = await getCachedSlackChannelProfile("T1", "C0BDX025ALW");
    expect(formatResolvedUserLabel(user, "U042090LDFC")).toBe("Jackson Bridges");
    expect(formatResolvedChannelLabel(channel, "C0BDX025ALW")).toBe("#general");
  });
});
