import "server-only";

import { callSlackApi } from "./api";
import {
  batchUpsertSlackChannelProfiles,
  batchUpsertSlackUserProfiles,
  type SlackChannelProfileRecord,
  type SlackUserProfileRecord,
} from "@/lib/slack/profiles";
import type { SlackApiCallResult, SlackSearchDeps } from "./types";

const MAX_USER_PAGES = 25;
const MAX_CHANNEL_PAGES = 25;
const PAGE_SIZE = 200;
/** Overall wall-clock budget for admin/full directory refresh. */
const DIRECTORY_REFRESH_TIMEOUT_MS = 45_000;
/** Faster budget when refresh-on-miss runs inside a user-facing answer. */
const DIRECTORY_REFRESH_FAST_TIMEOUT_MS = 12_000;

export type SlackDirectoryRefreshResult = {
  teamId: string;
  usersUpserted: number;
  channelsUpserted: number;
  publicChannels: number;
  privateChannels: number;
  archivedChannels: number;
  activeHumans: number;
  botsSkipped: number;
  paginationComplete: boolean;
  incompleteReason: string | null;
  pagesFetched: { users: number; channels: number };
  errors: string[];
  refreshedAt: string;
  durationMs: number;
  timedOut: boolean;
};

async function apiCall(
  deps: SlackSearchDeps | undefined,
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SlackApiCallResult> {
  // Prefer form-urlencoded for list pagination — Slack cursor handling is most reliable this way.
  if (deps?.callSlackApi) return deps.callSlackApi(method, { token, body, form: true });
  return callSlackApi(method, { token, body, form: true, timeoutMs: 15_000 });
}

async function loadBotToken(): Promise<string> {
  try {
    const { getEnv } = await import("@/lib/env");
    return getEnv().SLACK_BOT_TOKEN?.trim() ?? "";
  } catch {
    return (process.env.SLACK_BOT_TOKEN ?? "").trim();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out after ${timeoutMs}ms`);
        err.name = "TimeoutError";
        reject(err);
      }, timeoutMs);
    }),
  ]);
}

function nextCursor(data: Record<string, unknown>): string | null {
  const raw = (data.response_metadata as { next_cursor?: string } | undefined)?.next_cursor;
  const cursor = typeof raw === "string" ? raw.trim() : "";
  return cursor || null;
}

/**
 * Refresh Slack identity directories via users.list + conversations.list (paginated).
 * Stores identity metadata only — never messages.
 * Uses batch upserts and hard timeouts so admin Refresh / answer refresh-on-miss cannot hang.
 */
export async function refreshSlackWorkspaceDirectory(input: {
  teamId: string;
  token?: string | null;
  deps?: SlackSearchDeps;
  /** Admin full refresh vs fast miss-path. Default full. */
  mode?: "full" | "fast";
  /** Test / override wall-clock budget. */
  timeoutMs?: number;
}): Promise<SlackDirectoryRefreshResult> {
  const started = Date.now();
  const refreshedAt = new Date().toISOString();
  const timeoutMs =
    input.timeoutMs ??
    (input.mode === "fast" ? DIRECTORY_REFRESH_FAST_TIMEOUT_MS : DIRECTORY_REFRESH_TIMEOUT_MS);

  try {
    return await withTimeout(
      runDirectoryRefresh({ ...input, refreshedAt, started }),
      timeoutMs,
      "Slack directory refresh",
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      teamId: input.teamId,
      usersUpserted: 0,
      channelsUpserted: 0,
      publicChannels: 0,
      privateChannels: 0,
      archivedChannels: 0,
      activeHumans: 0,
      botsSkipped: 0,
      paginationComplete: false,
      incompleteReason: timedOut ? "timeout" : "error",
      pagesFetched: { users: 0, channels: 0 },
      errors: [
        timedOut
          ? "BAXTER_SLACK_DIRECTORY_TIMEOUT"
          : error instanceof Error
            ? error.message.slice(0, 160)
            : "directory_refresh_failed",
      ],
      refreshedAt,
      durationMs: Date.now() - started,
      timedOut,
    };
  }
}

async function runDirectoryRefresh(input: {
  teamId: string;
  token?: string | null;
  deps?: SlackSearchDeps;
  refreshedAt: string;
  started: number;
}): Promise<SlackDirectoryRefreshResult> {
  const errors: string[] = [];
  const token = (input.token ?? (await loadBotToken())).trim();
  if (!token) {
    return {
      teamId: input.teamId,
      usersUpserted: 0,
      channelsUpserted: 0,
      publicChannels: 0,
      privateChannels: 0,
      archivedChannels: 0,
      activeHumans: 0,
      botsSkipped: 0,
      paginationComplete: false,
      incompleteReason: "missing_bot_token",
      pagesFetched: { users: 0, channels: 0 },
      errors: ["SLACK_BOT_TOKEN missing — cannot refresh directory"],
      refreshedAt: input.refreshedAt,
      durationMs: Date.now() - input.started,
      timedOut: false,
    };
  }

  // Parallel users + channels (independent cursor chains)
  const [usersResult, channelsResult] = await Promise.all([
    paginateUsers({
      teamId: input.teamId,
      token,
      deps: input.deps,
      refreshedAt: input.refreshedAt,
    }),
    paginateChannels({
      teamId: input.teamId,
      token,
      deps: input.deps,
      refreshedAt: input.refreshedAt,
    }),
  ]);

  errors.push(...usersResult.errors, ...channelsResult.errors);

  const incompleteReason = !usersResult.complete
    ? usersResult.incompleteReason
    : !channelsResult.complete
      ? channelsResult.incompleteReason
      : null;

  console.info(
    JSON.stringify({
      scope: "slack.directory",
      action: "refresh",
      pagesUsers: usersResult.pages,
      pagesChannels: channelsResult.pages,
      users: usersResult.upserted,
      channels: channelsResult.upserted,
      publicChannels: channelsResult.publicChannels,
      privateChannels: channelsResult.privateChannels,
      durationMs: Date.now() - input.started,
      status: incompleteReason ? "partial" : "success",
      incompleteReason,
    }),
  );

  return {
    teamId: input.teamId,
    usersUpserted: usersResult.upserted,
    channelsUpserted: channelsResult.upserted,
    publicChannels: channelsResult.publicChannels,
    privateChannels: channelsResult.privateChannels,
    archivedChannels: channelsResult.archivedChannels,
    activeHumans: usersResult.activeHumans,
    botsSkipped: usersResult.botsSkipped,
    paginationComplete: usersResult.complete && channelsResult.complete,
    incompleteReason,
    pagesFetched: { users: usersResult.pages, channels: channelsResult.pages },
    errors,
    refreshedAt: input.refreshedAt,
    durationMs: Date.now() - input.started,
    timedOut: false,
  };
}

async function paginateUsers(input: {
  teamId: string;
  token: string;
  deps?: SlackSearchDeps;
  refreshedAt: string;
}): Promise<{
  upserted: number;
  activeHumans: number;
  botsSkipped: number;
  pages: number;
  complete: boolean;
  incompleteReason: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  let upserted = 0;
  let activeHumans = 0;
  let botsSkipped = 0;
  let pages = 0;
  let cursor: string | null = null;
  const requestedCursors = new Set<string>();

  while (pages < MAX_USER_PAGES) {
    pages += 1;
    if (cursor) {
      if (requestedCursors.has(cursor)) {
        errors.push("users.list: repeated request cursor detected");
        return {
          upserted,
          activeHumans,
          botsSkipped,
          pages,
          complete: false,
          incompleteReason: "cursor_cycle",
          errors,
        };
      }
      requestedCursors.add(cursor);
    }
    const body: Record<string, unknown> = { limit: PAGE_SIZE };
    if (cursor) body.cursor = cursor;
    const result = await apiCall(input.deps, "users.list", input.token, body);
    if (!result.ok) {
      errors.push(`users.list: ${result.error ?? "failed"}`);
      return {
        upserted,
        activeHumans,
        botsSkipped,
        pages,
        complete: false,
        incompleteReason: result.error === "ratelimited" ? "rate_limited" : "api_error",
        errors,
      };
    }

    const members = (result.data.members as Array<Record<string, unknown>> | undefined) ?? [];
    const batch: Array<
      Partial<SlackUserProfileRecord> & { team_id: string; slack_user_id: string }
    > = [];
    for (const member of members) {
      const id = String(member.id ?? "");
      if (!id || id === "USLACKBOT") continue;
      const isBot = Boolean(member.is_bot) || Boolean(member.is_app_user);
      const deleted = Boolean(member.deleted);
      const profile = (member.profile as Record<string, unknown> | undefined) ?? {};
      const displayName =
        String(profile.display_name_normalized || profile.display_name || "").trim() ||
        String(member.real_name || profile.real_name || member.name || "").trim() ||
        null;
      const realName = String(member.real_name || profile.real_name || "").trim() || null;
      const username = String(member.name || "").trim() || null;
      const email = typeof profile.email === "string" ? profile.email : null;
      batch.push({
        team_id: input.teamId,
        slack_user_id: id,
        display_name: displayName,
        real_name: realName,
        username,
        email,
        is_bot: isBot,
        is_deleted: deleted,
        last_resolved_at: input.refreshedAt,
        resolve_error: null,
      });
      if (isBot || deleted) botsSkipped += 1;
      else activeHumans += 1;
    }
    if (batch.length) {
      await batchUpsertSlackUserProfiles(batch);
      upserted += batch.length;
    }

    const next = nextCursor(result.data);
    if (!next || next === cursor) {
      return {
        upserted,
        activeHumans,
        botsSkipped,
        pages,
        complete: true,
        incompleteReason: null,
        errors,
      };
    }
    cursor = next;
  }

  return {
    upserted,
    activeHumans,
    botsSkipped,
    pages,
    complete: false,
    incompleteReason: "page_limit",
    errors,
  };
}

async function paginateChannels(input: {
  teamId: string;
  token: string;
  deps?: SlackSearchDeps;
  refreshedAt: string;
}): Promise<{
  upserted: number;
  publicChannels: number;
  privateChannels: number;
  archivedChannels: number;
  pages: number;
  complete: boolean;
  incompleteReason: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  let upserted = 0;
  let publicChannels = 0;
  let privateChannels = 0;
  let archivedChannels = 0;
  let pages = 0;
  let cursor: string | null = null;
  const requestedCursors = new Set<string>();
  const seenChannelIds = new Set<string>();

  while (pages < MAX_CHANNEL_PAGES) {
    pages += 1;
    if (cursor) {
      if (requestedCursors.has(cursor)) {
        errors.push("conversations.list: repeated request cursor detected");
        return {
          upserted,
          publicChannels,
          privateChannels,
          archivedChannels,
          pages,
          complete: false,
          incompleteReason: "cursor_cycle",
          errors,
        };
      }
      requestedCursors.add(cursor);
    }
    const body: Record<string, unknown> = {
      types: "public_channel,private_channel",
      exclude_archived: false,
      limit: PAGE_SIZE,
    };
    if (cursor) body.cursor = cursor;
    const result = await apiCall(input.deps, "conversations.list", input.token, body);
    if (!result.ok) {
      errors.push(`conversations.list: ${result.error ?? "failed"}`);
      return {
        upserted,
        publicChannels,
        privateChannels,
        archivedChannels,
        pages,
        complete: false,
        incompleteReason: result.error === "ratelimited" ? "rate_limited" : "api_error",
        errors,
      };
    }

    const channels = (result.data.channels as Array<Record<string, unknown>> | undefined) ?? [];
    const batch: Array<
      Partial<SlackChannelProfileRecord> & { team_id: string; slack_channel_id: string }
    > = [];
    let newOnPage = 0;
    for (const ch of channels) {
      const id = String(ch.id ?? "");
      if (!id) continue;
      if (!seenChannelIds.has(id)) {
        seenChannelIds.add(id);
        newOnPage += 1;
      }
      const name = String(ch.name || "").trim() || null;
      const isPrivate = Boolean(ch.is_private);
      const isArchived = Boolean(ch.is_archived);
      const isMember = typeof ch.is_member === "boolean" ? Boolean(ch.is_member) : null;
      const isIm = Boolean(ch.is_im);
      const isMpim = Boolean(ch.is_mpim);
      let channelType = "public_channel";
      if (isIm) channelType = "im";
      else if (isMpim) channelType = "mpim";
      else if (isPrivate) channelType = "private_channel";

      batch.push({
        team_id: input.teamId,
        slack_channel_id: id,
        name,
        channel_type: channelType,
        is_private: isPrivate,
        is_archived: isArchived,
        is_member: isMember,
        last_resolved_at: input.refreshedAt,
        resolve_error: null,
      });
      if (isArchived) archivedChannels += 1;
      else if (isPrivate) privateChannels += 1;
      else publicChannels += 1;
    }
    if (batch.length) {
      await batchUpsertSlackChannelProfiles(batch);
      upserted += batch.length;
    }

    const next = nextCursor(result.data);
    if (!next) {
      return {
        upserted,
        publicChannels,
        privateChannels,
        archivedChannels,
        pages,
        complete: true,
        incompleteReason: null,
        errors,
      };
    }
    // Slack occasionally echoes the request cursor when finished — treat as complete.
    if (next === cursor) {
      return {
        upserted,
        publicChannels,
        privateChannels,
        archivedChannels,
        pages,
        complete: true,
        incompleteReason: null,
        errors,
      };
    }
    // No new channel IDs on this page but a next_cursor remains → stop as partial (avoid loops).
    if (channels.length > 0 && newOnPage === 0) {
      errors.push("conversations.list: page returned only duplicate channel IDs");
      return {
        upserted,
        publicChannels,
        privateChannels,
        archivedChannels,
        pages,
        complete: false,
        incompleteReason: "cursor_cycle",
        errors,
      };
    }
    cursor = next;
  }

  return {
    upserted,
    publicChannels,
    privateChannels,
    archivedChannels,
    pages,
    complete: false,
    incompleteReason: "page_limit",
    errors,
  };
}
