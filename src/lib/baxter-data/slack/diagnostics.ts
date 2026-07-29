import "server-only";

import { getSlackSearchRuntimeConfig, scopesToCapabilities } from "./config";
import { getSlackSearchConnectionMetadata } from "./connections";
import { retrieveSlackEvidence } from "./evidence";
import { formatSlackEvidenceForAdmin } from "./format";
import { planSlackSearch } from "./query-plan";
import { listCachedSlackChannels, listCachedSlackUsers } from "./directory";
import { resolvePersonFromDirectory } from "./users";
import { resolveChannelFromDirectory } from "./channels";
import type { SlackRequester } from "./types";

export async function getSlackSearchDiagnosticsSnapshot(adminUserId?: string) {
  const config = getSlackSearchRuntimeConfig();
  const connection = adminUserId ? await getSlackSearchConnectionMetadata(adminUserId) : null;

  const linkedScopes = connection?.scopes ?? [];
  const linkedCaps = scopesToCapabilities(linkedScopes);
  const envPublicOnly = config.userTokenEnvPresent;

  const status = !config.searchEnabled
    ? "disabled"
    : connection?.linked || config.readyForPublicBotSearch
      ? "ready"
      : config.readyForUserOauth
        ? "needs_setup"
        : "needs_setup";

  return {
    status: status as "ready" | "needs_setup" | "disabled",
    workspaceLabel: "Acton ADU",
    searchEnabled: config.searchEnabled,
    searchEnabledLabel: config.searchEnabled ? "Enabled" : "Disabled",
    readyForUserOauth: config.readyForUserOauth,
    readyForPublicBotSearch: config.readyForPublicBotSearch,
    missingForUserOauth: config.missingForUserOauth,
    oauthRedirectUri: config.oauthRedirectUri,
    userLevelAuthorization: connection?.linked
      ? ("configured" as const)
      : envPublicOnly || config.readyForPublicBotSearch
        ? ("partial" as const)
        : ("not_configured" as const),
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
      slackUserResolution: config.integrationEnabled,
      slackChannelResolution: config.integrationEnabled,
      slackPermalinkGeneration: config.botTokenPresent,
    },
    connection: connection
      ? {
          linked: connection.linked,
          slackUserName: connection.slackUserName,
          slackUserId: connection.slackUserId,
          status: connection.status,
          // Never expose tokens
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
    | "sandbox_search";
  query?: string;
  teamId?: string;
  requester: SlackRequester;
}) {
  const teamId = input.teamId || input.requester.slackTeamId || "";
  const query = (input.query ?? "").trim();

  if (input.action === "test_user_resolution") {
    const users = await listCachedSlackUsers(teamId);
    const q = query || "Jackson Bridges";
    const result = resolvePersonFromDirectory(q, users);
    return {
      ok: result.status === "resolved",
      action: input.action,
      query: q,
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
    return {
      ok: result.status === "resolved",
      action: input.action,
      query: q,
      result:
        result.status === "resolved"
          ? {
              id: result.channel.id,
              name: result.channel.name,
              displayLabel: result.channel.displayLabel,
              kind: result.channel.kind,
            }
          : result.status === "ambiguous"
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
    input.action === "sandbox_search"
  ) {
    const q =
      query ||
      (input.action === "test_latest_message"
        ? "What did Jess say last in #project-management?"
        : input.action === "test_thread_retrieval"
          ? "RACI matrix"
          : "RACI matrix");
    const evidence = await retrieveSlackEvidence({
      requester: {
        ...input.requester,
        allowPublicOnlyFallback: true,
        slackUserId: input.requester.slackUserId ?? "admin-diagnostic",
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
