import { callSlackApi } from "./api";
import { normalizeHistoryMessage } from "./normalize";
import type {
  SlackApiCallResult,
  SlackCredentialResolution,
  SlackMessageEvidence,
  SlackQueryPlan,
  SlackSearchDeps,
} from "./types";

async function apiCall(
  deps: SlackSearchDeps | undefined,
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SlackApiCallResult> {
  if (deps?.callSlackApi) {
    return deps.callSlackApi(method, { token, body });
  }
  return callSlackApi(method, { token, body });
}

/**
 * Fetch a bounded window of thread replies for a search hit.
 * Does not fetch entire channel history.
 */
export async function fetchThreadContext(input: {
  credential: SlackCredentialResolution;
  channelId: string;
  threadTs: string;
  limit?: number;
  deps?: SlackSearchDeps;
}): Promise<SlackMessageEvidence[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const result = await apiCall(input.deps, "conversations.replies", input.credential.token, {
    channel: input.channelId,
    ts: input.threadTs,
    limit,
    inclusive: true,
  });
  if (!result.ok) return [];
  const messages = (result.data.messages as Array<Record<string, unknown>> | undefined) ?? [];
  return messages
    .map((m) =>
      normalizeHistoryMessage({
        message: m,
        channelId: input.channelId,
      }),
    )
    .filter((m): m is SlackMessageEvidence => Boolean(m));
}

/**
 * Nearby non-thread context via conversations.history (bounded).
 */
export async function fetchNearbyContext(input: {
  credential: SlackCredentialResolution;
  channelId: string;
  aroundTs: string;
  beforeCount?: number;
  afterCount?: number;
  deps?: SlackSearchDeps;
}): Promise<SlackMessageEvidence[]> {
  const beforeCount = Math.min(input.beforeCount ?? 3, 5);
  const afterCount = Math.min(input.afterCount ?? 2, 5);

  const older = await apiCall(input.deps, "conversations.history", input.credential.token, {
    channel: input.channelId,
    latest: input.aroundTs,
    inclusive: true,
    limit: beforeCount + 1,
  });
  const newer = await apiCall(input.deps, "conversations.history", input.credential.token, {
    channel: input.channelId,
    oldest: input.aroundTs,
    inclusive: false,
    limit: afterCount,
  });

  const out: SlackMessageEvidence[] = [];
  for (const result of [older, newer]) {
    if (!result.ok) continue;
    const messages = (result.data.messages as Array<Record<string, unknown>> | undefined) ?? [];
    for (const m of messages) {
      const normalized = normalizeHistoryMessage({
        message: m,
        channelId: input.channelId,
      });
      if (normalized) out.push(normalized);
    }
  }
  return out;
}

export async function fetchPermalink(input: {
  credential: SlackCredentialResolution;
  channelId: string;
  messageTs: string;
  deps?: SlackSearchDeps;
}): Promise<string | null> {
  const result = await apiCall(input.deps, "chat.getPermalink", input.credential.token, {
    channel: input.channelId,
    message_ts: input.messageTs,
  });
  if (!result.ok) return null;
  return typeof result.data.permalink === "string" ? result.data.permalink : null;
}

/**
 * Exact newest message for person+channel when possible via conversations.history.
 * Returns metadata about whether newest is guaranteed.
 * For public channels, may attempt conversations.join once if bot is not a member.
 */
export async function fetchLatestMessageInChannel(input: {
  credential: SlackCredentialResolution;
  plan: SlackQueryPlan;
  deps?: SlackSearchDeps;
}): Promise<{
  message: SlackMessageEvidence | null;
  exactNewestGuaranteed: boolean;
  pagesFetched: number;
  notes: string[];
}> {
  const channel = input.plan.channels[0];
  const person = input.plan.people[0];
  const notes: string[] = [];
  if (!channel) {
    return { message: null, exactNewestGuaranteed: false, pagesFetched: 0, notes };
  }

  // Private channels require user-level credentials — never join private.
  if (channel.isPrivate || channel.kind === "private_channel") {
    if (
      input.credential.tokenKind === "bot_public" ||
      input.credential.tokenKind === "bot_with_action_token"
    ) {
      notes.push("Skipped bot history for private channel — user OAuth required.");
      return { message: null, exactNewestGuaranteed: false, pagesFetched: 0, notes };
    }
  }

  let cursor: string | undefined;
  let pages = 0;
  const maxPages = 8;
  let attemptedJoin = false;

  while (pages < maxPages) {
    pages += 1;
    const body: Record<string, unknown> = {
      channel: channel.id,
      limit: 100,
    };
    if (cursor) body.cursor = cursor;
    if (input.plan.timeRange) {
      body.oldest = String(input.plan.timeRange.fromUnix);
      body.latest = String(input.plan.timeRange.toUnix);
    }

    const result = await apiCall(input.deps, "conversations.history", input.credential.token, body);
    if (!result.ok) {
      if (
        !attemptedJoin &&
        !channel.isPrivate &&
        channel.kind !== "private_channel" &&
        (result.error === "not_in_channel" || result.error === "channel_not_found") &&
        (input.credential.tokenKind === "bot_public" ||
          input.credential.tokenKind === "bot_with_action_token")
      ) {
        attemptedJoin = true;
        const join = await apiCall(input.deps, "conversations.join", input.credential.token, {
          channel: channel.id,
        });
        notes.push(
          join.ok
            ? "Joined public channel for history retrieval."
            : `conversations.join failed: ${join.error ?? "unknown"}`,
        );
        if (join.ok) {
          pages -= 1;
          continue;
        }
      }
      notes.push(`conversations.history failed: ${result.error ?? "unknown"}`);
      return { message: null, exactNewestGuaranteed: false, pagesFetched: pages, notes };
    }

    const messages = (result.data.messages as Array<Record<string, unknown>> | undefined) ?? [];
    for (const m of messages) {
      if (person && String(m.user ?? "") !== person.id) continue;
      if (m.subtype && m.subtype !== "thread_broadcast") continue;
      const normalized = normalizeHistoryMessage({
        message: m,
        channelId: channel.id,
        channelName: channel.name,
        channelKind: channel.kind,
      });
      if (!normalized) continue;
      const permalink = await fetchPermalink({
        credential: input.credential,
        channelId: channel.id,
        messageTs: normalized.messageTs,
        deps: input.deps,
      });
      return {
        message: {
          ...normalized,
          permalink,
          authorName: person?.displayName ?? normalized.authorName,
        },
        exactNewestGuaranteed: true,
        pagesFetched: pages,
        notes,
      };
    }

    const next = (result.data.response_metadata as { next_cursor?: string } | undefined)
      ?.next_cursor;
    if (!next) break;
    cursor = next;
  }

  notes.push(
    person
      ? `No message from ${person.displayName} in the scanned history window.`
      : "No messages found in the scanned history window.",
  );
  return { message: null, exactNewestGuaranteed: true, pagesFetched: pages, notes };
}
