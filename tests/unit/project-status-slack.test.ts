/**
 * Project-status routing + exact-channel Slack history regressions (McAdams fixture).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { buildBaxterQueryPlan } from "@/lib/baxter/query-plan";
import {
  detectSlackSearchIntent,
  extractChannelMentions,
  extractKeywords,
  planSlackSearch,
  buildSlackSearchQuery,
  resolveChannelFromDirectory,
  selectSlackEvidenceForModel,
  executeSlackSearchPlan,
  isProjectStatusQuestion,
  extractProjectNumbers,
  extractProjectNameQueries,
  scoreProjectChannelMatch,
} from "@/lib/baxter-data/slack";
import { isMeaningfulProjectUpdate } from "@/lib/baxter-data/slack/select";
import { nonSlackEvidenceSatisfiesQuestion } from "@/lib/baxter-data/slack/source-sufficiency";
import { capabilitiesFromScopes } from "@/lib/baxter-data/slack/permissions";
import {
  SLACK_SOURCE_TYPE,
  type ResolvedSlackChannel,
  type SlackCredentialResolution,
  type SlackMessageEvidence,
  type SlackQueryPlan,
} from "@/lib/baxter-data/slack/types";

const MCADAMS_CHANNEL: ResolvedSlackChannel = {
  id: "C_MCADAMS",
  name: "l01-24027-mcadams",
  displayLabel: "#l01-24027-mcadams",
  teamId: "T_ACTON",
  kind: "public_channel",
  isPrivate: false,
  isMember: true,
};

function msg(
  partial: Partial<SlackMessageEvidence> & { text: string; messageTs: string },
): SlackMessageEvidence {
  const messageTs = partial.messageTs;
  return {
    sourceType: SLACK_SOURCE_TYPE,
    channelId: MCADAMS_CHANNEL.id,
    channelName: MCADAMS_CHANNEL.name,
    channelKind: "public_channel",
    threadTs: null,
    authorId: "U_KEVIN",
    authorName: "Kevin Lee",
    timestamp: "2026-07-10T18:00:00.000Z",
    permalink: `https://example.slack.com/archives/${MCADAMS_CHANNEL.id}/p${messageTs.replace(".", "")}`,
    isThreadReply: false,
    relevance: 1,
    contextMessages: [],
    clusterKey: `${MCADAMS_CHANNEL.id}:${messageTs}`,
    ...partial,
    messageTs,
  };
}

/** Fixture modeled on the successful production McAdams thread. */
const MCADAMS_MESSAGES: SlackMessageEvidence[] = [
  msg({
    messageTs: "1714579200.000100",
    timestamp: "2026-05-01T17:00:00.000Z",
    authorName: "Team",
    text: "Utilities approach Option 2 was approved for McAdams; routing still depends on site conditions.",
  }),
  msg({
    messageTs: "1719686400.000200",
    timestamp: "2026-06-29T18:00:00.000Z",
    authorName: "CMS",
    text: "CMS quote posted for verification on L01-24027 McAdams — please review totals before client send.",
  }),
  msg({
    messageTs: "1720630800.000300",
    timestamp: "2026-07-10T18:00:00.000Z",
    authorId: "U_KEVIN",
    authorName: "Kevin Lee",
    text: "Sharing Jeff Dukes summary for McAdams. Need Stanley edits; signable format still undecided. Next step is a clean client version.",
  }),
  msg({
    messageTs: "1720630900.000400",
    timestamp: "2026-07-10T18:05:00.000Z",
    authorId: "U_OTHER",
    authorName: "Someone",
    text: "thanks",
  }),
];

const botCredential: SlackCredentialResolution = {
  token: "xoxb-test",
  tokenKind: "bot_with_action_token",
  slackTeamId: "T_ACTON",
  slackUserId: null,
  scopes: ["channels:history", "groups:history", "search:read.public"],
  actionToken: "action-token-test",
  capabilities: capabilitiesFromScopes(
    ["channels:history", "groups:history", "search:read.public"],
    "bot_with_action_token",
    "partial",
  ),
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.ENABLE_SLACK_INTEGRATION = "true";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_ALLOWED_TEAM_IDS = "T_ACTON";
  resetEnvCacheForTests();
});

