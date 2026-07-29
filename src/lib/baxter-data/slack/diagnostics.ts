import "server-only";

import { getSlackSearchRuntimeConfig, scopesToCapabilities } from "./config";
import { getSlackSearchConnectionMetadata } from "./connections";
import { retrieveSlackEvidence } from "./evidence";
import { formatSlackEvidenceForAdmin } from "./format";
import { planSlackSearch } from "./query-plan";
import {
  getSlackDirectoryHealth,
  listCachedSlackChannels,
  listCachedSlackUsers,
  refreshAndListDirectory,
} from "./directory";
import { resolvePersonFromDirectory } from "./users";
import { resolveChannelFromDirectory } from "./channels";
import type { SlackRequester } from "./types";

export async function getSlackSearchDiagnosticsSnapshot(adminUserId?: string, teamId?: string) {
  const config = getSlackSearchRuntimeConfig();
  const connection = adminUserId ? await getSlackSearchConnectionMetadata(adminUserId) : null;
  const directory = await getSlackDirectoryHealth(teamId ?? "");

  const linkedScopes = connection?.scopes ?? [];
  const linkedCaps = scopesToCapabilities(linkedScopes);
  const envPublicOnly = config.userTokenEnvPresent;

  const directoryThin =
    directory.activeHumans < 5 || directory.publicChannels < 3 || directory.channelsCached < 5;
  const directoryStaleHint = directoryThin
    ? "Channel/user cache looks thin — run Refresh Slack Directory"
    : null;

  // Overall Slack Search health must reflect directory quality, not just auth flags.
  let status: "ready" | "limited" | "needs_attention" | "offline" | "disabled" | "needs_setup" =
    "needs_setup";
  if (!config.searchEnabled) {
    status = "disabled";
  } else if (!config.botTokenPresent && !connection?.linked && !envPublicOnly) {
    status = "offline";
  } else if (directoryThin) {
    status = "needs_attention";
  } else if (connection?.linked || envPublicOnly) {
    status = "ready";
  } else if (config.readyForPublicBotSearch) {
    status = "limited";
  } else if (config.readyForUserOauth) {
    status = "needs_setup";
  } else {
    status = "needs_setup";
  }

  return {
    status,
    workspaceLabel: "Acton ADU",
    searchEnabled: config.searchEnabled,
    searchEnabledLabel: config.searchEnabled ? "Enabled" : "Disabled",
    readyForUserOauth: config.readyForUserOauth,
    readyForPublicBotSearch: config.readyForPublicBotSearch,
    missingForUserOauth: config.missingForUserOauth,
    oauthRedirectUri: config.oauthRedirectUri,
    oauthRedirectUriConfigured: config.oauthRedirectUriConfigured,
    userLevelAuthorization: connection?.linked
      ? ("configured" as const)
      : envPublicOnly || config.readyForPublicBotSearch
        ? ("partial" as const)
        : ("not_configured" as const),
    directory: {
      usersCached: directory.usersCached,
      channelsCached: directory.channelsCached,
      publicChannels: directory.publicChannels,
      privateChannels: directory.privateChannels,
      archivedChannels: directory.archivedChannels,
      activeHumans: directory.activeHumans,
      lastUserResolvedAt: directory.lastUserResolvedAt,
      lastChannelResolvedAt: directory.lastChannelResolvedAt,
      staleHint: directoryStaleHint,
      health: directoryThin ? ("needs_attention" as const) : ("ready" as const),
    },
    capabilities: {
      publicChannels: linkedCaps.publicChannels || envPublicOnly || config.readyForPublicBotSearch,
      privateChannels: linkedCaps.privateChannels,
      dms: linkedCaps.dms,
      groupDms: linkedCaps.groupDms,
      threadContext: linkedCaps.threadContext || config.botTokenPresent,
      permalinks: true,
      publicChannelHistory: config.botTokenPresent || linkedCaps.threadContext,
      workspaceSearch: Boolean(connection?.linked || envPublicOnly),
      privateSearch: linkedCaps.privateChannels,
      dmSearch: linkedCaps.dms,
      userResolution: true,
      channelResolution: true,
      permalinkGeneration: true,
    },
    capabilityHealth: {
      slackEvents: config.integrationEnabled,
      slackPosting: config.botTokenPresent,
      slackReactions: config.botTokenPresent,
      slackPublicChannelHistory: config.searchEnabled && config.botTokenPresent,
      slackWorkspaceSearch: config.searchEnabled && Boolean(connection?.linked || envPublicOnly),
      slackPrivateSearch: config.searchEnabled && linkedCaps.privateChannels,
      slackDmSearch: config.searchEnabled && linkedCaps.dms,
      slackUserResolution: config.integrationEnabled && !directoryThin,
      slackChannelResolution: config.integrationEnabled && !directoryThin,
      slackPermalinkGeneration: config.botTokenPresent,
    },
    workspaceSearchNote:
      "Public channel history works without linked Slack Search. Workspace-wide semantic search requires linked Slack Search authorization (or an env user token).",
    connection: connection
      ? {
          linked: connection.linked,
          slackUserName: connection.slackUserName,
          slackUserId: connection.slackUserId,
          status: connection.status,
        }
      : null,
  };
}

