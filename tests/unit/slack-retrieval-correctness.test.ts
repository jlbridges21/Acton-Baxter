import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractChannelMentions, extractPersonQueries } from "@/lib/baxter-data/slack/intent";
import { resolveChannelFromDirectory } from "@/lib/baxter-data/slack/channels";
import { resolvePersonFromDirectory } from "@/lib/baxter-data/slack/users";
import { fetchLatestMessageInChannel } from "@/lib/baxter-data/slack/threads";
import { executeSlackSearchPlan } from "@/lib/baxter-data/slack/search";
import { planSlackSearch } from "@/lib/baxter-data/slack/query-plan";
import { capabilitiesFromScopes } from "@/lib/baxter-data/slack/permissions";
import { refreshSlackWorkspaceDirectory } from "@/lib/baxter-data/slack/directory-sync";
import { resetSlackProfilesMemoryForTests } from "@/lib/slack/profiles";
import { resetEnvCacheForTests } from "@/lib/env";
import type { SlackCredentialResolution, SlackQueryPlan } from "@/lib/baxter-data/slack/types";
import { FIXTURE_TEAM_ID, fixtureChannels, fixtureUsers } from "../fixtures/slack/workspace";

function botCred(kind: "bot_public" | "bot_with_action_token"): SlackCredentialResolution {
  const scopes = [
    "channels:history",
    "groups:history",
    "search:read.public",
    "search:read.private",
  ];
  return {
    token: "xoxb-test",
    tokenKind: kind,
    slackUserId: "U_BOT",
    slackTeamId: FIXTURE_TEAM_ID,
    scopes,
    actionToken: kind === "bot_with_action_token" ? "action-token-test" : null,
    capabilities: capabilitiesFromScopes(scopes, kind, "partial"),
  };
}

describe("Slack mention parsing", () => {
  it("extracts <#CHANNEL_ID> as authoritative channel ID", () => {
    const ids = extractChannelMentions("what did Jess say last in the <#C037407G02Z> channel?");
    expect(ids).toContain("C037407G02Z");
    expect(ids.some((id) => id.includes("<"))).toBe(false);
  });

  it("extracts <#C0BDX025ALW> for baxter mention markup", () => {
    expect(extractChannelMentions("what did James say last in <#C0BDX025ALW>?")).toContain(
      "C0BDX025ALW",
    );
  });

  it("extracts <@USER_ID> person mentions", () => {
    expect(extractPersonQueries("What did <@U01BJTAP389> say last in #baxter?")).toContain(
      "U01BJTAP389",
    );
  });

  it("resolves channel ID from directory without treating markup as a name", () => {
    const dir = [
      {
        id: "C037407G02Z",
        name: "project-management",
        displayLabel: "#project-management",
        teamId: FIXTURE_TEAM_ID,
        kind: "public_channel" as const,
        isPrivate: false,
        isArchived: false,
        isMember: true,
      },
    ];
    const mentions = extractChannelMentions("in <#C037407G02Z>");
    expect(resolveChannelFromDirectory(mentions[0]!, dir).status).toBe("resolved");
  });

  it("resolves user ID mentions", () => {
    const result = resolvePersonFromDirectory("U_JAMES", [...fixtureUsers]);
    expect(result.status).toBe("resolved");
  });
});

