import { callSlackApi } from "./api";
import { mapSlackSearchApiError, SLACK_SEARCH_ERROR_CODES } from "./errors";
import { filterAllowedChannelTypes } from "./permissions";
import { buildSlackSearchQuery } from "./query-plan";
import { groupEvidenceIntoClusters, normalizeSearchMessage } from "./normalize";
import { fetchLatestMessageInChannel, fetchPermalink, fetchThreadContext } from "./threads";
import type {
  SlackApiCallResult,
  SlackCredentialResolution,
  SlackMessageEvidence,
  SlackQueryPlan,
  SlackSearchDeps,
  SlackSearchDiagnostics,
  SlackSearchIncomplete,
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

  // Exact last-message path
  if (
    input.plan.intent === "latest_message" &&
    input.plan.channels.length === 1 &&
    input.credential.capabilities.threadContext
  ) {
    const latest = await fetchLatestMessageInChannel({
      credential: input.credential,
      plan: input.plan,
      deps: input.deps,
    });
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
          notes: ["Used conversations.history for exact newest message."],
        },
      };
    }
    notes.push(
      "conversations.history did not return a matching newest message; falling back to Real-time Search.",
    );
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
      // Fall back once to legacy search.messages for user tokens
      if (
        pages === 1 &&
        input.credential.tokenKind === "user" &&
        (response.error === "method_not_supported" ||
          response.error === "unknown_method" ||
          response.error === "not_allowed_token_type" ||
          response.error === "missing_scope")
      ) {
        notes.push(
          `assistant.search.context unavailable (${response.error}); trying search.messages.`,
        );
        return executeLegacySearchMessages({
          ...input,
          query,
          channelTypes,
          start,
          notes,
        });
      }
      incomplete = {
        code: mapSlackSearchApiError(response.error),
        message: "Slack search request failed.",
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

async function executeLegacySearchMessages(input: {
  plan: SlackQueryPlan;
  credential: SlackCredentialResolution;
  deps?: SlackSearchDeps;
  query: string;
  channelTypes: string[];
  start: number;
  notes: string[];
}): Promise<ExecuteSlackSearchResult> {
  // Legacy search.messages only accepts user tokens with search:read
  if (!input.channelTypes.includes("public_channel") && input.channelTypes.length === 0) {
    return {
      results: [],
      incomplete: {
        code: SLACK_SEARCH_ERROR_CODES.PERMISSION_DENIED,
        message: "No channel types available for legacy search.",
        retryable: false,
      },
      diagnostics: {
        endpoint: "search.messages",
        latencyMs: Date.now() - input.start,
        resultCount: 0,
        paginationCount: 0,
        rateLimited: false,
        exactNewestGuaranteed: null,
        notes: input.notes,
      },
    };
  }

  const sort = input.plan.sort === "relevance" ? "score" : "timestamp";
  const sortDir = input.plan.sort === "oldest" ? "asc" : "desc";
  const response = await apiCall(input.deps, "search.messages", input.credential.token, {
    query: input.query,
    sort,
    sort_dir: sortDir,
    count: Math.min(input.plan.limit, 20),
  });

  if (!response.ok) {
    return {
      results: [],
      incomplete: {
        code: mapSlackSearchApiError(response.error),
        message: "Legacy Slack search.messages failed.",
        retryable: response.error === "ratelimited",
      },
      diagnostics: {
        endpoint: "search.messages",
        latencyMs: Date.now() - input.start,
        resultCount: 0,
        paginationCount: 1,
        rateLimited: response.error === "ratelimited",
        exactNewestGuaranteed: null,
        notes: input.notes,
      },
    };
  }

  const matches =
    ((response.data.messages as { matches?: Array<Record<string, unknown>> } | undefined)
      ?.matches as Array<Record<string, unknown>> | undefined) ?? [];

  const results: SlackMessageEvidence[] = [];
  for (const match of matches) {
    const channel = match.channel as
      { id?: string; name?: string; is_private?: boolean } | undefined;
    const normalized = normalizeSearchMessage({
      message_ts: match.ts,
      channel_id: channel?.id,
      channel_name: channel?.name,
      is_private: channel?.is_private,
      author_user_id: match.user,
      author_name: match.username,
      content: match.text,
      permalink: match.permalink,
      thread_ts: match.thread_ts,
    });
    if (normalized) results.push(normalized);
  }

  return {
    results,
    incomplete: null,
    diagnostics: {
      endpoint: "search.messages",
      latencyMs: Date.now() - input.start,
      resultCount: results.length,
      paginationCount: 1,
      rateLimited: false,
      exactNewestGuaranteed: null,
      notes: input.notes,
    },
  };
}

export { groupEvidenceIntoClusters };
