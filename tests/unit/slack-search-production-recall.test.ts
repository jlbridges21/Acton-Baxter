import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { detectSlackSearchIntent, extractChannelMentions } from "@/lib/baxter-data/slack/intent";
import {
  nonSlackEvidenceSatisfiesQuestion,
  shouldForceSlackDespiteOtherEvidence,
} from "@/lib/baxter-data/slack/source-sufficiency";
import { resolveChannelFromDirectory } from "@/lib/baxter-data/slack/channels";
import { resolvePersonFromDirectory } from "@/lib/baxter-data/slack/users";
import { executeSlackSearchPlan } from "@/lib/baxter-data/slack/search";
import { retrieveSlackForAnswer } from "@/lib/baxter-data/slack/orchestrate";
import { capabilitiesFromScopes } from "@/lib/baxter-data/slack/permissions";
import { formatSlackRetrievalStatusForModel } from "@/lib/baxter-data/slack/retrieval-status";
import { planSlackSearch } from "@/lib/baxter-data/slack/query-plan";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  FIXTURE_TEAM_ID,
  fixtureChannels,
  fixtureMessages,
  fixtureUsers,
} from "../fixtures/slack/workspace";

describe("Slack production recall fixes", () => {
  it("detects say-last-in-channel as latest_message", () => {
    expect(
      detectSlackSearchIntent("what did Jess say last in the #project-management channel?"),
    ).toBe("latest_message");
    expect(detectSlackSearchIntent("What did James say last in the baxter channel?")).toBe(
      "latest_message",
    );
  });

  it("extracts baxter channel mentions", () => {
    expect(extractChannelMentions("last in the baxter channel")).toContain("baxter");
  });

  it("resolves James and #baxter", () => {
    expect(resolvePersonFromDirectory("James", [...fixtureUsers]).status).toBe("resolved");
    expect(resolveChannelFromDirectory("baxter channel", [...fixtureChannels]).status).toBe(
      "resolved",
    );
  });

  it("Knowledge without timeline does not satisfy when-will", () => {
    expect(
      nonSlackEvidenceSatisfiesQuestion("When will the RACI matrix be ready?", [
        "The RACI matrix is part of Acton’s process mapping.",
      ]),
    ).toBe(false);
    expect(shouldForceSlackDespiteOtherEvidence("When will the RACI matrix be ready?")).toBe(true);
  });

  it("Knowledge with Friday timeline can satisfy when-will", () => {
    expect(
      nonSlackEvidenceSatisfiesQuestion("When will the RACI matrix be ready?", [
        "Official completion date: ready for review Friday.",
      ]),
    ).toBe(true);
  });

  it("what-did questions are never satisfied by Knowledge alone", () => {
    expect(
      nonSlackEvidenceSatisfiesQuestion("What did Jess say last in #project-management?", [
        "Jess owns project management process documentation.",
      ]),
    ).toBe(false);
  });

  it("retrieval status prompt forbids capability promises", () => {
    const block = formatSlackRetrievalStatusForModel({
      status: "searched_no_results",
      intent: "latest_message",
      channel: "#project-management",
      person: "Jess",
      resultCount: 0,
      credentialPath: "bot_public",
      retrievalMethod: "conversations.history",
      employeeNote: "No matching message.",
    });
    expect(block).toContain("searched_no_results");
    expect(block.toLowerCase()).toContain("never advertise");
    expect(block).not.toMatch(/if slack search is enabled/i);
  });
});