describe("private bot-member history", () => {
  it("does not skip bot history solely because channel is private", async () => {
    const plan: SlackQueryPlan = {
      intent: "latest_message",
      people: [
        {
          id: "U_JAMES",
          displayName: "James Parks",
          realName: "James Parks",
          username: "james",
          teamId: FIXTURE_TEAM_ID,
        },
      ],
      channels: [
        {
          id: "C_BAXTER",
          name: "baxter",
          displayLabel: "#baxter",
          teamId: FIXTURE_TEAM_ID,
          kind: "private_channel",
          isPrivate: true,
          isArchived: false,
          isMember: true,
        },
      ],
      keywords: [],
      phrases: [],
      decisionLanguage: [],
      timeRange: null,
      sort: "newest",
      limit: 5,
      includeThreads: true,
      includeNearbyContext: false,
      naturalQuery: "what did James say last in the baxter channel?",
    };

    const callSlackApi = vi.fn(async (method: string) => {
      if (method === "conversations.info") {
        return {
          ok: true,
          data: {
            channel: {
              id: "C_BAXTER",
              name: "baxter",
              is_private: true,
              is_archived: false,
              is_member: true,
            },
          },
        };
      }
      if (method === "conversations.history") {
        return {
          ok: true,
          data: {
            messages: [
              {
                type: "message",
                user: "U_OTHER",
                text: "earlier",
                ts: "1.0",
              },
              {
                type: "message",
                user: "U_JAMES",
                text: "latest from James",
                ts: "2.0",
              },
            ],
            response_metadata: { next_cursor: "" },
          },
        };
      }
      if (method === "chat.getPermalink") {
        return { ok: true, data: { permalink: "https://example.slack.com/archives/C_BAXTER/p2" } };
      }
      return { ok: false, error: "unexpected", data: {} };
    });

    const result = await fetchLatestMessageInChannel({
      credential: botCred("bot_public"),
      plan,
      deps: { callSlackApi },
    });

    expect(result.notes.some((n) => /Skipped bot history for private/i.test(n))).toBe(false);
    expect(result.message?.authorId).toBe("U_JAMES");
    expect(result.message?.text).toContain("latest from James");
    expect(result.accessDenied).toBeFalsy();
  });

  it("requires OAuth when private and bot is not a member", async () => {
    const plan: SlackQueryPlan = {
      intent: "latest_message",
      people: [
        {
          id: "U_JAMES",
          displayName: "James Parks",
          realName: "James Parks",
          username: "james",
          teamId: FIXTURE_TEAM_ID,
        },
      ],
      channels: [
        {
          id: "C_LEAD",
          name: "leadership",
          displayLabel: "#leadership",
          teamId: FIXTURE_TEAM_ID,
          kind: "private_channel",
          isPrivate: true,
          isArchived: false,
          isMember: false,
        },
      ],
      keywords: [],
      phrases: [],
      decisionLanguage: [],
      timeRange: null,
      sort: "newest",
      limit: 5,
      includeThreads: true,
      includeNearbyContext: false,
      naturalQuery: "what did James say last in leadership?",
    };

    const callSlackApi = vi.fn(async (method: string) => {
      if (method === "conversations.info") {
        return {
          ok: true,
          data: {
            channel: {
              id: "C_LEAD",
              name: "leadership",
              is_private: true,
              is_archived: false,
              is_member: false,
            },
          },
        };
      }
      if (method === "conversations.join") {
        throw new Error("must not join private channels");
      }
      return { ok: false, error: "unexpected", data: {} };
    });

    const result = await fetchLatestMessageInChannel({
      credential: botCred("bot_public"),
      plan,
      deps: { callSlackApi },
    });

    expect(result.accessDenied).toBe(true);
    expect(result.message).toBeNull();
    expect(callSlackApi.mock.calls.some((c) => c[0] === "conversations.join")).toBe(false);
  });
});

