import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { detectSlackSearchIntent, extractChannelMentions } from "@/lib/baxter-data/slack/intent";
import {
  normalizeChannelQuery,
  resolveChannelFromDirectory,
} from "@/lib/baxter-data/slack/channels";
import { resolvePersonFromDirectory } from "@/lib/baxter-data/slack/users";
import { filterEvidenceByPlanIntegrity } from "@/lib/baxter-data/slack/integrity";
import { shouldResetSlackFollowUpContext } from "@/lib/baxter-data/slack/follow-up";
import { expandQuestionWithSlackContext } from "@/lib/baxter-data/slack/conversation-state";
import { retrieveSlackEvidence } from "@/lib/baxter-data/slack/evidence";
import { planSlackSearch } from "@/lib/baxter-data/slack/query-plan";
import { capabilitiesFromScopes } from "@/lib/baxter-data/slack/permissions";
import { selectSlackEvidenceForModel } from "@/lib/baxter-data/slack/select";
import { slackEvidenceToContextItems } from "@/lib/baxter-data/slack/to-context";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  FIXTURE_TEAM_ID,
  fixtureChannels,
  fixtureMessages,
  fixtureUsers,
} from "../fixtures/slack/workspace";

describe("channel normalization & resolution", () => {
  it("normalizes project-management variants", () => {
    expect(normalizeChannelQuery("#project-management")).toBe("project-management");
    expect(normalizeChannelQuery("the project management channel")).toBe("project-management");
    expect(normalizeChannelQuery("Project Management")).toBe("project-management");
  });

  it("normalizes baxter channel variants", () => {
    expect(normalizeChannelQuery("the Baxter channel")).toBe("baxter");
    expect(normalizeChannelQuery("#baxter")).toBe("baxter");
    expect(normalizeChannelQuery("baxter channel")).toBe("baxter");
  });

  it("resolves #project-management and baxter from directory", () => {
    expect(resolveChannelFromDirectory("#project-management", [...fixtureChannels]).status).toBe(
      "resolved",
    );
    expect(resolveChannelFromDirectory("the baxter channel", [...fixtureChannels]).status).toBe(
      "resolved",
    );
    const baxter = resolveChannelFromDirectory("baxter", [...fixtureChannels]);
    expect(baxter.status).toBe("resolved");
    if (baxter.status === "resolved") expect(baxter.channel.name).toBe("baxter");
  });

  it("never fuzzy-matches baxter to sales", () => {
    const result = resolveChannelFromDirectory("baxter", [...fixtureChannels]);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.channel.id).toBe("C_BAXTER");
  });

  it("extracts channel from about-phrasing", () => {
    expect(
      extractChannelMentions(
        "Tell me anything you can about what has been said in the baxter channel.",
      ),
    ).toContain("baxter");
  });

  it("detects channel_search for broad baxter summary", () => {
    expect(
      detectSlackSearchIntent(
        "Tell me anything you can about what has been said in the baxter channel.",
      ),
    ).toBe("channel_search");
  });
});

describe("person resolution", () => {
  it("resolves James uniquely", () => {
    const result = resolvePersonFromDirectory("James", [...fixtureUsers]);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.person.displayName).toBe("James Parks");
  });

  it("keeps Matt ambiguous", () => {
    expect(resolvePersonFromDirectory("Matt", [...fixtureUsers]).status).toBe("ambiguous");
  });
});

