import { callSlackApi } from "./api";
import { mapSlackSearchApiError, SLACK_SEARCH_ERROR_CODES } from "./errors";
import { filterAllowedChannelTypes } from "./permissions";
import { buildSlackSearchQuery } from "./query-plan";
import {
  groupEvidenceIntoClusters,
  normalizeHistoryMessage,
  normalizeSearchMessage,
} from "./normalize";
import { fetchLatestMessageInChannel, fetchPermalink, fetchThreadContext } from "./threads";
import type {
  SlackApiCallResult,
  SlackChannelKind,
  SlackCredentialResolution,
  SlackMessageEvidence,
  SlackQueryPlan,
  SlackSearchDeps,
  SlackSearchDiagnostics,
  SlackSearchIncomplete,
  SlackTimeRange,
} from "./types";

async function apiCall(
  deps: SlackSearchDeps | undefined,
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SlackApiCallResult> {
  if (deps?.callSlackApi) return deps.callSlackApi(method, { token, body });
  return callSlackApi(method, { token, body });
}

async function fetchChannelHistoryWindow(input: {
  credential: SlackCredentialResolution;
  channelId: string;
  channelName: string | null;
  channelKind: SlackChannelKind | null;
  limit: number;
  timeRange: SlackTimeRange | null;
  deps?: SlackSearchDeps;
}): Promise<{ messages: SlackMessageEvidence[]; pagesFetched: number; notes: string[] }> {
  const notes: string[] = [];
  const body: Record<string, unknown> = {
    channel: input.channelId,
    limit: Math.min(Math.max(input.limit, 1), 50),
  };
  if (input.timeRange) {
    body.oldest = String(input.timeRange.fromUnix);
    body.latest = String(input.timeRange.toUnix);
  }
  let result = await apiCall(input.deps, "conversations.history", input.credential.token, body);
  if (
    !result.ok &&
    (result.error === "not_in_channel" || result.error === "channel_not_found") &&
    (input.credential.tokenKind === "bot_public" ||
      input.credential.tokenKind === "bot_with_action_token")
  ) {
    const join = await apiCall(input.deps, "conversations.join", input.credential.token, {
      channel: input.channelId,
    });
    notes.push(join.ok ? "Joined public channel." : `join failed: ${join.error ?? "unknown"}`);
    if (join.ok) {
      result = await apiCall(input.deps, "conversations.history", input.credential.token, body);
    }
  }
  if (!result.ok) {
    notes.push(`history failed: ${result.error ?? "unknown"}`);
    return { messages: [], pagesFetched: 1, notes };
  }
  const raw = (result.data.messages as Array<Record<string, unknown>> | undefined) ?? [];
  const messages = raw
    .map((m) =>
      normalizeHistoryMessage({
        message: m,
        channelId: input.channelId,
        channelName: input.channelName,
        channelKind: input.channelKind,
      }),
    )
    .filter((m): m is SlackMessageEvidence => Boolean(m));
  return { messages, pagesFetched: 1, notes };
}

function filterMessagesByKeywords(
  messages: SlackMessageEvidence[],
  keywords: string[],
): SlackMessageEvidence[] {
  if (!keywords.length) return messages;
  const terms = keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= 2);
  if (!terms.length) return messages;
  return messages.filter((m) => {
    const text = m.text.toLowerCase();
    return terms.some((t) => text.includes(t));
  });
}

export type ExecuteSlackSearchResult = {
  results: SlackMessageEvidence[];
  incomplete: SlackSearchIncomplete | null;
  diagnostics: Pick<
    SlackSearchDiagnostics,
    | "endpoint"
    | "latencyMs"
    | "resultCount"
    | "paginationCount"
    | "rateLimited"
    | "exactNewestGuaranteed"
    | "notes"
  >;
};

/**
 * Execute a validated query plan against Slack Real-time Search (assistant.search.context).
 * Composable — Prompt 2 can call multiple times and merge.
 */
