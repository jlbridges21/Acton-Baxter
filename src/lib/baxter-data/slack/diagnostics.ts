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
    : connection?.linked || (config.readyForPublicBotSearch && config.userTokenEnvPresent)
      ? "ready"
      : config.readyForUserOauth
        ? "needs_setup"
        : "needs_setup";

  return {
    status: status as "ready" | "needs_setup" | "disabled",
    workspaceLabel: "Acton ADU",
    searchEnabled: config.searchEnabled,
    readyForUserOauth: config.readyForUserOauth,
    missingForUserOauth: config.missingForUserOauth,
    oauthRedirectUri: config.oauthRedirectUri,
    userLevelAuthorization: connection?.linked
      ? ("configured" as const)
      : envPublicOnly
        ? ("partial" as const)
        : ("not_configured" as const),
    capabilities: {
      publicChannels: linkedCaps.publicChannels || envPublicOnly || config.readyForPublicBotSearch,
      privateChannels: linkedCaps.privateChannels,
      dms: linkedCaps.dms,
      groupDms: linkedCaps.groupDms,
      threadContext: linkedCaps.threadContext || config.botTokenPresent,
      permalinks: true,
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
    input.action === "sandbox_search"
  ) {
    const q = query || (input.action === "test_thread_retrieval" ? "RACI matrix" : "RACI matrix");
    const evidence = await retrieveSlackEvidence({
      requester: {
        ...input.requester,
        allowPublicOnlyFallback: true,
      },
      question: q,
    });
    return {
      ok: !evidence.incomplete || evidence.results.length > 0,
      action: input.action,
      query: q,
      plan: evidence.plan
        ? {
            intent: evidence.plan.intent,
            keywords: evidence.plan.keywords,
            sort: evidence.plan.sort,
            limit: evidence.plan.limit,
            people: evidence.plan.people.map((p) => p.displayName),
            channels: evidence.plan.channels.map((c) => c.displayLabel),
            timeRange: evidence.plan.timeRange?.label ?? null,
          }
        : null,
      access: evidence.access,
      incomplete: evidence.incomplete,
      diagnostics: {
        endpoint: evidence.diagnostics.endpoint,
        latencyMs: evidence.diagnostics.latencyMs,
        resultCount: evidence.diagnostics.resultCount,
        paginationCount: evidence.diagnostics.paginationCount,
        rateLimited: evidence.diagnostics.rateLimited,
        notes: evidence.diagnostics.notes,
      },
      results: formatSlackEvidenceForAdmin(evidence.results.slice(0, 10)),
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
