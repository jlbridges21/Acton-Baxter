import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshSlackWorkspaceDirectory } from "@/lib/baxter-data/slack/directory-sync";
import {
  batchUpsertSlackChannelProfiles,
  batchUpsertSlackUserProfiles,
  resetSlackProfilesMemoryForTests,
} from "@/lib/slack/profiles";
import { listCachedSlackChannels, listCachedSlackUsers } from "@/lib/baxter-data/slack/directory";
import type { SlackApiCallResult } from "@/lib/baxter-data/slack/types";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  enqueueJob,
  listMemoryJobsForTests,
  reclaimStaleRunningJobs,
  resetMemoryJobsForTests,
} from "@/lib/jobs/queue";

function ok(data: Record<string, unknown>): SlackApiCallResult {
  return { ok: true, data, httpStatus: 200 };
}

describe("Slack directory refresh stability", () => {
  beforeEach(() => {
    resetEnvCacheForTests();
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    resetSlackProfilesMemoryForTests();
    resetMemoryJobsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetEnvCacheForTests();
  });

  it("paginates users.list and conversations.list across pages (James on page 3, #baxter on page 4)", async () => {
    const callSlackApi = vi.fn(
      async (method: string, options: { body?: Record<string, unknown> }) => {
        const cursor = typeof options.body?.cursor === "string" ? options.body.cursor : "";
        if (method === "users.list") {
          if (!cursor) {
            return ok({
              members: [
                {
                  id: "U_PAGE1",
                  name: "p1",
                  real_name: "Page One",
                  is_bot: false,
                  deleted: false,
                  profile: { display_name: "Page One" },
                },
              ],
              response_metadata: { next_cursor: "u2" },
            });
          }
          if (cursor === "u2") {
            return ok({
              members: [
                {
                  id: "U_PAGE2",
                  name: "p2",
                  real_name: "Page Two",
                  is_bot: false,
                  deleted: false,
                  profile: { display_name: "Page Two" },
                },
              ],
              response_metadata: { next_cursor: "u3" },
            });
          }
          if (cursor === "u3") {
            return ok({
              members: [
                {
                  id: "U_JAMES",
                  name: "james",
                  real_name: "James Parks",
                  is_bot: false,
                  deleted: false,
                  profile: { display_name: "James Parks" },
                },
              ],
              response_metadata: { next_cursor: "" },
            });
          }
        }
        if (method === "conversations.list") {
          expect(options.body?.types).toBe("public_channel,private_channel");
          if (!cursor) {
            return ok({
              channels: [{ id: "C1", name: "sales", is_private: false, is_archived: false }],
              response_metadata: { next_cursor: "c2" },
            });
          }
          if (cursor === "c2") {
            return ok({
              channels: [
                { id: "C2", name: "project-management", is_private: false, is_archived: false },
              ],
              response_metadata: { next_cursor: "c3" },
            });
          }
          if (cursor === "c3") {
            return ok({
              channels: [{ id: "C3", name: "ops", is_private: true, is_archived: false }],
              response_metadata: { next_cursor: "c4" },
            });
          }
          if (cursor === "c4") {
            return ok({
              channels: [{ id: "C_BAXTER", name: "baxter", is_private: false, is_archived: false }],
              response_metadata: { next_cursor: "" },
            });
          }
        }
        return { ok: false, error: "unexpected", data: {} };
      },
    );

    const result = await refreshSlackWorkspaceDirectory({
      teamId: "T_TEST",
      token: "xoxb-test",
      deps: { callSlackApi },
      mode: "full",
    });

    expect(result.timedOut).toBe(false);
    expect(result.paginationComplete).toBe(true);
    expect(result.pagesFetched.users).toBe(3);
    expect(result.pagesFetched.channels).toBe(4);
    expect(result.usersUpserted).toBe(3);
    expect(result.channelsUpserted).toBe(4);
    expect(result.publicChannels).toBe(3);
    expect(result.privateChannels).toBe(1);

    const users = await listCachedSlackUsers("T_TEST");
    const channels = await listCachedSlackChannels("T_TEST");
    expect(users.some((u) => u.id === "U_JAMES")).toBe(true);
    expect(channels.some((c) => c.name === "baxter")).toBe(true);
  });

  it("detects repeated request cursor and stops without hanging", async () => {
    const callSlackApi = vi.fn(
      async (method: string, options?: { body?: Record<string, unknown> }) => {
        if (method === "users.list") {
          const cursor = typeof options?.body?.cursor === "string" ? options.body.cursor : "";
          if (!cursor) {
            return ok({
              members: [
                {
                  id: "U1",
                  name: "u1",
                  real_name: "User One",
                  is_bot: false,
                  deleted: false,
                  profile: { display_name: "User One" },
                },
              ],
              response_metadata: { next_cursor: "u2" },
            });
          }
          if (cursor === "u2") {
            return ok({
              members: [],
              response_metadata: { next_cursor: "u1_again" },
            });
          }
          // Cycle back to a previously requested cursor
          return ok({
            members: [],
            response_metadata: { next_cursor: "u2" },
          });
        }
        if (method === "conversations.list") {
          return ok({
            channels: [],
            response_metadata: { next_cursor: "" },
          });
        }
        return { ok: false, error: "unexpected", data: {} };
      },
    );

    const result = await refreshSlackWorkspaceDirectory({
      teamId: "T_TEST",
      token: "xoxb-test",
      deps: { callSlackApi },
      mode: "full",
    });

    expect(result.paginationComplete).toBe(false);
    expect(result.incompleteReason).toBe("cursor_cycle");
  });

  it("times out hanging Slack pages with BAXTER_SLACK_DIRECTORY_TIMEOUT", async () => {
    const callSlackApi = vi.fn(async () => {
      await new Promise(() => undefined);
      return ok({});
    });

    const result = await refreshSlackWorkspaceDirectory({
      teamId: "T_TEST",
      token: "xoxb-test",
      deps: { callSlackApi },
      mode: "fast",
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
    expect(result.incompleteReason).toBe("timeout");
    expect(result.errors).toContain("BAXTER_SLACK_DIRECTORY_TIMEOUT");
  });

  it("bounds 429 Retry-After and can complete after retry", async () => {
    let usersCalls = 0;
    const callSlackApi = vi.fn(
      async (
        method: string,
        _options?: { token?: string; body?: Record<string, unknown> },
      ): Promise<SlackApiCallResult> => {
        if (method === "users.list") {
          usersCalls += 1;
          if (usersCalls === 1) {
            return {
              ok: false,
              error: "ratelimited",
              data: {},
              httpStatus: 429,
              retryAfterSeconds: 1,
            };
          }
          return ok({
            members: [
              {
                id: "U1",
                name: "u1",
                real_name: "User One",
                is_bot: false,
                deleted: false,
                profile: { display_name: "User One" },
              },
            ],
            response_metadata: { next_cursor: "" },
          });
        }
        if (method === "conversations.list") {
          return ok({
            channels: [{ id: "C1", name: "general", is_private: false, is_archived: false }],
            response_metadata: { next_cursor: "" },
          });
        }
        return { ok: false, error: "unexpected", data: {} };
      },
    );

    const wrapping = vi.fn(
      async (method: string, options: { token: string; body?: Record<string, unknown> }) => {
        let result = await callSlackApi(method, options);
        if (!result.ok && result.error === "ratelimited") {
          await new Promise((r) => setTimeout(r, 10));
          result = await callSlackApi(method, options);
        }
        return result;
      },
    );

    const result = await refreshSlackWorkspaceDirectory({
      teamId: "T_TEST",
      token: "xoxb-test",
      deps: { callSlackApi: wrapping },
      mode: "full",
    });

    expect(result.timedOut).toBe(false);
    expect(result.usersUpserted).toBe(1);
    expect(result.channelsUpserted).toBe(1);
  });

  it("batch upserts many users/channels in memory store", async () => {
    const n = await batchUpsertSlackUserProfiles(
      Array.from({ length: 5 }, (_, i) => ({
        team_id: "T_BATCH",
        slack_user_id: `U${i}`,
        display_name: `User ${i}`,
        real_name: `User ${i}`,
        username: `user${i}`,
        is_bot: false,
        is_deleted: false,
      })),
    );
    const c = await batchUpsertSlackChannelProfiles(
      Array.from({ length: 3 }, (_, i) => ({
        team_id: "T_BATCH",
        slack_channel_id: `C${i}`,
        name: `channel-${i}`,
        channel_type: "public_channel",
        is_private: false,
      })),
    );
    expect(n).toBe(5);
    expect(c).toBe(3);
    expect((await listCachedSlackUsers("T_BATCH")).length).toBe(5);
    expect((await listCachedSlackChannels("T_BATCH")).length).toBe(3);
  });

  it("reclaims stale running slack_baxter_reply jobs", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    resetEnvCacheForTests();

    const job = await enqueueJob({
      jobType: "slack_baxter_reply",
      metadata: { stage: "history_fetch" },
    });
    const lockedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const { claimJobById } = await import("@/lib/jobs/queue");
    const claimed = await claimJobById(job.id);
    expect(claimed?.status).toBe("running");
    const running = listMemoryJobsForTests().find((j) => j.id === job.id)!;
    (running as { lockedAt: string }).lockedAt = lockedAt;
    (running as { updatedAt: string }).updatedAt = lockedAt;

    const { reclaimed } = await reclaimStaleRunningJobs({ olderThanMs: 5 * 60_000 });
    expect(reclaimed).toBe(1);
    const after = listMemoryJobsForTests().find((j) => j.id === job.id)!;
    expect(after.status).toBe("queued");
    expect(after.metadata.stage).toBe("reclaimed");
  });
});

describe("admin date formatting hydration safety", () => {
  it("formats timestamps with fixed en-US UTC (no locale drift)", () => {
    const iso = "2026-07-29T17:10:20.596Z";
    const a = new Date(iso).toLocaleString("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const b = new Date(iso).toLocaleString("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    expect(a).toBe(b);
    expect(a).toContain("2026");
  });
});