export async function executeSlackSearchPlan(input: {
  plan: SlackQueryPlan;
  credential: SlackCredentialResolution;
  deps?: SlackSearchDeps;
  maxPages?: number;
}): Promise<ExecuteSlackSearchResult> {
  const notes: string[] = [];
  const start = Date.now();

  // Exact last-message / channel-scoped history path
  const canUseHistory =
    input.credential.capabilities.threadContext &&
    (input.plan.intent === "latest_message" ||
      input.plan.intent === "channel_search" ||
      input.credential.tokenKind === "bot_public") &&
    input.plan.channels.length === 1;

  if (canUseHistory && input.plan.intent === "latest_message") {
    const latest = await fetchLatestMessageInChannel({
      credential: input.credential,
      plan: input.plan,
      deps: input.deps,
    });
    notes.push(...latest.notes);
    if (latest.message) {
      return {
        results: [latest.message],
        incomplete: null,
        diagnostics: {
          endpoint: "conversations.history",
          latencyMs: Date.now() - start,
          resultCount: 1,
          paginationCount: latest.pagesFetched,
          rateLimited: false,
          exactNewestGuaranteed: latest.exactNewestGuaranteed,
          notes: [
            ...notes,
            "Used conversations.history for exact newest message.",
            `credential=${input.credential.tokenKind}`,
          ],
        },
      };
    }
    notes.push(
      "conversations.history did not return a matching newest message; falling back if RTS available.",
    );
  }

  // bot_public cannot call assistant.search.context without action_token
  if (input.credential.tokenKind === "bot_public") {
    // latest_message already attempted above — empty means searched_no_results, not auth failure
    if (input.plan.intent === "latest_message" && input.plan.channels.length === 1) {
      return {
        results: [],
        incomplete: null,
        diagnostics: {
          endpoint: "conversations.history",
          latencyMs: Date.now() - start,
          resultCount: 0,
          paginationCount: 0,
          rateLimited: false,
          exactNewestGuaranteed: true,
          notes: [
            ...notes,
            "bot_public latest_message: no matching author in recent public channel history.",
          ],
        },
      };
    }

    if (input.plan.channels.length === 1) {
      if (!input.plan.people.length) {
        const hist = await fetchChannelHistoryWindow({
          credential: input.credential,
          channelId: input.plan.channels[0]!.id,
          channelName: input.plan.channels[0]!.name,
          channelKind: input.plan.channels[0]!.kind,
          limit: Math.min(input.plan.limit, 20),
          timeRange: input.plan.timeRange,
          deps: input.deps,
        });
        notes.push(...hist.notes);
        const filtered = filterMessagesByKeywords(hist.messages, input.plan.keywords);
        return {
          results: filtered.length ? filtered : hist.messages.slice(0, input.plan.limit),
          incomplete: null,
          diagnostics: {
            endpoint: "conversations.history",
            latencyMs: Date.now() - start,
            resultCount: filtered.length || hist.messages.length,
            paginationCount: hist.pagesFetched,
            rateLimited: false,
            exactNewestGuaranteed: null,
            notes: [...notes, "bot_public used conversations.history (no action_token for RTS)."],
          },
        };
      }

      const latest = await fetchLatestMessageInChannel({
        credential: input.credential,
        plan: input.plan,
        deps: input.deps,
      });
      notes.push(...latest.notes);
      return {
        results: latest.message ? [latest.message] : [],
        incomplete: null,
        diagnostics: {
          endpoint: "conversations.history",
          latencyMs: Date.now() - start,
          resultCount: latest.message ? 1 : 0,
          paginationCount: latest.pagesFetched,
          rateLimited: false,
          exactNewestGuaranteed: latest.exactNewestGuaranteed,
          notes: [...notes, "bot_public person+channel history path."],
        },
      };
    }

    // Topic / status without a resolved channel: bounded public-channel history scan
    if (input.plan.keywords.length > 0 && input.deps?.listCachedChannels) {
      const teamId = input.credential.slackTeamId ?? "";
      const directory = await input.deps.listCachedChannels(teamId);
      const publicChannels = directory
        .filter((c) => !c.isPrivate && c.kind === "public_channel")
        .slice(0, 8);
      const scanned: SlackMessageEvidence[] = [];
      let pages = 0;
      for (const channel of publicChannels) {
        if (scanned.length >= input.plan.limit) break;
        const hist = await fetchChannelHistoryWindow({
          credential: input.credential,
          channelId: channel.id,
          channelName: channel.name,
          channelKind: channel.kind,
          limit: 40,
          timeRange: input.plan.timeRange,
          deps: input.deps,
        });
        pages += hist.pagesFetched;
        notes.push(...hist.notes.map((n) => `#${channel.name}: ${n}`));
        const hits = filterMessagesByKeywords(hist.messages, input.plan.keywords);
        for (const hit of hits) {
          if (input.plan.people.length && hit.authorId) {
            const allowed = new Set(input.plan.people.map((p) => p.id));
            if (!allowed.has(hit.authorId)) continue;
          }
          scanned.push(hit);
          if (scanned.length >= input.plan.limit) break;
        }
      }
      scanned.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
      return {
        results: scanned.slice(0, input.plan.limit),
        incomplete: null,
        diagnostics: {
          endpoint: "conversations.history",
          latencyMs: Date.now() - start,
          resultCount: scanned.length,
          paginationCount: pages,
          rateLimited: false,
          exactNewestGuaranteed: null,
          notes: [
            ...notes,
            `bot_public bounded public-channel keyword scan (${publicChannels.length} channels).`,
          ],
        },
      };
    }

    return {
      results: [],
      incomplete: {
        code: SLACK_SEARCH_ERROR_CODES.AUTH_REQUIRED,
        message:
          "Workspace-wide Slack search needs a linked Slack Search connection (or a Slack action token). I couldn't run a public-channel history scan for this question.",
        retryable: false,
      },
      diagnostics: {
        endpoint: null,
        latencyMs: Date.now() - start,
        resultCount: 0,
        paginationCount: 0,
        rateLimited: false,
        exactNewestGuaranteed: null,
        notes: [...notes, "bot_public cannot run assistant.search.context without action_token."],
      },
    };
  }

  const channelTypes = filterAllowedChannelTypes(undefined, input.credential.capabilities);
  if (channelTypes.length === 0) {
    return {
      results: [],
      incomplete: {
        code: SLACK_SEARCH_ERROR_CODES.PERMISSION_DENIED,
        message: "No searchable Slack channel types are available for this credential.",
        retryable: false,
      },
      diagnostics: {
        endpoint: null,
        latencyMs: Date.now() - start,
        resultCount: 0,
        paginationCount: 0,
        rateLimited: false,
        exactNewestGuaranteed: null,
        notes,
      },
    };
  }

  const query = buildSlackSearchQuery(input.plan);
  const sort = input.plan.sort === "relevance" ? "score" : "timestamp";
  const sortDir = input.plan.sort === "oldest" ? "asc" : "desc";
  const limit = Math.min(Math.max(input.plan.limit, 1), 20);
  const maxPages = Math.min(input.maxPages ?? 2, 3);

  const results: SlackMessageEvidence[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let rateLimited = false;
  let incomplete: SlackSearchIncomplete | null = null;

  while (pages < maxPages && results.length < limit) {
    pages += 1;
    const body: Record<string, unknown> = {
      query,
      channel_types: channelTypes,
      content_types: ["messages"],
      include_context_messages: input.plan.includeNearbyContext,
      include_bots: false,
      sort,
      sort_dir: sortDir,
      limit: Math.min(limit - results.length, 20),
      disable_semantic_search: input.plan.intent === "latest_message",
    };
    if (input.plan.timeRange) {
      body.after = input.plan.timeRange.fromUnix;
      body.before = input.plan.timeRange.toUnix;
    }
    if (cursor) body.cursor = cursor;
    if (input.credential.tokenKind === "bot_with_action_token" && input.credential.actionToken) {
      body.action_token = input.credential.actionToken;
    }

    const response = await apiCall(
      input.deps,
      "assistant.search.context",
      input.credential.token,
      body,
    );

    if (!response.ok) {
      if (response.error === "ratelimited") {
        rateLimited = true;
        incomplete = {
          code: SLACK_SEARCH_ERROR_CODES.RATE_LIMITED,
          message: "Slack search rate-limited.",
          retryable: true,
        };
        break;
      }
      // Real-time Search only — no legacy search API fallback.
      incomplete = {
        code: mapSlackSearchApiError(response.error),
        message: "Slack Real-time Search request failed.",
        retryable: false,
      };
      break;
    }

    const payload = response.data.results as
      { messages?: Array<Record<string, unknown>> } | undefined;
    const messages = payload?.messages ?? [];
    for (const raw of messages) {
      const normalized = normalizeSearchMessage(raw);
      if (!normalized) continue;
      results.push(normalized);
    }

    const next = (response.data.response_metadata as { next_cursor?: string } | undefined)
      ?.next_cursor;
    if (!next || messages.length === 0) break;
    cursor = next;
  }

  // Enrich missing permalinks (bounded)
  for (const item of results.slice(0, 10)) {
    if (item.permalink) continue;
    const permalink = await fetchPermalink({
      credential: input.credential,
      channelId: item.channelId,
      messageTs: item.messageTs,
      deps: input.deps,
    });
    if (permalink) item.permalink = permalink;
  }

  // Optional thread expansion for top hits
  if (input.plan.includeThreads && input.credential.capabilities.threadContext) {
    for (const item of results.slice(0, 5)) {
      if (!item.threadTs) continue;
      const thread = await fetchThreadContext({
        credential: input.credential,
        channelId: item.channelId,
        threadTs: item.threadTs,
        limit: 12,
        deps: input.deps,
      });
      if (thread.length > 1) {
        item.contextMessages = [
          ...item.contextMessages,
          ...thread
            .filter((m) => m.messageTs !== item.messageTs)
            .slice(0, 8)
            .map((m) => ({
              messageTs: m.messageTs,
              authorId: m.authorId,
              authorName: m.authorName,
              text: m.text,
              timestamp: m.timestamp,
            })),
        ];
      }
    }
  }

  return {
    results: results.slice(0, limit),
    incomplete,
    diagnostics: {
      endpoint: "assistant.search.context",
      latencyMs: Date.now() - start,
      resultCount: results.length,
      paginationCount: pages,
      rateLimited,
      exactNewestGuaranteed:
        input.plan.intent === "latest_message" ? results.length <= 1 && sort === "timestamp" : null,
      notes,
    },
  };
}

export { groupEvidenceIntoClusters };