describe("wrong-channel integrity", () => {
  it("drops #sales evidence when plan requires #baxter", () => {
    const plan = {
      intent: "channel_search" as const,
      people: [],
      channels: [
        {
          id: "C_BAXTER",
          name: "baxter",
          displayLabel: "#baxter",
          teamId: FIXTURE_TEAM_ID,
          kind: "public_channel" as const,
          isPrivate: false,
        },
      ],
      keywords: [],
      phrases: [],
      decisionLanguage: [],
      timeRange: null,
      sort: "newest" as const,
      limit: 10,
      includeThreads: true,
      includeNearbyContext: true,
      naturalQuery: "Tell me about the baxter channel",
    };

    const sales = {
      sourceType: "slack" as const,
      messageTs: "1",
      threadTs: null,
      channelId: "C_SALES",
      channelName: "sales",
      channelKind: "public_channel" as const,
      authorId: "U_JAMES",
      authorName: "James",
      timestamp: "2026-07-15T12:00:00.000Z",
      text: "But if they click anything even business listing, I can see it",
      permalink: "https://example.slack.com/sales",
      isThreadReply: false,
      relevance: 0.99,
      contextMessages: [],
      clusterKey: "sales:1",
    };
    const baxter = {
      ...sales,
      messageTs: "2",
      channelId: "C_BAXTER",
      channelName: "baxter",
      text: "Testing OAuth scopes in baxter",
      permalink: "https://example.slack.com/baxter",
      relevance: 0.4,
      clusterKey: "baxter:2",
    };

    const filtered = filterEvidenceByPlanIntegrity([sales, baxter], plan);
    expect(filtered.kept).toHaveLength(1);
    expect(filtered.kept[0]?.channelId).toBe("C_BAXTER");
    expect(filtered.dropped).toBe(1);
    expect(filtered.reasons[0]).toMatch(/outside requested channel/i);

    const selected = selectSlackEvidenceForModel(filtered.kept, plan);
    const items = slackEvidenceToContextItems(selected, plan, 1);
    expect(items.every((i) => !i.contentExcerpt.includes("business listing"))).toBe(true);
    expect(
      items.every((i) => i.contentExcerpt.includes("#baxter") || i.sourceName?.includes("baxter")),
    ).toBe(true);
  });
});