describe("archived channel exclusion", () => {
  it("does not history-fetch archived channels in topic public scan", async () => {
    const callSlackApi = vi.fn(async (method: string) => {
      if (method === "conversations.join" || method === "conversations.history") {
        throw new Error(`must not call ${method} for archived fallback`);
      }
      return { ok: false, error: "unexpected", data: {} };
    });

    const result = await executeSlackSearchPlan({
      plan: {
        intent: "topic_search",
        people: [],
        channels: [],
        keywords: ["raci", "matrix"],
        phrases: ["RACI matrix"],
        decisionLanguage: [],
        timeRange: null,
        sort: "newest",
        limit: 10,
        includeThreads: false,
        includeNearbyContext: false,
        naturalQuery: "When will the RACI matrix be ready?",
      },
      credential: botCred("bot_public"),
      deps: {
        callSlackApi,
        listCachedChannels: async () => [
          {
            id: "C_ARCH",
            name: "das-tool",
            displayLabel: "#das-tool",
            teamId: FIXTURE_TEAM_ID,
            kind: "public_channel",
            isPrivate: false,
            isArchived: true,
            isMember: false,
          },
        ],
      },
    });

    expect(result.incomplete).toBeNull();
    expect(result.results).toEqual([]);
    expect(
      result.diagnostics.notes.some((n) =>
        /bounded public-channel scan|no public channel/i.test(n),
      ),
    ).toBe(true);
    expect(callSlackApi).not.toHaveBeenCalled();
  });

  it("scans public channels for RACI without requiring user OAuth", async () => {
    const callSlackApi = vi.fn(
      async (method: string, options?: { body?: Record<string, unknown> }) => {
        if (method === "conversations.history") {
          expect(options?.body?.channel).toBe("C_PM");
          return {
            ok: true,
            data: {
              messages: [
                {
                  user: "U_JESS",
                  text: "Latest on the RACI matrix: ready for review Friday.",
                  ts: "1700000001.000100",
                },
              ],
            },
          };
        }
        return { ok: false, error: "unexpected", data: {} };
      },
    );

    const result = await executeSlackSearchPlan({
      plan: {
        intent: "latest_update",
        people: [],
        channels: [],
        keywords: ["raci", "matrix"],
        phrases: ["RACI matrix"],
        decisionLanguage: [],
        timeRange: null,
        sort: "newest",
        limit: 10,
        includeThreads: false,
        includeNearbyContext: false,
        naturalQuery: "What is the latest update on the RACI matrix?",
      },
      credential: {
        ...botCred("bot_public"),
        slackTeamId: FIXTURE_TEAM_ID,
      },
      deps: {
        callSlackApi,
        listCachedChannels: async () => [
          {
            id: "C_PM",
            name: "project-management",
            displayLabel: "#project-management",
            teamId: FIXTURE_TEAM_ID,
            kind: "public_channel",
            isPrivate: false,
            isArchived: false,
            isMember: true,
          },
        ],
      },
    });

    expect(result.incomplete).toBeNull();
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.text).toMatch(/RACI/i);
    expect(result.incomplete?.code).not.toBe("BAXTER_SLACK_SEARCH_AUTH_REQUIRED");
  });
});

describe("action_token RTS", () => {
  it("calls assistant.search.context with action_token for topic queries", async () => {
    const callSlackApi = vi.fn(
      async (method: string, options: { body?: Record<string, unknown> }) => {
        if (method === "assistant.search.context") {
          expect(options.body?.action_token).toBe("action-token-test");
          return {
            ok: true,
            data: {
              results: {
                messages: [
                  {
                    channel: { id: "C_PM", name: "project-management" },
                    author_user_id: "U_JESS",
                    text: "RACI matrix will be ready Friday",
                    ts: "10.0",
                    permalink: "https://example.slack.com/p",
                  },
                ],
              },
            },
          };
        }
        return { ok: false, error: "unexpected", data: {} };
      },
    );

    const result = await executeSlackSearchPlan({
      plan: {
        intent: "latest_update",
        people: [],
        channels: [],
        keywords: ["raci", "matrix"],
        phrases: ["RACI matrix"],
        decisionLanguage: [],
        timeRange: null,
        sort: "newest",
        limit: 10,
        includeThreads: false,
        includeNearbyContext: false,
        naturalQuery: "When will the RACI matrix be ready?",
      },
      credential: botCred("bot_with_action_token"),
      deps: { callSlackApi },
    });

    expect(callSlackApi.mock.calls.some((c) => c[0] === "assistant.search.context")).toBe(true);
    expect(result.diagnostics.endpoint).toBe("assistant.search.context");
    expect(result.results.length).toBeGreaterThan(0);
  });
});

