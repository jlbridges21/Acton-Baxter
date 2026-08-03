import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";

describe("postEphemeralSlackMessage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.ENABLE_SLACK_INTEGRATION = "true";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_ALLOWED_TEAM_IDS = "T123";
    resetEnvCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("treats HTTP 200 + ok:false as failure with the Slack error code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: false, error: "invalid_thread_ts" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { postEphemeralSlackMessage } = await import("@/lib/slack/client");
    const result = await postEphemeralSlackMessage({
      channel: "C123",
      user: "U123",
      text: "Thanks for the feedback",
    });

    expect(result).toEqual({ ok: false, error: "invalid_thread_ts" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postEphemeral",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body?: string })?.body ?? "{}",
    ) as Record<string, unknown>;
    expect(body.channel).toBe("C123");
    expect(body.user).toBe("U123");
    expect(body).not.toHaveProperty("thread_ts");
  });

  it("returns ok:true when Slack body reports success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true, message_ts: "171.1" }),
    }) as unknown as typeof fetch;

    const { postEphemeralSlackMessage } = await import("@/lib/slack/client");
    const result = await postEphemeralSlackMessage({
      channel: "D123",
      user: "U123",
      text: "Thanks",
    });
    expect(result).toEqual({ ok: true, ts: "171.1" });
  });
});
