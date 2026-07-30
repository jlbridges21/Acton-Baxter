import { callSlackApi } from "./api";
import { resolveChannelAccess } from "./access";
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
  return callSlackApi(method, { token, body, timeoutMs: 15_000 });
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

function isSkippableHistorySubtype(subtype: unknown): boolean {
  if (!subtype || typeof subtype !== "string") return false;
  // Keep normal messages and thread broadcasts; skip channel join/leave noise etc.
  if (subtype === "thread_broadcast") return false;
  return true;
}

/**
 * Exact newest message for person+channel via conversations.history (+ selective replies).
 * Access is decided by membership/privacy — not "private ⇒ OAuth required".
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
  accessDenied?: boolean;
  /** Why history was denied — drives AUTH_REQUIRED vs SCOPE_MISSING messaging. */
  accessDenialReason?: "user_oauth" | "missing_scope" | "not_member" | "other";
}> {
  const channel = input.plan.channels[0];
  const person = input.plan.people[0];
  const notes: string[] = [];
  if (!channel) {
    return { message: null, exactNewestGuaranteed: false, pagesFetched: 0, notes };
  }

  const access = await resolveChannelAccess({
    channel,
    credential: input.credential,
    deps: input.deps,
  });
  notes.push(...access.notes);
  const resolvedChannel = access.channel;

  if (access.isArchived) {
    notes.push("Channel is archived — skipped default latest-message retrieval.");
    return { message: null, exactNewestGuaranteed: true, pagesFetched: 0, notes };
  }

  if (!access.canReadHistory) {
    notes.push(
      access.requiresUserOauth
        ? "Channel resolved but inaccessible with bot token — user OAuth required."
        : "Channel history not available with current credentials.",
    );
    return {
      message: null,
      exactNewestGuaranteed: false,
      pagesFetched: 0,
      notes,
      accessDenied: true,
      accessDenialReason: access.requiresUserOauth ? "user_oauth" : "other",
    };
  }

  let cursor: string | undefined;
  let pages = 0;
  const maxPages = 8;
  let attemptedJoin = false;
  // Recent thread roots to probe for newer replies (bounded).
  const threadRootsToProbe: string[] = [];

  while (pages < maxPages) {
    pages += 1;
    const body: Record<string, unknown> = {
      channel: resolvedChannel.id,
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
        access.canJoin &&
        !access.isPrivate &&
        (result.error === "not_in_channel" || result.error === "channel_not_found") &&
        (input.credential.tokenKind === "bot_public" ||
          input.credential.tokenKind === "bot_with_action_token")
      ) {
        attemptedJoin = true;
        const join = await apiCall(input.deps, "conversations.join", input.credential.token, {
          channel: resolvedChannel.id,
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
      if (
        access.isPrivate &&
        (result.error === "not_in_channel" ||
          result.error === "channel_not_found" ||
          result.error === "missing_scope")
      ) {
        notes.push(`Private history denied: ${result.error}`);
        const accessDenialReason =
          result.error === "missing_scope"
            ? "missing_scope"
            : result.error === "not_in_channel"
              ? "not_member"
              : "other";
        return {
          message: null,
          exactNewestGuaranteed: false,
          pagesFetched: pages,
          notes,
          accessDenied: true,
          accessDenialReason,
        };
      }
      notes.push(`conversations.history failed: ${result.error ?? "unknown"}`);
      return { message: null, exactNewestGuaranteed: false, pagesFetched: pages, notes };
    }

    const messages = (result.data.messages as Array<Record<string, unknown>> | undefined) ?? [];
    for (const m of messages) {
      const replyCount = Number(m.reply_count ?? 0);
      const ts = String(m.ts ?? "");
      if (replyCount > 0 && ts && threadRootsToProbe.length < 6) {
        threadRootsToProbe.push(ts);
      }

      if (person && String(m.user ?? "") !== person.id) continue;
      if (isSkippableHistorySubtype(m.subtype)) continue;
      const normalized = normalizeHistoryMessage({
        message: m,
        channelId: resolvedChannel.id,
        channelName: resolvedChannel.name,
        channelKind: resolvedChannel.kind,
      });
      if (!normalized) continue;
      const permalink = await fetchPermalink({
        credential: input.credential,
        channelId: resolvedChannel.id,
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

  // Probe recent threads for a newer reply from the person (bounded).
  if (person && threadRootsToProbe.length) {
    notes.push(`Probing ${threadRootsToProbe.length} recent thread(s) for replies.`);
    let best: SlackMessageEvidence | null = null;
    for (const rootTs of threadRootsToProbe) {
      const replies = await fetchThreadContext({
        credential: input.credential,
        channelId: resolvedChannel.id,
        threadTs: rootTs,
        limit: 50,
        deps: input.deps,
      });
      for (const reply of replies) {
        if (reply.authorId !== person.id) continue;
        if (!best || (reply.timestamp ?? "") > (best.timestamp ?? "")) {
          best = {
            ...reply,
            channelName: resolvedChannel.name,
            channelKind: resolvedChannel.kind,
            authorName: person.displayName,
          };
        }
      }
    }
    if (best) {
      if (!best.permalink) {
        best.permalink = await fetchPermalink({
          credential: input.credential,
          channelId: resolvedChannel.id,
          messageTs: best.messageTs,
          deps: input.deps,
        });
      }
      notes.push("Found newest matching activity in a thread reply.");
      return {
        message: best,
        exactNewestGuaranteed: true,
        pagesFetched: pages,
        notes,
      };
    }
  }

  notes.push(
    person
      ? `No message from ${person.displayName} in the scanned history window.`
      : "No messages found in the scanned history window.",
  );
  return { message: null, exactNewestGuaranteed: true, pagesFetched: pages, notes };
}