describe("directory pagination cursor requests", () => {
  beforeEach(() => {
    resetEnvCacheForTests();
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetSlackProfilesMemoryForTests();
  });

  it("sends advancing cursors on conversations.list pages", async () => {
    const cursorsSent: Array<string | undefined> = [];
    await refreshSlackWorkspaceDirectory({
      teamId: FIXTURE_TEAM_ID,
      token: "xoxb-test",
      deps: {
        callSlackApi: async (method, options) => {
          if (method === "users.list") {
            return {
              ok: true,
              data: { members: [], response_metadata: { next_cursor: "" } },
            };
          }
          if (method === "conversations.list") {
            const cursor =
              typeof options.body?.cursor === "string" ? options.body.cursor : undefined;
            cursorsSent.push(cursor);
            if (!cursor) {
              return {
                ok: true,
                data: {
                  channels: [{ id: "C1", name: "a", is_private: false, is_archived: false }],
                  response_metadata: { next_cursor: "PAGE2" },
                },
              };
            }
            if (cursor === "PAGE2") {
              return {
                ok: true,
                data: {
                  channels: [{ id: "C2", name: "b", is_private: true, is_archived: false }],
                  response_metadata: { next_cursor: "PAGE3" },
                },
              };
            }
            if (cursor === "PAGE3") {
              return {
                ok: true,
                data: {
                  channels: [{ id: "C3", name: "c", is_private: false, is_archived: true }],
                  response_metadata: { next_cursor: "" },
                },
              };
            }
          }
          return { ok: false, error: "unexpected", data: {} };
        },
      },
    });

    expect(cursorsSent).toEqual([undefined, "PAGE2", "PAGE3"]);
  });

  it("treats useful cursor_cycle as partial success with discovered channels retained", async () => {
    const result = await refreshSlackWorkspaceDirectory({
      teamId: FIXTURE_TEAM_ID,
      token: "xoxb-test",
      deps: {
        callSlackApi: async (method, options) => {
          if (method === "users.list") {
            return {
              ok: true,
              data: { members: [], response_metadata: { next_cursor: "" } },
            };
          }
          if (method === "conversations.list") {
            const cursor =
              typeof options.body?.cursor === "string" ? options.body.cursor : undefined;
            if (!cursor) {
              return {
                ok: true,
                data: {
                  channels: [
                    { id: "C1", name: "one", is_private: false, is_archived: false },
                    { id: "C2", name: "two", is_private: false, is_archived: false },
                  ],
                  response_metadata: { next_cursor: "LOOP" },
                },
              };
            }
            // Same channel IDs again with a new next cursor → duplicate page detection
            return {
              ok: true,
              data: {
                channels: [
                  { id: "C1", name: "one", is_private: false, is_archived: false },
                  { id: "C2", name: "two", is_private: false, is_archived: false },
                ],
                response_metadata: { next_cursor: "LOOP2" },
              },
            };
          }
          return { ok: false, error: "unexpected", data: {} };
        },
      },
    });

    expect(result.channelsUpserted).toBeGreaterThan(0);
    expect(result.incompleteReason).toBe("cursor_cycle");
    expect(result.paginationComplete).toBe(false);
  });
});

describe("plan with Slack markup", () => {
  it("plans latest_message with mention IDs", async () => {
    const planned = await planSlackSearch({
      question: "what did Jess say last in the <#C_PM> channel?",
      teamId: FIXTURE_TEAM_ID,
      deps: {
        listCachedUsers: async () => [...fixtureUsers],
        listCachedChannels: async () =>
          fixtureChannels.map((c) =>
            c.name === "project-management" ? { ...c, id: "C_PM" } : { ...c },
          ),
      },
    });
    expect(planned.plan.channels[0]?.id).toBe("C_PM");
    expect(planned.notFound.channels).toHaveLength(0);
  });
});
