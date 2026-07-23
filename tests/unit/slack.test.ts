import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SlackSignatureError, verifySlackRequest } from "@/lib/slack/verify";
import { buildSlackCompletionMessage, buildSlackFailureMessage } from "@/lib/slack/messages";
import { resetEnvCacheForTests } from "@/lib/env";

function sign(secret: string, timestamp: string, body: string) {
  const base = `v0:${timestamp}:${body}`;
  const digest = createHmac("sha256", secret).update(base).digest("hex");
  return `v0=${digest}`;
}

describe("Slack security and messages", () => {
  it("accepts a valid signature", () => {
    const secret = "test-signing-secret";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = "team_id=T123&text=655+13th+St";
    const signature = sign(secret, timestamp, body);
    expect(() =>
      verifySlackRequest({
        signingSecret: secret,
        signature,
        timestamp,
        rawBody: body,
      }),
    ).not.toThrow();
  });

  it("rejects an invalid signature", () => {
    expect(() =>
      verifySlackRequest({
        signingSecret: "secret",
        signature: "v0=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        timestamp: String(Math.floor(Date.now() / 1000)),
        rawBody: "x=1",
      }),
    ).toThrow(SlackSignatureError);
  });

  it("rejects expired timestamps", () => {
    const secret = "secret";
    const timestamp = String(Math.floor(Date.now() / 1000) - 60 * 10);
    const body = "x=1";
    const signature = sign(secret, timestamp, body);
    expect(() =>
      verifySlackRequest({
        signingSecret: secret,
        signature,
        timestamp,
        rawBody: body,
      }),
    ).toThrow(SlackSignatureError);
  });

  it("builds completion messages without owner mailing or PDF upload claims", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();

    const message = buildSlackCompletionMessage({
      standardizedAddress: "655 13th St, San Jose, CA 95112",
      apn: "472-22-019",
      jurisdiction: "San Jose",
      summarySnippet: "Sources located with one lot-size inconsistency to verify.",
      reportId: "00000000-0000-4000-8000-000000000099",
      conflictCount: 1,
    });
    const text = JSON.stringify(message);
    expect(text).toContain("View full report");
    expect(text).not.toMatch(/mailing/i);
    expect(text.toLowerCase()).not.toContain("upload pdf");
  });

  it("builds failure messages", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();

    const message = buildSlackFailureMessage({
      standardizedAddress: "bad address",
      reportId: "00000000-0000-4000-8000-000000000099",
      errorMessage: "Could not identify the property.",
    });
    expect(JSON.stringify(message)).toContain("Could not identify");
  });

  it("exports response_url poster for async slash-command follow-ups", async () => {
    const { postSlackResponseUrl } = await import("@/lib/slack/commands");
    expect(typeof postSlackResponseUrl).toBe("function");
  });
});
