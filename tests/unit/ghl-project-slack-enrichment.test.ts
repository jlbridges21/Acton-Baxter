/**
 * GHL project answers + linked Project Setup Slack channel enrichment.
 */
import { describe, expect, it, vi } from "vitest";
import {
  listProjectSetupRunsForGhlContact,
  pickPreferredCompleteRunWithSlackChannel,
  type LinkedProjectSetupRun,
} from "@/lib/dossier/project-setup-for-contact";
import {
  appendProjectSlackActivityToGhlAnswer,
  isProjectFlavoredGhlQuestion,
  PROJECT_SLACK_CONNECT_NOTE,
} from "@/lib/baxter-ai/ghl-project-slack-enrichment";
import type { ProjectSetupRun } from "@/lib/project-setup/types";
import { SLACK_SOURCE_TYPE } from "@/lib/baxter-data/slack/types";
import { SLACK_SEARCH_ERROR_CODES } from "@/lib/baxter-data/slack/errors";
import { buildGhlContactInformationAnswer } from "@/lib/connectors/ghl/address";
import type { GhlContact } from "@/lib/connectors/ghl/types";

const KATIE_ID = "38R58HpyBSvtdnACqOzo";
const DENIS_ID = "denis-contact-id";

function baseGhlAnswer(name = "Katie Liniger", id = KATIE_ID): string {
  return buildGhlContactInformationAnswer({
    contact: {
      id,
      name,
      email: "katie@example.com",
      phone: "555-0100",
      address1: "1 Oak",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
    } as GhlContact,
    pipelineName: "Sales",
    stageName: "Qualified",
    opportunityName: "Katie ADU",
    opportunityCount: 1,
  });
}

function run(
  overrides: Partial<ProjectSetupRun> & { id: string; ghlContactId: string },
): ProjectSetupRun {
  const { id, ghlContactId, ...rest } = overrides;
  return {
    id,
    status: "complete",
    dryRun: false,
    initiatedBy: null,
    triggerChannel: "web",
    slackInitiatorId: null,
    ghlContactId,
    contactSnapshot: {
      id: ghlContactId,
      name: "Katie Liniger",
      firstName: "Katie",
      lastName: "Liniger",
      email: null,
      phone: null,
      address: null,
      city: null,
      state: null,
      postalCode: null,
      assignedUserId: null,
      assignedUserName: null,
    },
    salesRep: null,
    projectNumber: "L01-26019",
    projectLastName: "Liniger",
    folderName: null,
    charterName: null,
    slackChannelName: "l01-26019-liniger",
    fpPaidDate: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...rest,
  };
}

describe("isProjectFlavoredGhlQuestion", () => {
  it("matches the Katie incident phrasing", () => {
    expect(
      isProjectFlavoredGhlQuestion("give me information about the katie liniger project"),
    ).toBe(true);
  });

  it("does not match bare email asks", () => {
    expect(isProjectFlavoredGhlQuestion("what is Katie Liniger's email?")).toBe(false);
  });
});

