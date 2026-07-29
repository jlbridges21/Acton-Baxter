import { describe, expect, it } from "vitest";
import {
  detectSlackSearchIntent,
  extractChannelMentions,
  extractPersonQueries,
  getDecisionLanguageTerms,
} from "@/lib/baxter-data/slack/intent";
import { parseSlackTimeRange } from "@/lib/baxter-data/slack/temporal";
import { buildSlackSearchQuery, planSlackSearch } from "@/lib/baxter-data/slack/query-plan";
import { resolvePersonFromDirectory } from "@/lib/baxter-data/slack/users";
import { resolveChannelFromDirectory } from "@/lib/baxter-data/slack/channels";
import { mapSlackSearchApiError, SLACK_SEARCH_ERROR_CODES } from "@/lib/baxter-data/slack/errors";
import {
  assertNoForeignDmLeak,
  capabilitiesFromScopes,
  filterEvidenceByAccess,
} from "@/lib/baxter-data/slack/permissions";
import {
  groupEvidenceByAuthor,
  groupEvidenceIntoClusters,
  normalizeSearchMessage,
} from "@/lib/baxter-data/slack/normalize";
import { executeSlackSearchPlan } from "@/lib/baxter-data/slack/search";
import { retrieveSlackEvidence } from "@/lib/baxter-data/slack/evidence";
import { SLACK_SOURCE_TYPE } from "@/lib/baxter-data/slack/types";
import {
  FIXTURE_TEAM_ID,
  fixtureChannels,
  fixtureMessages,
  fixtureUsers,
} from "../fixtures/slack/workspace";

const now = new Date("2024-06-25T15:00:00.000Z");

function directoryDeps() {
  return {
    listCachedUsers: async () => [...fixtureUsers],
    listCachedChannels: async () => [...fixtureChannels],
    now: () => now,
  };
}

describe("Slack search intents", () => {
  it("detects person_statement", () => {
    expect(
      detectSlackSearchIntent("What did Jess say about the design presentation last week?"),
    ).toBe("person_statement");
  });

  it("detects latest_message", () => {
    expect(detectSlackSearchIntent("What was Maxx's last message in #project-management?")).toBe(
      "latest_message",
    );
  });

  it("detects decision_search", () => {
    expect(detectSlackSearchIntent("When did we decide to change the PEM process?")).toBe(
      "decision_search",
    );
  });

  it("detects latest_update", () => {
    expect(detectSlackSearchIntent("What is the latest on the RACI matrix?")).toBe("latest_update");
  });

  it("detects latest_update for when-will-ready timing questions", () => {
    expect(detectSlackSearchIntent("When will the RACI matrix be ready?")).toBe("latest_update");
  });

  it("detects mention_search", () => {
    expect(detectSlackSearchIntent("Who mentioned changing the sales presentation?")).toBe(
      "mention_search",
    );
  });

  it("detects time_window_summary", () => {
    expect(detectSlackSearchIntent("What happened last week with the Morgan project?")).toBe(
      "time_window_summary",
    );
  });
});

describe("Slack temporal parsing", () => {
  it("parses last week", () => {
    const range = parseSlackTimeRange("What happened last week?", now);
    expect(range?.label).toBe("last week");
    expect(range?.fromIso).toBeTruthy();
  });

  it("parses yesterday", () => {
    expect(parseSlackTimeRange("Did anyone talk yesterday?", now)?.label).toBe("yesterday");
  });

  it("parses recently as bounded window", () => {
    expect(parseSlackTimeRange("any updates recently?", now)?.label).toContain("recently");
  });
});

describe("Person and channel resolution", () => {
  it("resolves Jess and Jackson", () => {
    expect(resolvePersonFromDirectory("Jess", [...fixtureUsers]).status).toBe("resolved");
    expect(resolvePersonFromDirectory("Jackson", [...fixtureUsers]).status).toBe("resolved");
    const jackson = resolvePersonFromDirectory("Jackson Bridges", [...fixtureUsers]);
    expect(jackson.status).toBe("resolved");
    if (jackson.status === "resolved") {
      expect(jackson.person.displayName).toBe("Jackson Bridges");
    }
  });

  it("returns ambiguity for Matt", () => {
    const result = resolvePersonFromDirectory("Matt", [...fixtureUsers]);
    expect(result.status).toBe("ambiguous");
  });

  it("resolves project-management aliases", () => {
    expect(resolveChannelFromDirectory("#project-management", [...fixtureChannels]).status).toBe(
      "resolved",
    );
    expect(resolveChannelFromDirectory("project management", [...fixtureChannels]).status).toBe(
      "resolved",
    );
    expect(resolveChannelFromDirectory("pm channel", [...fixtureChannels]).status).toBe("resolved");
  });

  it("extracts person and channel queries", () => {
    expect(extractPersonQueries("What did Jess say about design?")).toContain("Jess");
    expect(extractChannelMentions("last message in #project-management")).toContain(
      "project-management",
    );
  });
});