describe("bot_public latest-message history", () => {
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

  it("selects James newest message in #baxter via conversations.history", async () => {
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

    const history = [
      fixtureMessages.jamesBaxterNewest,
      fixtureMessages.jacksonBaxter,
      fixtureMessages.jamesBaxterOldest,
    ];
    const result = await executeSlackSearchPlan({
      plan: planned.plan,
      credential: {
        token: "xoxb-test",
        tokenKind: "bot_public",
        slackUserId: "U_JACKSON",
        slackTeamId: FIXTURE_TEAM_ID,
        scopes: ["channels:history", "channels:read", "search:read.public"],
        actionToken: null,
        capabilities: capabilitiesFromScopes(
          ["channels:history", "channels:read", "search:read.public"],
          "bot_public",
          "partial",
        ),
      },
      deps: {
        callSlackApi: async (method) => {
          if (method === "conversations.history") {
            return {
              ok: true,
              data: { ok: true, messages: history, response_metadata: { next_cursor: "" } },
            };
          }
          if (method === "chat.getPermalink") {
            return {
              ok: true,
              data: {
                ok: true,
                permalink: "https://actonadu.slack.com/archives/C_BAXTER/p1719003600000100",
              },
            };
          }
          return { ok: false, error: "unexpected_method", data: {} };
        },
      },
    });

    expect(result.diagnostics.endpoint).toBe("conversations.history");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.text).toContain("OAuth scopes");
    expect(result.results[0]?.text).not.toContain("Testing the new Slack search");
  });

  it("selects Jess newest message in #project-management", async () => {
    const planned = await planSlackSearch({
      question: "what did Jess say last in the #project-management channel?",
      teamId: FIXTURE_TEAM_ID,
      deps: {
        listCachedUsers: async () => [...fixtureUsers],
        listCachedChannels: async () => [...fixtureChannels],
      },
    });
    expect(planned.plan.intent).toBe("latest_message");

    const history = [
      fixtureMessages.jessPmNewest,
      fixtureMessages.maxxPmNewest,
      fixtureMessages.jessPmOldest,
    ];
    const result = await executeSlackSearchPlan({
      plan: planned.plan,
      credential: {
        token: "xoxb-test",
        tokenKind: "bot_public",
        slackUserId: "U_JACKSON",
        slackTeamId: FIXTURE_TEAM_ID,
        scopes: ["channels:history"],
        actionToken: null,
        capabilities: capabilitiesFromScopes(["channels:history"], "bot_public", "partial"),
      },
      deps: {
        callSlackApi: async (method) => {
          if (method === "conversations.history") {
            return {
              ok: true,
              data: { ok: true, messages: history, response_metadata: { next_cursor: "" } },
            };
          }
          if (method === "chat.getPermalink") {
            return { ok: true, data: { ok: true, permalink: "https://example.slack.com/p1" } };
          }
          return { ok: false, error: "unexpected_method", data: {} };
        },
      },
    });

    expect(result.results[0]?.text).toContain("Design presentation moved to Thursday");
  });

  it("orchestrates bot_public without requiring user OAuth for public latest_message", async () => {
    const history = [
      fixtureMessages.jessPmNewest,
      fixtureMessages.maxxPmNewest,
      fixtureMessages.jessPmOldest,
    ];
    const result = await retrieveSlackForAnswer({
      question: "what did Jess say last in the #project-management channel?",
      requester: {
        slackUserId: "U_JACKSON",
        slackTeamId: FIXTURE_TEAM_ID,
        allowPublicOnlyFallback: true,
      },
      roleOverride: "primary",
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
            return { ok: true, data: { ok: true, permalink: "https://example.slack.com/p1" } };
          }
          return { ok: false, error: "unexpected_method", data: {} };
        },
      },
    });

    expect(result.retrievalStatus.status).toBe("results_found");
    expect(result.diagnostics.authorization).toBe("bot_public");
    expect(result.selected[0]?.text).toContain("Design presentation moved to Thursday");
    expect(result.retrievalStatusPrompt).not.toMatch(/if Slack Search is enabled/i);
  });

  it("returns searched_no_results instead of capability-promise auth for empty history", async () => {
    const result = await retrieveSlackForAnswer({
      question: "what did Jess say last in the #project-management channel?",
      requester: {
        slackUserId: "U_JACKSON",
        slackTeamId: FIXTURE_TEAM_ID,
        allowPublicOnlyFallback: true,
      },
      roleOverride: "primary",
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
              data: {
                ok: true,
                messages: [fixtureMessages.maxxPmNewest],
                response_metadata: { next_cursor: "" },
              },
            };
          }
          return { ok: false, error: "unexpected_method", data: {} };
        },
      },
    });

    expect(result.retrievalStatus.status).toBe("searched_no_results");
    expect(result.noResultsNote).toMatch(/couldn't find/i);
    expect(result.authNote).toBeNull();
  });
});