export async function runSlackSearchAdminTest(input: {
  action:
    | "test_public_search"
    | "test_user_resolution"
    | "test_channel_resolution"
    | "test_thread_retrieval"
    | "test_latest_message"
    | "sandbox_search"
    | "refresh_directory"
    | "test_channel_summary"
    | "test_slack_recall";
  query?: string;
  person?: string;
  channel?: string;
  teamId?: string;
  requester: SlackRequester;
}) {
  const teamId = input.teamId || input.requester.slackTeamId || "";
  const query = (input.query ?? "").trim();

  if (input.action === "refresh_directory") {
    if (!teamId) {
      return {
        success: false,
        ok: false,
        action: input.action,
        error: {
          code: "BAXTER_SLACK_TEAM_REQUIRED",
          message: "teamId required (set SLACK_ALLOWED_TEAM_IDS / pass teamId)",
        },
      };
    }
    const refreshed = await refreshAndListDirectory(teamId, undefined, { mode: "full" });
    const r = refreshed.refresh;
    // Useful partial directories (e.g. cursor_cycle after 200 channels) are still success.
    const usable = r.usersUpserted > 0 || r.channelsUpserted > 0;
    const success = usable || (!r.timedOut && r.errors.length === 0);
    return {
      success,
      ok: success,
      status: r.paginationComplete && !r.timedOut ? "complete" : "partial",
      action: input.action,
      summary: {
        users: {
          discovered: r.usersUpserted,
          activeHumans: r.activeHumans,
          updated: r.usersUpserted,
        },
        channels: {
          discovered: r.channelsUpserted,
          public: r.publicChannels,
          private: r.privateChannels,
          archived: r.archivedChannels,
          updated: r.channelsUpserted,
        },
        pages: {
          users: r.pagesFetched.users,
          channels: r.pagesFetched.channels,
        },
        complete: r.paginationComplete && !r.timedOut,
        incompleteReason: r.incompleteReason,
        durationMs: r.durationMs,
        warnings: [
          ...(r.timedOut ? ["Directory refresh timed out"] : []),
          ...(r.incompleteReason ? [`Partial refresh: ${r.incompleteReason}`] : []),
          ...r.errors.slice(0, 5),
        ],
        cachedAfter: {
          users: refreshed.users.length,
          channels: refreshed.channels.length,
        },
        refreshedAt: r.refreshedAt,
      },
      // legacy fields for older clients
      usersDiscovered: r.usersUpserted,
      publicChannelsDiscovered: r.publicChannels,
      privateChannelsVisible: r.privateChannels,
      activeHumans: r.activeHumans,
      paginationComplete: r.paginationComplete,
      pagesFetched: r.pagesFetched,
      errors: r.errors,
      updated: r.refreshedAt,
      cachedAfter: {
        users: refreshed.users.length,
        channels: refreshed.channels.length,
      },
      error:
        success || !r.timedOut
          ? undefined
          : {
              code: r.timedOut
                ? "BAXTER_SLACK_DIRECTORY_TIMEOUT"
                : "BAXTER_SLACK_DIRECTORY_REFRESH_FAILED",
              message: r.errors[0] ?? "Directory refresh failed",
            },
    };
  }

  if (input.action === "test_slack_recall") {
    const personQ = (input.person ?? "James").trim();
    const channelQ = (input.channel ?? "baxter").trim();
    const started = Date.now();
    const q = `What did ${personQ} say last in #${channelQ.replace(/^#/, "")}?`;
    const evidence = await retrieveSlackEvidence({
      requester: {
        ...input.requester,
        allowPublicOnlyFallback: true,
        slackUserId: input.requester.slackUserId ?? "admin-diagnostic",
        slackTeamId: teamId || input.requester.slackTeamId,
      },
      question: q,
    });
    const person = evidence.plan?.people[0] ?? null;
    const channel = evidence.plan?.channels[0] ?? null;
    const latest = evidence.results[0] ?? null;
    return {
      success: Boolean(person && channel && latest),
      ok: Boolean(person && channel && latest),
      action: input.action,
      summary: {
        person: person
          ? { id: person.id, displayName: person.displayName }
          : { query: personQ, found: false },
        channel: channel
          ? {
              id: channel.id,
              name: channel.name,
              displayLabel: channel.displayLabel,
            }
          : { query: channelQ, found: false },
        historyAccess: !evidence.incomplete || evidence.results.length > 0,
        latestMessageFound: Boolean(latest),
        permalink: Boolean(latest?.permalink),
        durationMs: Date.now() - started,
        incomplete: evidence.incomplete
          ? { code: evidence.incomplete.code, message: evidence.incomplete.message }
          : null,
        retrievalMethod: evidence.diagnostics.endpoint,
        notes: evidence.diagnostics.notes.slice(0, 8),
      },
    };
  }

  if (input.action === "test_user_resolution") {
    const users = await listCachedSlackUsers(teamId);
    const q = query || "Jackson Bridges";
    const result = resolvePersonFromDirectory(q, users);
    return {
      ok: result.status === "resolved",
      action: input.action,
      query: q,
      usersCached: users.length,
      result:
        result.status === "resolved"
          ? {
              id: result.person.id,
              displayName: result.person.displayName,
              realName: result.person.realName,
            }
          : result.status === "ambiguous"
            ? {
                ambiguous: true,
                candidates: result.ambiguity.candidates.map((c) => ({
                  displayName: c.displayName,
                  realName: c.realName,
                })),
              }
            : { notFound: true },
    };
  }

  if (input.action === "test_channel_resolution") {
    const channels = await listCachedSlackChannels(teamId);
    const q = query || "project-management";
    const result = resolveChannelFromDirectory(q, channels);
    if (result.status === "resolved") {
      let accessNotes: string[] = [];
      let botHistory: string = "not_tested";
      try {
        const { resolveChannelAccess } = await import("./access");
        const { resolveSearchCredential } = await import("./permissions");
        const cred = await resolveSearchCredential({
          ...input.requester,
          allowPublicOnlyFallback: true,
          slackUserId: input.requester.slackUserId ?? "admin-diagnostic",
        });
        if (cred.ok) {
          const access = await resolveChannelAccess({
            channel: result.channel,
            credential: cred.credential,
          });
          accessNotes = access.notes;
          botHistory = access.canReadHistory
            ? "available"
            : access.requiresUserOauth
              ? "requires_user_oauth"
              : "unavailable";
          return {
            ok: true,
            action: input.action,
            query: q,
            channelsCached: channels.length,
            result: {
              id: access.channel.id,
              name: access.channel.name,
              displayLabel: access.channel.displayLabel,
              kind: access.channel.kind,
              isPrivate: access.isPrivate,
              isArchived: access.isArchived,
              botMember: access.isMember,
              botHistory,
              accessNotes,
            },
          };
        }
      } catch {
        // fall through to basic result
      }
      return {
        ok: true,
        action: input.action,
        query: q,
        channelsCached: channels.length,
        result: {
          id: result.channel.id,
          name: result.channel.name,
          displayLabel: result.channel.displayLabel,
          kind: result.channel.kind,
          isPrivate: result.channel.isPrivate,
          isArchived: result.channel.isArchived ?? null,
          botMember: result.channel.isMember ?? null,
          botHistory,
        },
      };
    }
    return {
      ok: false,
      action: input.action,
      query: q,
      channelsCached: channels.length,
      result:
        result.status === "ambiguous"
          ? {
              ambiguous: true,
              candidates: result.ambiguity.candidates.map((c) => ({
                name: c.name,
                displayLabel: c.displayLabel,
              })),
            }
          : { notFound: true },
    };
  }

  if (
    input.action === "test_thread_retrieval" ||
    input.action === "test_public_search" ||
    input.action === "test_latest_message" ||
    input.action === "test_channel_summary" ||
    input.action === "sandbox_search"
  ) {
    const q =
      query ||
      (input.action === "test_latest_message"
        ? "What did Jess say last in #project-management?"
        : input.action === "test_channel_summary"
          ? "Tell me anything you can about what has been said in the baxter channel."
          : "RACI matrix");
    const evidence = await retrieveSlackEvidence({
      requester: {
        ...input.requester,
        allowPublicOnlyFallback: true,
        slackUserId: input.requester.slackUserId ?? "admin-diagnostic",
        slackTeamId: teamId || input.requester.slackTeamId,
      },
      question: q,
    });
    return {
      ok: !evidence.incomplete || evidence.results.length > 0,
      action: input.action,
      query: q,
      requesterResolved: Boolean(input.requester.baxterUserId || input.requester.slackUserId),
      personResolved: (evidence.plan?.people.length ?? 0) > 0,
      channelResolved: (evidence.plan?.channels.length ?? 0) > 0,
      credentialPath: evidence.access.tokenKind,
      retrievalMethod: evidence.diagnostics.endpoint,
      apiSuccess: !evidence.incomplete || evidence.results.length > 0,
      messagesInspected: evidence.diagnostics.resultCount,
      matchingResults: evidence.results.length,
      permalinkGenerated: evidence.results.some((r) => Boolean(r.permalink)),
      plan: evidence.plan
        ? {
            intent: evidence.plan.intent,
            keywords: evidence.plan.keywords,
            sort: evidence.plan.sort,
            limit: evidence.plan.limit,
            people: evidence.plan.people.map((p) => ({
              id: p.id,
              displayName: p.displayName,
            })),
            channels: evidence.plan.channels.map((c) => ({
              id: c.id,
              displayLabel: c.displayLabel,
              kind: c.kind,
            })),
            timeRange: evidence.plan.timeRange?.label ?? null,
          }
        : null,
      access: {
        tokenKind: evidence.access.tokenKind,
        userLevelAuthorization: evidence.access.userLevelAuthorization,
        allowedChannelTypes: evidence.access.allowedChannelTypes,
        publicChannels: evidence.access.publicChannels,
        privateChannels: evidence.access.privateChannels,
        dms: evidence.access.dms,
      },
      incomplete: evidence.incomplete,
      diagnostics: {
        endpoint: evidence.diagnostics.endpoint,
        latencyMs: evidence.diagnostics.latencyMs,
        resultCount: evidence.diagnostics.resultCount,
        paginationCount: evidence.diagnostics.paginationCount,
        rateLimited: evidence.diagnostics.rateLimited,
        exactNewestGuaranteed: evidence.diagnostics.exactNewestGuaranteed,
        notes: evidence.diagnostics.notes,
      },
      results:
        input.action === "sandbox_search"
          ? formatSlackEvidenceForAdmin(evidence.results.slice(0, 10))
          : formatSlackEvidenceForAdmin(evidence.results.slice(0, 5)).map((r) => ({
              author: r.author,
              channel: r.channel,
              timestamp: r.timestamp,
              permalink: r.permalink,
              excerpt: r.excerpt?.slice(0, 80) ?? null,
            })),
      threadContextSample:
        input.action === "test_thread_retrieval"
          ? (evidence.results[0]?.contextMessages?.slice(0, 5).map((m) => ({
              excerpt: m.text.slice(0, 120),
              author: m.authorName,
            })) ?? [])
          : undefined,
    };
  }

  return { ok: false, action: input.action, error: "unknown_action" };
}

export async function previewSlackSearchPlan(question: string, teamId: string) {
  return planSlackSearch({
    question,
    teamId,
    deps: {
      listCachedUsers: listCachedSlackUsers,
      listCachedChannels: listCachedSlackChannels,
    },
  });
}