describe("Slack query plan", () => {
  it("plans person statement with time range", async () => {
    const planned = await planSlackSearch({
      question: "What did Jess say about the design presentation last week?",
      teamId: FIXTURE_TEAM_ID,
      deps: directoryDeps(),
      now,
    });
    expect(planned.plan.intent).toBe("person_statement");
    expect(planned.plan.people[0]?.displayName).toBe("Jess");
    expect(planned.plan.timeRange?.label).toBe("last week");
    expect(planned.plan.keywords.join(" ")).toMatch(/design|presentation/);
    const query = buildSlackSearchQuery(planned.plan);
    expect(query).toContain("from:<@U_JESS>");
  });

  it("plans latest message for Maxx in PM", async () => {
    const planned = await planSlackSearch({
      question: "What was Maxx's last message in #project-management?",
      teamId: FIXTURE_TEAM_ID,
      deps: directoryDeps(),
      now,
    });
    expect(planned.plan.intent).toBe("latest_message");
    expect(planned.plan.sort).toBe("newest");
    expect(planned.plan.limit).toBe(1);
    expect(planned.plan.channels[0]?.name).toBe("project-management");
  });

  it("includes decision language for decision_search", async () => {
    const planned = await planSlackSearch({
      question: "When did we decide to use option B?",
      teamId: FIXTURE_TEAM_ID,
      deps: directoryDeps(),
      now,
    });
    expect(planned.plan.intent).toBe("decision_search");
    expect(planned.plan.decisionLanguage.length).toBeGreaterThan(0);
    expect(getDecisionLanguageTerms()).toContain("agreed");
  });
});