describe("stale context reset", () => {
  it("resets when switching from #sales to baxter channel", () => {
    expect(
      shouldResetSlackFollowUpContext("Tell me about what has been said in the Baxter channel.", {
        topic: "web traffic",
        people: ["James"],
        channels: ["#sales"],
        timeRangeLabel: null,
        intent: "person_statement",
        refs: [],
        updatedAt: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it("does not append prior #sales when expanding a baxter question", () => {
    const expanded = expandQuestionWithSlackContext("Tell me anything about the baxter channel", {
      topic: "tracking",
      people: ["James"],
      channels: ["#sales"],
      timeRangeLabel: null,
      intent: "person_statement",
      refs: [],
      updatedAt: new Date().toISOString(),
    });
    expect(expanded).not.toMatch(/#sales/);
  });
});

describe("pipeline: baxter channel only", () => {
  beforeEach(() => {
    process.env.ENABLE_SLACK_SEARCH = "true";
    process.env.ENABLE_SLACK_INTEGRATION = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
  });
  afterEach(() => {
    resetEnvCacheForTests();
  });

  it("plans channel_search for baxter and retrieves only that channel", async () => {
    const planned = await planSlackSearch({
      question: "Tell me anything you can about what has been said in the baxter channel.",
      teamId: FIXTURE_TEAM_ID,
      deps: {
        listCachedUsers: async () => [...fixtureUsers],
        listCachedChannels: async () => [...fixtureChannels],
      },
    });
    expect(planned.plan.intent).toBe("channel_search");
    expect(planned.plan.channels[0]?.name).toBe("baxter");
    expect(planned.notFound.channels).toHaveLength(0);

    const history = [
      fixtureMessages.jamesBaxterNewest,
      fixtureMessages.jacksonBaxter,
      fixtureMessages.jamesBaxterOldest,
    ];

    const evidence = await retrieveSlackEvidence({
      question: "Tell me anything you can about what has been said in the baxter channel.",
      requester: {
        slackUserId: "U_JACKSON",
        slackTeamId: FIXTURE_TEAM_ID,
        allowPublicOnlyFallback: true,
      },
      deps: {
        listCachedUsers: async () => [...fixtureUsers],
        listCachedChannels: async () => [...fixtureChannels],
        resolveSearchCredential: async () => ({
          token: "xoxb-test",
          tokenKind: "bot_public",
          slackUserId: "U_JACKSON",
          slackTeamId: FIXTURE_TEAM_ID,
          scopes: ["channels:history"],
          actionToken: null,
          capabilities: capabilitiesFromScopes(["channels:history"], "bot_public", "partial"),
        }),
        callSlackApi: async (method) => {
          if (method === "conversations.history") {
            return {
              ok: true,
              data: { ok: true, messages: history, response_metadata: { next_cursor: "" } },
            };
          }
          if (method === "chat.getPermalink") {
            return { ok: true, data: { ok: true, permalink: "https://example.slack.com/p" } };
          }
          // If RTS were wrongly called with sales fixtures, fail the test
          if (method === "assistant.search.context") {
            return {
              ok: true,
              data: {
                ok: true,
                results: { messages: [fixtureMessages.salesDeckJess] },
              },
            };
          }
          return { ok: false, error: "unexpected", data: {} };
        },
      },
    });

    expect(evidence.plan?.channels[0]?.id).toBe("C_BAXTER");
    expect(evidence.results.every((r) => r.channelId === "C_BAXTER")).toBe(true);
    expect(evidence.results.every((r) => r.channelId !== "C_SALES")).toBe(true);
  });

  it("fails closed when explicit channel is missing from directory", async () => {
    const evidence = await retrieveSlackEvidence({
      question: "What did Jess say last in #project-management?",
      requester: {
        slackUserId: "U_JACKSON",
        slackTeamId: FIXTURE_TEAM_ID,
        allowPublicOnlyFallback: true,
      },
      deps: {
        listCachedUsers: async () => [...fixtureUsers],
        listCachedChannels: async () =>
          fixtureChannels.filter((c) => c.name !== "project-management"),
        resolveSearchCredential: async () => ({
          token: "xoxb-test",
          tokenKind: "bot_public",
          slackUserId: "U_JACKSON",
          slackTeamId: FIXTURE_TEAM_ID,
          scopes: ["channels:history"],
          actionToken: null,
          capabilities: capabilitiesFromScopes(["channels:history"], "bot_public", "partial"),
        }),
        callSlackApi: async () => ({
          ok: true,
          data: {
            ok: true,
            results: { messages: [fixtureMessages.salesDeckJess] },
          },
        }),
      },
    });

    expect(evidence.incomplete?.code).toBe("BAXTER_SLACK_CHANNEL_NOT_FOUND");
    expect(evidence.results).toHaveLength(0);
  });

  it("resolves James + baxter latest_message", async () => {
    const planned = await planSlackSearch({
      question: "What did James say last in the baxter channel?",
      teamId: FIXTURE_TEAM_ID,
      deps: {
        listCachedUsers: async () => [...fixtureUsers],
        listCachedChannels: async () => [...fixtureChannels],
      },
    });
    expect(planned.plan.intent).toBe("latest_message");
    expect(planned.plan.people[0]?.displayName).toMatch(/James/i);
    expect(planned.plan.channels[0]?.name).toBe("baxter");
  });
});

describe("directory refresh pagination helper", () => {
  it("paginates conversations.list across pages", async () => {
    const { refreshSlackWorkspaceDirectory } =
      await import("@/lib/baxter-data/slack/directory-sync");
    let channelPages = 0;
    const result = await refreshSlackWorkspaceDirectory({
      teamId: FIXTURE_TEAM_ID,
      token: "xoxb-test",
      deps: {
        callSlackApi: async (method, options) => {
          if (method === "users.list") {
            return {
              ok: true,
              data: {
                ok: true,
                members: [
                  {
                    id: "U_JAMES",
                    name: "james",
                    real_name: "James Parks",
                    deleted: false,
                    is_bot: false,
                    profile: { display_name: "James Parks", email: "james@actonadu.com" },
                  },
                ],
                response_metadata: { next_cursor: "" },
              },
            };
          }
          if (method === "conversations.list") {
            channelPages += 1;
            const cursor = String((options.body as { cursor?: string } | undefined)?.cursor ?? "");
            if (!cursor) {
              return {
                ok: true,
                data: {
                  ok: true,
                  channels: [
                    { id: "C_PAGE1", name: "alpha", is_private: false },
                    { id: "C_PAGE1B", name: "beta", is_private: false },
                  ],
                  response_metadata: { next_cursor: "PAGE2" },
                },
              };
            }
            return {
              ok: true,
              data: {
                ok: true,
                channels: [
                  { id: "C_PM", name: "project-management", is_private: false },
                  { id: "C_BAXTER", name: "baxter", is_private: false },
                ],
                response_metadata: { next_cursor: "" },
              },
            };
          }
          return { ok: false, error: "unexpected", data: {} };
        },
      },
    });

    expect(channelPages).toBe(2);
    expect(result.channelsUpserted).toBe(4);
    expect(result.paginationComplete).toBe(true);
    expect(result.publicChannels).toBe(4);
  });
});