describe("pickPreferredCompleteRunWithSlackChannel", () => {
  it("prefers the most recent complete run with a channel over failed/duplicate runs", () => {
    const runs: LinkedProjectSetupRun[] = [
      {
        id: "failed-old",
        status: "failed",
        projectNumber: "L01-26018",
        dryRun: false,
        folderName: null,
        charterName: null,
        slackChannelName: "l01-26018-stale",
        folderLink: null,
        charterLink: null,
        slackChannelId: "C_STALE",
        href: "/projects/setup/failed-old",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "complete-new",
        status: "complete",
        projectNumber: "L01-26019",
        dryRun: false,
        folderName: null,
        charterName: null,
        slackChannelName: "l01-26019-liniger",
        folderLink: null,
        charterLink: null,
        slackChannelId: "C_LINIGER",
        href: "/projects/setup/complete-new",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
      {
        id: "complete-older",
        status: "complete",
        projectNumber: "L01-26017",
        dryRun: false,
        folderName: null,
        charterName: null,
        slackChannelName: "l01-26017-old",
        folderLink: null,
        charterLink: null,
        slackChannelId: "C_OLD",
        href: "/projects/setup/complete-older",
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const preferred = pickPreferredCompleteRunWithSlackChannel(runs);
    expect(preferred?.id).toBe("complete-new");
    expect(preferred?.slackChannelName).toBe("l01-26019-liniger");
  });
});

describe("listProjectSetupRunsForGhlContact", () => {
  it("matches by exact ghl_contact_id only", async () => {
    const listed = await listProjectSetupRunsForGhlContact(KATIE_ID, {
      listSetupRuns: async () => [
        run({ id: "katie", ghlContactId: KATIE_ID, slackChannelName: "l01-26019-liniger" }),
        run({
          id: "denis",
          ghlContactId: DENIS_ID,
          slackChannelName: "l01-26020-kornilov",
          projectLastName: "Kornilov",
        }),
        run({
          id: "name-only",
          ghlContactId: "other-id",
          projectLastName: "Liniger",
          slackChannelName: "wrong-channel",
        }),
      ],
      getSetupSteps: async (runId) => [
        {
          id: `${runId}-slack`,
          runId,
          stepKey: "create_slack_channel",
          orderIndex: 1,
          status: "complete",
          outputJson: { channelId: `C_${runId}` },
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        } as never,
      ],
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe("katie");
    expect(listed[0]!.slackChannelId).toBe("C_katie");
  });
});

describe("appendProjectSlackActivityToGhlAnswer", () => {
  const ghlAnswer = baseGhlAnswer();

  it("appends recent Slack activity when connected and a complete run exists", async () => {
    const enriched = await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the katie liniger project",
      ghlContactId: KATIE_ID,
      requester: { baxterUserId: "user-1" },
      deps: {
        listSetupRuns: async () => [
          run({
            id: "katie-run",
            ghlContactId: KATIE_ID,
            status: "complete",
            slackChannelName: "l01-26019-liniger",
            createdAt: "2026-07-10T00:00:00.000Z",
          }),
        ],
        getSetupSteps: async () => [
          {
            id: "s1",
            runId: "katie-run",
            stepKey: "create_slack_channel",
            orderIndex: 1,
            status: "complete",
            outputJson: { channelId: "C_LINIGER" },
            errorMessage: null,
            startedAt: null,
            finishedAt: null,
            createdAt: "2026-07-10T00:00:00.000Z",
            updatedAt: "2026-07-10T00:00:00.000Z",
          } as never,
        ],
        slackSearchEnabled: () => true,
        getSlackConnection: async () => ({
          linked: true,
          slackUserId: "U1",
          slackTeamId: "T1",
          slackUserName: "Tester",
          scopes: ["search:read.public"],
          status: "connected",
          baxterUserId: "user-1",
          resolvedVia: "baxter_user_id" as const,
        }),
        authorLabelDeps: {
          getCachedProfile: async () => ({
            slack_user_id: "U2",
            display_name: "Alex",
            real_name: "Alex",
            username: "alex",
          }),
        },
        retrieveSlack: async () => ({
          plan: null,
          results: [
            {
              sourceType: SLACK_SOURCE_TYPE,
              messageTs: "1.1",
              threadTs: null,
              channelId: "C_LINIGER",
              channelName: "l01-26019-liniger",
              channelKind: "public_channel",
              authorId: "U2",
              authorName: null,
              timestamp: "2026-07-20T15:00:00.000Z",
              text: "Permit package submitted for Liniger.",
              permalink: null,
              isThreadReply: false,
              relevance: 1,
              contextMessages: [],
              clusterKey: "c1",
            },
          ],
          clusters: [],
          ambiguities: { people: [], channels: [] },
          access: {
            publicChannels: true,
            privateChannels: false,
            dms: false,
            groupDms: false,
            threadContext: true,
            permalinks: true,
            userLevelAuthorization: "configured",
            tokenKind: "user",
            allowedChannelTypes: ["public_channel"],
          },
          incomplete: null,
          diagnostics: {
            endpoint: "search.messages",
            latencyMs: 10,
            resultCount: 1,
            paginationCount: 1,
            rateLimited: false,
            capabilities: {
              publicChannels: true,
              privateChannels: false,
              dms: false,
              groupDms: false,
              threadContext: true,
              permalinks: true,
              userLevelAuthorization: "configured",
              tokenKind: "user",
              allowedChannelTypes: ["public_channel"],
            },
            exactNewestGuaranteed: true,
            notes: [],
          },
        }),
      },
    });

    expect(enriched).toContain("Katie Liniger");
    expect(enriched).toContain("katie@example.com");
    expect(enriched).toContain("#l01-26019-liniger");
    expect(enriched).toContain("Permit package submitted");
    expect(enriched).toContain("Alex");
    expect(enriched).not.toContain("Unknown");
    expect(enriched).not.toContain(PROJECT_SLACK_CONNECT_NOTE);
  });

  it("shows connect prompt when Slack Search is not connected", async () => {
    const enriched = await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the katie liniger project",
      ghlContactId: KATIE_ID,
      requester: { baxterUserId: "user-1" },
      deps: {
        listSetupRuns: async () => [
          run({
            id: "katie-run",
            ghlContactId: KATIE_ID,
            status: "complete",
            slackChannelName: "l01-26019-liniger",
          }),
        ],
        getSetupSteps: async () => [
          {
            id: "s1",
            runId: "katie-run",
            stepKey: "create_slack_channel",
            orderIndex: 1,
            status: "complete",
            outputJson: { channelId: "C_LINIGER" },
          } as never,
        ],
        slackSearchEnabled: () => true,
        getSlackConnection: async () => ({
          linked: false,
          slackUserId: null,
          slackTeamId: null,
          slackUserName: null,
          scopes: [],
          status: null,
          baxterUserId: null,
          resolvedVia: null,
        }),
        retrieveSlack: async () => {
          throw new Error("should not search without connection");
        },
      },
    });

    expect(enriched).toContain("Katie Liniger");
    expect(enriched).toContain(PROJECT_SLACK_CONNECT_NOTE);
    expect(enriched).not.toContain("Recent activity");
  });

  it("leaves GHL-only answer when no Project Setup run is linked", async () => {
    const enriched = await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the katie liniger project",
      ghlContactId: KATIE_ID,
      requester: { baxterUserId: "user-1" },
      deps: {
        listSetupRuns: async () => [
          run({ id: "other", ghlContactId: DENIS_ID, slackChannelName: "other" }),
        ],
        getSetupSteps: async () => [],
        retrieveSlack: async () => {
          throw new Error("should not search");
        },
      },
    });
    expect(enriched).toBe(ghlAnswer);
  });

  it("uses the newest complete run channel when duplicates exist", async () => {
    const retrieve = vi.fn(async (input: { plan?: { channels: Array<{ id: string }> } | null }) => {
      expect(input.plan?.channels[0]?.id).toBe("C_NEW");
      return {
        plan: null,
        results: [],
        clusters: [],
        ambiguities: { people: [], channels: [] },
        access: {
          publicChannels: true,
          privateChannels: false,
          dms: false,
          groupDms: false,
          threadContext: true,
          permalinks: true,
          userLevelAuthorization: "configured",
          tokenKind: "user",
          allowedChannelTypes: ["public_channel" as const],
        },
        incomplete: null,
        diagnostics: {
          endpoint: "search.messages",
          latencyMs: 1,
          resultCount: 0,
          paginationCount: 0,
          rateLimited: false,
          capabilities: {
            publicChannels: true,
            privateChannels: false,
            dms: false,
            groupDms: false,
            threadContext: true,
            permalinks: true,
            userLevelAuthorization: "configured" as const,
            tokenKind: "user" as const,
            allowedChannelTypes: ["public_channel" as const],
          },
          exactNewestGuaranteed: true,
          notes: [],
        },
      };
    });

    await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the katie liniger project",
      ghlContactId: KATIE_ID,
      requester: { baxterUserId: "user-1" },
      deps: {
        listSetupRuns: async () => [
          run({
            id: "failed",
            ghlContactId: KATIE_ID,
            status: "failed",
            slackChannelName: "stale",
            createdAt: "2026-07-20T00:00:00.000Z",
          }),
          run({
            id: "old-complete",
            ghlContactId: KATIE_ID,
            status: "complete",
            slackChannelName: "old",
            createdAt: "2026-06-01T00:00:00.000Z",
          }),
          run({
            id: "new-complete",
            ghlContactId: KATIE_ID,
            status: "complete",
            slackChannelName: "l01-26019-liniger",
            createdAt: "2026-07-15T00:00:00.000Z",
          }),
        ],
        getSetupSteps: async (runId) => [
          {
            id: `${runId}-s`,
            runId,
            stepKey: "create_slack_channel",
            orderIndex: 1,
            status: "complete",
            outputJson: {
              channelId:
                runId === "new-complete" ? "C_NEW" : runId === "old-complete" ? "C_OLD" : "C_FAIL",
            },
          } as never,
        ],
        slackSearchEnabled: () => true,
        getSlackConnection: async () => ({
          linked: true,
          slackUserId: "U1",
          slackTeamId: "T1",
          slackUserName: "T",
          scopes: [],
          status: "connected",
          baxterUserId: "user-1",
          resolvedVia: "baxter_user_id" as const,
        }),
        retrieveSlack: retrieve as never,
      },
    });

    expect(retrieve).toHaveBeenCalled();
  });

  it("keeps GHL answer when Slack search throws", async () => {
    const enriched = await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the katie liniger project",
      ghlContactId: KATIE_ID,
      requester: { baxterUserId: "user-1" },
      deps: {
        listSetupRuns: async () => [
          run({
            id: "katie-run",
            ghlContactId: KATIE_ID,
            status: "complete",
            slackChannelName: "l01-26019-liniger",
          }),
        ],
        getSetupSteps: async () => [
          {
            id: "s1",
            runId: "katie-run",
            stepKey: "create_slack_channel",
            orderIndex: 1,
            status: "complete",
            outputJson: { channelId: "C_LINIGER" },
          } as never,
        ],
        slackSearchEnabled: () => true,
        getSlackConnection: async () => ({
          linked: true,
          slackUserId: "U1",
          slackTeamId: "T1",
          slackUserName: "T",
          scopes: [],
          status: "connected",
          baxterUserId: "user-1",
          resolvedVia: "baxter_user_id" as const,
        }),
        retrieveSlack: async () => {
          throw new Error("slack down");
        },
      },
    });
    expect(enriched).toBe(ghlAnswer);
  });

  it("keeps GHL answer when Slack returns a non-auth incomplete error", async () => {
    const enriched = await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the denis kornilov project",
      ghlContactId: DENIS_ID,
      requester: { baxterUserId: "user-1" },
      deps: {
        listSetupRuns: async () => [
          run({
            id: "denis-run",
            ghlContactId: DENIS_ID,
            status: "complete",
            slackChannelName: "l01-26020-kornilov",
            projectLastName: "Kornilov",
          }),
        ],
        getSetupSteps: async () => [
          {
            id: "s1",
            runId: "denis-run",
            stepKey: "create_slack_channel",
            orderIndex: 1,
            status: "complete",
            outputJson: { channelId: "C_DENIS" },
          } as never,
        ],
        slackSearchEnabled: () => true,
        getSlackConnection: async () => ({
          linked: true,
          slackUserId: "U1",
          slackTeamId: "T1",
          slackUserName: "T",
          scopes: [],
          status: "connected",
          baxterUserId: "user-1",
          resolvedVia: "baxter_user_id" as const,
        }),
        retrieveSlack: async () => ({
          plan: null,
          results: [],
          clusters: [],
          ambiguities: { people: [], channels: [] },
          access: {
            publicChannels: true,
            privateChannels: false,
            dms: false,
            groupDms: false,
            threadContext: true,
            permalinks: true,
            userLevelAuthorization: "configured",
            tokenKind: "user",
            allowedChannelTypes: ["public_channel"],
          },
          incomplete: {
            code: SLACK_SEARCH_ERROR_CODES.CHANNEL_NOT_FOUND,
            message: "Channel not found",
            retryable: false,
          },
          diagnostics: {
            endpoint: null,
            latencyMs: 1,
            resultCount: 0,
            paginationCount: 0,
            rateLimited: false,
            capabilities: {
              publicChannels: true,
              privateChannels: false,
              dms: false,
              groupDms: false,
              threadContext: true,
              permalinks: true,
              userLevelAuthorization: "configured",
              tokenKind: "user",
              allowedChannelTypes: ["public_channel"],
            },
            exactNewestGuaranteed: null,
            notes: [],
          },
        }),
      },
    });
    expect(enriched).toBe(ghlAnswer);
  });

  /**
   * Incident: Slack DM always calls answerBaxterQuestion with userId:null and
   * externalUserId=event.user. The gate must resolve Slack Search via slack_user_id,
   * not require a Baxter profile UUID.
   */
  it("Slack DM path (baxterUserId null) still enriches when Slack Search is connected", async () => {
    const retrieve = vi.fn(async (input: { requester: { slackUserId?: string | null } }) => {
      expect(input.requester.slackUserId).toBe("U_EMPLOYEE");
      return {
        plan: null,
        results: [
          {
            sourceType: SLACK_SOURCE_TYPE,
            messageTs: "1.1",
            threadTs: null,
            channelId: "C_LINIGER",
            channelName: "l01-26019-liniger",
            channelKind: "public_channel",
            authorId: "U2",
            authorName: "Alex",
            timestamp: "2026-07-20T15:00:00.000Z",
            text: "Permit package submitted for Liniger.",
            permalink: null,
            isThreadReply: false,
            relevance: 1,
            contextMessages: [],
            clusterKey: "c1",
          },
        ],
        clusters: [],
        ambiguities: { people: [], channels: [] },
        access: {
          publicChannels: true,
          privateChannels: false,
          dms: false,
          groupDms: false,
          threadContext: true,
          permalinks: true,
          userLevelAuthorization: "configured",
          tokenKind: "user",
          allowedChannelTypes: ["public_channel"],
        },
        incomplete: null,
        diagnostics: {
          endpoint: "search.messages",
          latencyMs: 10,
          resultCount: 1,
          paginationCount: 1,
          rateLimited: false,
          capabilities: {
            publicChannels: true,
            privateChannels: false,
            dms: false,
            groupDms: false,
            threadContext: true,
            permalinks: true,
            userLevelAuthorization: "configured",
            tokenKind: "user",
            allowedChannelTypes: ["public_channel"],
          },
          exactNewestGuaranteed: true,
          notes: [],
        },
      };
    });

    const getSlackConnection = vi.fn(async (requester: { slackUserId?: string | null }) => {
      expect(requester.slackUserId).toBe("U_EMPLOYEE");
      return {
        linked: true,
        slackUserId: "U_EMPLOYEE",
        slackTeamId: "T_ACTON",
        slackUserName: "Employee",
        scopes: ["search:read.public"],
        status: "connected",
        baxterUserId: "profile-from-connection-row",
        resolvedVia: "slack_user_id" as const,
      };
    });

    const enriched = await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the katie liniger project",
      ghlContactId: KATIE_ID,
      // Mirrors baxter-events.ts: userId:null, externalUserId:event.user
      requester: {
        baxterUserId: null,
        slackUserId: "U_EMPLOYEE",
        slackTeamId: "T_ACTON",
      },
      deps: {
        listSetupRuns: async () => [
          run({
            id: "katie-run",
            ghlContactId: KATIE_ID,
            status: "complete",
            slackChannelName: "l01-26019-liniger",
          }),
        ],
        getSetupSteps: async () => [
          {
            id: "s1",
            runId: "katie-run",
            stepKey: "create_slack_channel",
            orderIndex: 1,
            status: "complete",
            outputJson: { channelId: "C_LINIGER" },
          } as never,
        ],
        slackSearchEnabled: () => true,
        getSlackConnection,
        authorLabelDeps: {
          getCachedProfile: async () => ({
            slack_user_id: "U2",
            display_name: "Alex",
            real_name: null,
            username: "alex",
          }),
        },
        retrieveSlack: retrieve as never,
      },
    });

    expect(getSlackConnection).toHaveBeenCalled();
    expect(retrieve).toHaveBeenCalled();
    expect(enriched).toContain("Permit package submitted");
    expect(enriched).not.toContain(PROJECT_SLACK_CONNECT_NOTE);
    expect(enriched).not.toContain("Unknown");
  });

  it("cleans Slack markup and names authors in Katie-shaped channel activity", async () => {
    const enriched = await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the katie liniger project",
      ghlContactId: KATIE_ID,
      requester: { baxterUserId: "user-1", slackTeamId: "T_ACTON" },
      deps: {
        listSetupRuns: async () => [
          run({
            id: "katie-run",
            ghlContactId: KATIE_ID,
            status: "complete",
            slackChannelName: "l01-26019-liniger",
          }),
        ],
        getSetupSteps: async () => [
          {
            id: "s1",
            runId: "katie-run",
            stepKey: "create_slack_channel",
            orderIndex: 1,
            status: "complete",
            outputJson: { channelId: "C_LINIGER" },
          } as never,
        ],
        slackSearchEnabled: () => true,
        getSlackConnection: async () => ({
          linked: true,
          slackUserId: "U1",
          slackTeamId: "T_ACTON",
          slackUserName: "T",
          scopes: [],
          status: "connected",
          baxterUserId: "user-1",
          resolvedVia: "baxter_user_id" as const,
        }),
        authorLabelDeps: {
          getCachedProfile: async (_team, id) =>
            id === "U_SENDER"
              ? {
                  slack_user_id: "U_SENDER",
                  display_name: "Jess",
                  real_name: "Jessica",
                  username: "jess",
                }
              : {
                  slack_user_id: id,
                  display_name: "Katie",
                  real_name: "Katie Liniger",
                  username: "katie",
                },
        },
        retrieveSlack: async () => ({
          plan: null,
          results: [
            {
              sourceType: SLACK_SOURCE_TYPE,
              messageTs: "1.1",
              threadTs: null,
              channelId: "C_LINIGER",
              channelName: "l01-26019-liniger",
              channelKind: "public_channel",
              authorId: "U_SENDER",
              authorName: null,
              timestamp: "2026-08-04T15:00:00.000Z",
              text: "<@U03JHQC5B61> Katie <mailto:kathryn_liniger@yahoo.com|kathryn_liniger@yahoo.com> confirmed both the site-inspection and the Kickoff with you.",
              permalink: null,
              isThreadReply: false,
              relevance: 1,
              contextMessages: [],
              clusterKey: "c1",
            },
            {
              sourceType: SLACK_SOURCE_TYPE,
              messageTs: "1.2",
              threadTs: null,
              channelId: "C_LINIGER",
              channelName: "l01-26019-liniger",
              channelKind: "public_channel",
              authorId: "U_MAXX",
              authorName: null,
              timestamp: "2026-08-04T16:00:00.000Z",
              text: "CMS setup confirmed and created the project folder in <https://drive.google.com/x|G-Drive>.",
              permalink: null,
              isThreadReply: false,
              relevance: 1,
              contextMessages: [],
              clusterKey: "c2",
            },
          ],
          clusters: [],
          ambiguities: { people: [], channels: [] },
          access: {
            publicChannels: true,
            privateChannels: false,
            dms: false,
            groupDms: false,
            threadContext: true,
            permalinks: true,
            userLevelAuthorization: "configured",
            tokenKind: "user",
            allowedChannelTypes: ["public_channel"],
          },
          incomplete: null,
          diagnostics: {
            endpoint: "search.messages",
            latencyMs: 10,
            resultCount: 2,
            paginationCount: 1,
            rateLimited: false,
            capabilities: {
              publicChannels: true,
              privateChannels: false,
              dms: false,
              groupDms: false,
              threadContext: true,
              permalinks: true,
              userLevelAuthorization: "configured",
              tokenKind: "user",
              allowedChannelTypes: ["public_channel"],
            },
            exactNewestGuaranteed: true,
            notes: [],
          },
        }),
      },
    });

    expect(enriched).toContain("Jess");
    expect(enriched).toContain("kathryn_liniger@yahoo.com");
    expect(enriched).toContain("G-Drive");
    expect(enriched).not.toContain("Unknown");
    expect(enriched).not.toContain("<@");
    expect(enriched).not.toContain("<mailto:");
    expect(enriched).not.toMatch(/\w…/);
  });

  it("Slack DM path still shows connect note when Slack Search is not linked", async () => {
    const getSlackConnection = vi.fn(async () => ({
      linked: false,
      slackUserId: null,
      slackTeamId: null,
      slackUserName: null,
      scopes: [],
      status: null,
      baxterUserId: null,
      resolvedVia: null,
    }));

    const enriched = await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the katie liniger project",
      ghlContactId: KATIE_ID,
      requester: {
        baxterUserId: null,
        slackUserId: "U_UNLINKED",
        slackTeamId: "T_ACTON",
      },
      deps: {
        listSetupRuns: async () => [
          run({
            id: "katie-run",
            ghlContactId: KATIE_ID,
            status: "complete",
            slackChannelName: "l01-26019-liniger",
          }),
        ],
        getSetupSteps: async () => [
          {
            id: "s1",
            runId: "katie-run",
            stepKey: "create_slack_channel",
            orderIndex: 1,
            status: "complete",
            outputJson: { channelId: "C_LINIGER" },
          } as never,
        ],
        slackSearchEnabled: () => true,
        getSlackConnection,
        retrieveSlack: async () => {
          throw new Error("must not search when unlinked");
        },
      },
    });

    expect(getSlackConnection).toHaveBeenCalled();
    expect(enriched).toContain(PROJECT_SLACK_CONNECT_NOTE);
    expect(enriched).not.toContain("Recent activity");
  });

  it("picks up a freshly created connection on the next request (no stale gate)", async () => {
    let linked = false;
    const getSlackConnection = vi.fn(async () =>
      linked
        ? {
            linked: true,
            slackUserId: "U_EMPLOYEE",
            slackTeamId: "T_ACTON",
            slackUserName: "Employee",
            scopes: ["search:read.public"],
            status: "connected",
            baxterUserId: "profile-1",
            resolvedVia: "slack_user_id" as const,
          }
        : {
            linked: false,
            slackUserId: null,
            slackTeamId: null,
            slackUserName: null,
            scopes: [],
            status: null,
            baxterUserId: null,
            resolvedVia: null,
          },
    );

    const sharedDeps = {
      listSetupRuns: async () => [
        run({
          id: "katie-run",
          ghlContactId: KATIE_ID,
          status: "complete",
          slackChannelName: "l01-26019-liniger",
        }),
      ],
      getSetupSteps: async () => [
        {
          id: "s1",
          runId: "katie-run",
          stepKey: "create_slack_channel",
          orderIndex: 1,
          status: "complete",
          outputJson: { channelId: "C_LINIGER" },
        } as never,
      ],
      slackSearchEnabled: () => true,
      getSlackConnection,
      retrieveSlack: async () => ({
        plan: null,
        results: [
          {
            sourceType: SLACK_SOURCE_TYPE,
            messageTs: "1.1",
            threadTs: null,
            channelId: "C_LINIGER",
            channelName: "l01-26019-liniger",
            channelKind: "public_channel",
            authorId: "U2",
            authorName: "Alex",
            timestamp: "2026-07-20T15:00:00.000Z",
            text: "Fresh connection search hit.",
            permalink: null,
            isThreadReply: false,
            relevance: 1,
            contextMessages: [],
            clusterKey: "c1",
          },
        ],
        clusters: [],
        ambiguities: { people: [], channels: [] },
        access: {
          publicChannels: true,
          privateChannels: false,
          dms: false,
          groupDms: false,
          threadContext: true,
          permalinks: true,
          userLevelAuthorization: "configured",
          tokenKind: "user",
          allowedChannelTypes: ["public_channel"],
        },
        incomplete: null,
        diagnostics: {
          endpoint: "search.messages",
          latencyMs: 1,
          resultCount: 1,
          paginationCount: 1,
          rateLimited: false,
          capabilities: {
            publicChannels: true,
            privateChannels: false,
            dms: false,
            groupDms: false,
            threadContext: true,
            permalinks: true,
            userLevelAuthorization: "configured",
            tokenKind: "user",
            allowedChannelTypes: ["public_channel"],
          },
          exactNewestGuaranteed: true,
          notes: [],
        },
      }),
      authorLabelDeps: {
        getCachedProfile: async () => ({
          slack_user_id: "U2",
          display_name: "Alex",
          real_name: null,
          username: "alex",
        }),
      },
    };

    const requester = {
      baxterUserId: null as string | null,
      slackUserId: "U_EMPLOYEE",
      slackTeamId: "T_ACTON",
    };

    const before = await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the katie liniger project",
      ghlContactId: KATIE_ID,
      requester,
      deps: sharedDeps as never,
    });
    expect(before).toContain(PROJECT_SLACK_CONNECT_NOTE);

    linked = true; // connection created between requests — gate must re-read

    const after = await appendProjectSlackActivityToGhlAnswer({
      ghlAnswer,
      question: "give me information about the katie liniger project",
      ghlContactId: KATIE_ID,
      requester,
      deps: sharedDeps as never,
    });
    expect(after).toContain("Fresh connection search hit");
    expect(after).not.toContain(PROJECT_SLACK_CONNECT_NOTE);
    expect(getSlackConnection).toHaveBeenCalledTimes(2);
  });
});