describe("Normalization and clustering", () => {
  it("normalizes search hits with permalink and slack source type", () => {
    const evidence = normalizeSearchMessage(fixtureMessages.jessDesignPresentation);
    expect(evidence?.sourceType).toBe(SLACK_SOURCE_TYPE);
    expect(evidence?.authorName).toBe("Jess");
    expect(evidence?.permalink).toContain("slack.com");
    expect(evidence?.channelName).toBe("design");
  });

  it("groups mention results by author", () => {
    const a = normalizeSearchMessage(fixtureMessages.salesDeckJess)!;
    const b = normalizeSearchMessage(fixtureMessages.salesDeckKevin)!;
    const grouped = groupEvidenceByAuthor([a, b]);
    expect(grouped.get("Jess")?.length).toBe(1);
    expect(grouped.get("Kevin")?.length).toBe(1);
  });

  it("clusters thread messages", () => {
    const a = normalizeSearchMessage(fixtureMessages.kevinOptionB)!;
    const b = normalizeSearchMessage(fixtureMessages.milanAgreed)!;
    const clusters = groupEvidenceIntoClusters([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.messages).toHaveLength(2);
  });
});

describe("Authorization", () => {
  it("maps API errors to stable codes", () => {
    expect(mapSlackSearchApiError("ratelimited")).toBe(SLACK_SEARCH_ERROR_CODES.RATE_LIMITED);
    expect(mapSlackSearchApiError("missing_scope")).toBe(SLACK_SEARCH_ERROR_CODES.SCOPE_MISSING);
  });

  it("filters private channel evidence for public-only capabilities", () => {
    const caps = capabilitiesFromScopes(["search:read.public"], "user", "partial");
    const leadership = normalizeSearchMessage(fixtureMessages.leadershipSecret)!;
    const design = normalizeSearchMessage(fixtureMessages.jessDesignPresentation)!;
    const filtered = filterEvidenceByAccess([leadership, design], caps);
    expect(filtered.map((r) => r.channelId)).toEqual(["C_DESIGN"]);
  });

  it("blocks foreign DM leakage when token user mismatches requester", () => {
    const caps = capabilitiesFromScopes(
      ["search:read.public", "search:read.im"],
      "user",
      "configured",
    );
    const check = assertNoForeignDmLeak({
      evidenceChannelIds: ["D_BC"],
      evidenceKinds: ["im"],
      requesterSlackUserId: "U_JACKSON",
      tokenSlackUserId: "U_KEVIN",
      capabilities: caps,
    });
    expect(check.ok).toBe(false);
  });
});

describe("Search execution with mocked Slack API", () => {
  it("retrieves Jess design presentation evidence", async () => {
    const planned = await planSlackSearch({
      question: "What did Jess say about the design presentation last week?",
      teamId: FIXTURE_TEAM_ID,
      deps: directoryDeps(),
      now,
    });

    const credential = {
      token: "xoxp-test",
      tokenKind: "user" as const,
      slackUserId: "U_JACKSON",
      slackTeamId: FIXTURE_TEAM_ID,
      scopes: ["search:read.public", "channels:history"],
      capabilities: capabilitiesFromScopes(
        ["search:read.public", "channels:history"],
        "user",
        "configured",
      ),
    };

    const executed = await executeSlackSearchPlan({
      plan: planned.plan,
      credential,
      deps: {
        callSlackApi: async (method) => {
          if (method === "assistant.search.context") {
            return {
              ok: true,
              data: {
                ok: true,
                results: { messages: [fixtureMessages.jessDesignPresentation] },
                response_metadata: { next_cursor: "" },
              },
            };
          }
          if (method === "chat.getPermalink") {
            return {
              ok: true,
              data: { ok: true, permalink: fixtureMessages.jessDesignPresentation.permalink },
            };
          }
          return { ok: false, error: "unexpected", data: {} };
        },
      },
    });

    expect(executed.results[0]?.text).toContain("design presentation");
    expect(executed.results[0]?.authorName).toBe("Jess");
    expect(executed.diagnostics.endpoint).toBe("assistant.search.context");
  });

  it("returns exact newest Maxx message via conversations.history", async () => {
    const planned = await planSlackSearch({
      question: "What was Maxx's last message in #project-management?",
      teamId: FIXTURE_TEAM_ID,
      deps: directoryDeps(),
      now,
    });

    const credential = {
      token: "xoxp-test",
      tokenKind: "user" as const,
      slackUserId: "U_JACKSON",
      slackTeamId: FIXTURE_TEAM_ID,
      scopes: ["search:read.public", "channels:history"],
      capabilities: capabilitiesFromScopes(
        ["search:read.public", "channels:history"],
        "user",
        "configured",
      ),
    };

    const executed = await executeSlackSearchPlan({
      plan: planned.plan,
      credential,
      deps: {
        callSlackApi: async (method) => {
          if (method === "conversations.history") {
            return {
              ok: true,
              data: {
                ok: true,
                messages: [
                  fixtureMessages.maxxPmNewest,
                  fixtureMessages.maxxPmMiddle,
                  fixtureMessages.maxxPmOldest,
                ],
                response_metadata: { next_cursor: "" },
              },
            };
          }
          if (method === "chat.getPermalink") {
            return {
              ok: true,
              data: {
                ok: true,
                permalink: "https://actonadu.slack.com/archives/C_PM/p1719100000000100",
              },
            };
          }
          return { ok: false, error: "unexpected", data: {} };
        },
      },
    });

    expect(executed.results).toHaveLength(1);
    expect(executed.results[0]?.text).toContain("Ship checklist");
    expect(executed.diagnostics.exactNewestGuaranteed).toBe(true);
  });

  it("ranks latest RACI update first with timestamp sort", async () => {
    const planned = await planSlackSearch({
      question: "What is the latest on the RACI matrix?",
      teamId: FIXTURE_TEAM_ID,
      deps: directoryDeps(),
      now,
    });
    expect(planned.plan.sort).toBe("newest");

    const credential = {
      token: "xoxp-test",
      tokenKind: "user" as const,
      slackUserId: "U_JACKSON",
      slackTeamId: FIXTURE_TEAM_ID,
      scopes: ["search:read.public"],
      capabilities: capabilitiesFromScopes(["search:read.public"], "user", "configured"),
    };

    const executed = await executeSlackSearchPlan({
      plan: planned.plan,
      credential,
      deps: {
        callSlackApi: async () => ({
          ok: true,
          data: {
            ok: true,
            results: {
              messages: [fixtureMessages.raciLatest, fixtureMessages.raciDay1],
            },
            response_metadata: { next_cursor: "" },
          },
        }),
      },
    });

    expect(executed.results[0]?.text).toContain("ready for review Friday");
  });

  it("captures decision evidence including Milan agreement", async () => {
    const planned = await planSlackSearch({
      question: "When did we decide to use option B?",
      teamId: FIXTURE_TEAM_ID,
      deps: directoryDeps(),
      now,
    });

    const credential = {
      token: "xoxp-test",
      tokenKind: "user" as const,
      slackUserId: "U_JACKSON",
      slackTeamId: FIXTURE_TEAM_ID,
      scopes: ["search:read.public", "channels:history"],
      capabilities: capabilitiesFromScopes(
        ["search:read.public", "channels:history"],
        "user",
        "configured",
      ),
    };

    const executed = await executeSlackSearchPlan({
      plan: planned.plan,
      credential,
      deps: {
        callSlackApi: async (method) => {
          if (method === "assistant.search.context") {
            return {
              ok: true,
              data: {
                ok: true,
                results: {
                  messages: [fixtureMessages.milanAgreed, fixtureMessages.kevinOptionB],
                },
                response_metadata: { next_cursor: "" },
              },
            };
          }
          if (method === "conversations.replies") {
            return {
              ok: true,
              data: {
                ok: true,
                messages: [
                  {
                    ts: fixtureMessages.kevinOptionB.message_ts,
                    thread_ts: fixtureMessages.kevinOptionB.thread_ts,
                    user: "U_KEVIN",
                    text: fixtureMessages.kevinOptionB.content,
                  },
                  {
                    ts: fixtureMessages.milanAgreed.message_ts,
                    thread_ts: fixtureMessages.milanAgreed.thread_ts,
                    user: "U_MILAN",
                    text: fixtureMessages.milanAgreed.content,
                  },
                ],
              },
            };
          }
          return { ok: true, data: { ok: true } };
        },
      },
    });

    expect(executed.results.some((r) => r.text.includes("Let's use option B"))).toBe(true);
  });

  it("keeps Morgan weekly evidence within range filters via plan", async () => {
    const planned = await planSlackSearch({
      question: "What happened last week with the Morgan project?",
      teamId: FIXTURE_TEAM_ID,
      deps: directoryDeps(),
      now,
    });
    expect(planned.plan.timeRange?.label).toBe("last week");
    expect(planned.plan.keywords).toContain("morgan");
  });

  it("never returns leadership content for public-only requester", async () => {
    const result = await retrieveSlackEvidence({
      requester: {
        slackUserId: "U_JACKSON",
        slackTeamId: FIXTURE_TEAM_ID,
        allowPublicOnlyFallback: true,
      },
      question: "pricing",
      deps: {
        ...directoryDeps(),
        resolveSearchCredential: async () => ({
          token: "xoxp-test",
          tokenKind: "user",
          slackUserId: "U_JACKSON",
          slackTeamId: FIXTURE_TEAM_ID,
          scopes: ["search:read.public"],
          capabilities: capabilitiesFromScopes(["search:read.public"], "user", "partial"),
        }),
        callSlackApi: async () => ({
          ok: true,
          data: {
            ok: true,
            results: {
              messages: [fixtureMessages.leadershipSecret, fixtureMessages.jessDesignPresentation],
            },
            response_metadata: { next_cursor: "" },
          },
        }),
      },
    });

    expect(result.results.every((r) => r.channelId !== "C_LEADERSHIP")).toBe(true);
  });

  it("strips DM evidence when token identity does not match requester", async () => {
    const result = await retrieveSlackEvidence({
      requester: {
        slackUserId: "U_JACKSON",
        slackTeamId: FIXTURE_TEAM_ID,
      },
      question: "private note",
      deps: {
        ...directoryDeps(),
        resolveSearchCredential: async () => ({
          token: "xoxp-other",
          tokenKind: "user",
          slackUserId: "U_KEVIN",
          slackTeamId: FIXTURE_TEAM_ID,
          scopes: ["search:read.public", "search:read.im"],
          capabilities: capabilitiesFromScopes(
            ["search:read.public", "search:read.im"],
            "user",
            "configured",
          ),
        }),
        callSlackApi: async () => ({
          ok: true,
          data: {
            ok: true,
            results: { messages: [fixtureMessages.dmBetweenBC] },
            response_metadata: { next_cursor: "" },
          },
        }),
      },
    });

    expect(result.results).toHaveLength(0);
  });

  it("returns AUTH_REQUIRED when no credential available", async () => {
    const result = await retrieveSlackEvidence({
      requester: { baxterUserId: "00000000-0000-0000-0000-000000000001" },
      question: "RACI matrix",
      deps: {
        ...directoryDeps(),
        resolveSearchCredential: async () => null,
      },
    });
    expect(result.incomplete?.code).toBe(SLACK_SEARCH_ERROR_CODES.AUTH_REQUIRED);
  });

  it("handles rate limits without leaking payloads", async () => {
    const planned = await planSlackSearch({
      question: "RACI matrix",
      teamId: FIXTURE_TEAM_ID,
      deps: directoryDeps(),
      now,
    });
    const executed = await executeSlackSearchPlan({
      plan: planned.plan,
      credential: {
        token: "xoxp-test",
        tokenKind: "user",
        slackUserId: "U_JACKSON",
        slackTeamId: FIXTURE_TEAM_ID,
        scopes: ["search:read.public"],
        capabilities: capabilitiesFromScopes(["search:read.public"], "user", "configured"),
      },
      deps: {
        callSlackApi: async () => ({
          ok: false,
          error: "ratelimited",
          data: { ok: false, error: "ratelimited" },
          retryAfterSeconds: 5,
        }),
      },
    });
    expect(executed.incomplete?.code).toBe(SLACK_SEARCH_ERROR_CODES.RATE_LIMITED);
    expect(executed.diagnostics.rateLimited).toBe(true);
  });
});