describe("project status intent detection", () => {
  it("A) update on McAdams is project_status", () => {
    const q = "Provide me an update on the McAdams project";
    expect(isProjectStatusQuestion(q)).toBe(true);
    expect(detectSlackSearchIntent(q)).toBe("project_status");
    expect(buildBaxterQueryPlan(q).intent).toBe("project_status");
    expect(buildBaxterQueryPlan(q).sourcePriority[0]).toBe("slack");
  });

  it("B) latest update in #channel project is project_status, not keyword RTS", async () => {
    const q = "What is the latest update in the #l01-24027-mcadams project?";
    expect(detectSlackSearchIntent(q)).toBe("project_status");
    expect(extractChannelMentions(q)).toContain("l01-24027-mcadams");
    expect(extractKeywords(q)).not.toContain("project");

    const planned = await planSlackSearch({
      question: q,
      teamId: "T_ACTON",
      deps: {
        listCachedChannels: async () => [MCADAMS_CHANNEL],
        listCachedUsers: async () => [],
      },
    });
    expect(planned.plan.intent).toBe("project_status");
    expect(planned.plan.channels[0]?.name).toBe("l01-24027-mcadams");
    expect(planned.plan.keywords).not.toContain("project");
    const query = buildSlackSearchQuery(planned.plan);
    expect(query).toContain("in:<#C_MCADAMS>");
    expect(query).not.toMatch(/\bproject\b/);
  });

  it("D) Anything newer keeps project_status after channel context", () => {
    expect(isProjectStatusQuestion("Anything newer on McAdams?")).toBe(true);
    expect(detectSlackSearchIntent("Anything newer on McAdams?")).toBe("project_status");
  });

  it("C) L01-24027 resolves toward project channel", () => {
    expect(extractProjectNumbers("What is happening with L01-24027?")).toEqual(["L01-24027"]);
    expect(scoreProjectChannelMatch("l01-24027-mcadams", "L01-24027")).toBeGreaterThanOrEqual(90);
    const resolved = resolveChannelFromDirectory("l01-24027", [MCADAMS_CHANNEL]);
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.channel.name).toBe("l01-24027-mcadams");
    }
    expect(detectSlackSearchIntent("What is happening with L01-24027?")).toBe("project_status");
  });

  it("extracts McAdams project name", () => {
    expect(extractProjectNameQueries("Provide an update on the McAdams project")).toContain(
      "McAdams",
    );
  });
});

describe("McAdams exact-channel history fixture", () => {
  it("B) latest update retrieves Jul 10 Kevin update via history, not zero results", async () => {
    const plan: SlackQueryPlan = {
      intent: "project_status",
      people: [],
      channels: [MCADAMS_CHANNEL],
      keywords: [],
      phrases: [],
      decisionLanguage: [],
      timeRange: null,
      sort: "newest",
      limit: 20,
      includeThreads: true,
      includeNearbyContext: true,
      naturalQuery: "What is the latest update in the #l01-24027-mcadams project?",
    };

    const result = await executeSlackSearchPlan({
      plan,
      credential: botCredential,
      deps: {
        callSlackApi: async (method) => {
          if (method === "conversations.history") {
            return {
              ok: true,
              data: {
                messages: MCADAMS_MESSAGES.map((m) => ({
                  ts: m.messageTs,
                  text: m.text,
                  user: m.authorId,
                  type: "message",
                })),
              },
            };
          }
          return { ok: false, error: "unexpected", data: {} };
        },
        listCachedUsers: async () => [
          {
            id: "U_KEVIN",
            displayName: "Kevin Lee",
            realName: "Kevin Lee",
            username: "kevin",
            teamId: "T_ACTON",
          },
        ],
      },
    });

    expect(result.diagnostics.endpoint).toBe("conversations.history");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.diagnostics.notes.join(" ")).toMatch(/no keyword gate|project\/latest/i);

    const selected = selectSlackEvidenceForModel(result.results, plan);
    expect(selected[0]?.text).toMatch(/Jeff Dukes|Stanley edits|signable/i);
    expect(selected.some((m) => /CMS quote/i.test(m.text))).toBe(true);
    expect(selected.every((m) => m.text !== "thanks")).toBe(true);
  });

  it("E) Kevin-author latest still author-filters", () => {
    const plan: SlackQueryPlan = {
      intent: "latest_message",
      people: [
        {
          id: "U_KEVIN",
          displayName: "Kevin Lee",
          realName: "Kevin Lee",
          username: "kevin",
          teamId: "T_ACTON",
        },
      ],
      channels: [MCADAMS_CHANNEL],
      keywords: [],
      phrases: [],
      decisionLanguage: [],
      timeRange: null,
      sort: "newest",
      limit: 1,
      includeThreads: false,
      includeNearbyContext: false,
      naturalQuery: "What did Kevin say last in #l01-24027-mcadams?",
    };
    const kevinOnly = MCADAMS_MESSAGES.filter((m) => m.authorId === "U_KEVIN");
    const selected = selectSlackEvidenceForModel(kevinOnly, plan);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.authorName).toBe("Kevin Lee");
    expect(selected[0]?.text).toMatch(/Jeff Dukes|Stanley edits/i);
  });
});

describe("project status vs facts routing", () => {
  it("F) contract value is not project_status Slack", () => {
    const q = "What was the contract value for McAdams?";
    expect(isProjectStatusQuestion(q)).toBe(false);
    expect(detectSlackSearchIntent(q)).not.toBe("project_status");
  });

  it("G) Type 1 Pain stays PEM-shaped, not project_status", () => {
    const q = "What is McAdams’s Type 1 Pain?";
    expect(isProjectStatusQuestion(q)).toBe(false);
  });

  it("static sales row does not satisfy latest project update", () => {
    expect(
      nonSlackEvidenceSatisfiesQuestion(
        "What is the latest update in the #l01-24027-mcadams project?",
        ["Claire McAdams closed Aug 3, 2025 agreement amount $467,628"],
      ),
    ).toBe(false);
  });

  it("meaningful update heuristic", () => {
    expect(isMeaningfulProjectUpdate("thanks")).toBe(false);
    expect(
      isMeaningfulProjectUpdate(
        "Sharing Jeff Dukes summary for McAdams. Need Stanley edits; signable format still undecided.",
      ),
    ).toBe(true);
  });
});
