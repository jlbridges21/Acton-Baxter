import "server-only";

import { callSlackApi } from "./api";
import { inferChannelKind } from "./channels";
import type {
  ResolvedSlackChannel,
  SlackApiCallResult,
  SlackCredentialResolution,
  SlackSearchDeps,
} from "./types";

async function apiCall(
  deps: SlackSearchDeps | undefined,
  method: string,
  token: string,
  body: Record<string, unknown>,
  form = false,
): Promise<SlackApiCallResult> {
  if (deps?.callSlackApi) return deps.callSlackApi(method, { token, body, form });
  return callSlackApi(method, { token, body, form, timeoutMs: 15_000 });
}

export type ChannelAccessDecision = {
  channel: ResolvedSlackChannel;
  isPrivate: boolean;
  isArchived: boolean;
  isMember: boolean | null;
  /** Bot/user token may attempt conversations.history */
  canReadHistory: boolean;
  /** Bot may conversations.join (public non-archived only) */
  canJoin: boolean;
  /** Requester needs linked Slack Search OAuth */
  requiresUserOauth: boolean;
  notes: string[];
  infoError: string | null;
};

/**
 * Resolve live channel access from conversations.info (membership/privacy/archived).
 * Does not auto-join. Private non-member → no history for bot tokens.
 */
export async function resolveChannelAccess(input: {
  channel: ResolvedSlackChannel;
  credential: SlackCredentialResolution;
  deps?: SlackSearchDeps;
}): Promise<ChannelAccessDecision> {
  const notes: string[] = [];
  let isPrivate = input.channel.isPrivate || input.channel.kind === "private_channel";
  let isArchived = Boolean(input.channel.isArchived);
  let isMember: boolean | null = input.channel.isMember ?? null;
  let infoError: string | null = null;
  let channel = { ...input.channel };

  const info = await apiCall(
    input.deps,
    "conversations.info",
    input.credential.token,
    { channel: input.channel.id },
    true,
  );

  if (info.ok) {
    const ch = (info.data.channel as Record<string, unknown> | undefined) ?? {};
    isPrivate = Boolean(ch.is_private) || input.channel.kind === "private_channel";
    isArchived = Boolean(ch.is_archived);
    isMember = typeof ch.is_member === "boolean" ? ch.is_member : isMember;
    const name = String(ch.name || channel.name || "").trim() || channel.name;
    const kind = inferChannelKind({
      id: channel.id,
      isPrivate,
      channelType: isPrivate ? "private_channel" : "public_channel",
    });
    channel = {
      ...channel,
      name,
      displayLabel: `#${name.replace(/^#/, "")}`,
      kind,
      isPrivate,
      isArchived,
      isMember,
    };
    notes.push(
      `conversations.info: private=${isPrivate} archived=${isArchived} member=${String(isMember)}`,
    );
  } else {
    infoError = info.error ?? "conversations_info_failed";
    notes.push(`conversations.info failed: ${infoError}`);
  }

  const tokenKind = input.credential.tokenKind;
  const isUserToken = tokenKind === "user";

  if (isArchived) {
    return {
      channel,
      isPrivate,
      isArchived,
      isMember,
      canReadHistory: false,
      canJoin: false,
      requiresUserOauth: false,
      notes: [...notes, "Archived channel excluded from default retrieval."],
      infoError,
    };
  }

  // User OAuth: Slack enforces ACL — attempt history for any non-archived channel.
  if (isUserToken) {
    return {
      channel,
      isPrivate,
      isArchived,
      isMember,
      canReadHistory: true,
      canJoin: false,
      requiresUserOauth: false,
      notes: [...notes, "User OAuth — history allowed subject to Slack ACL."],
      infoError,
    };
  }

  // Bot tokens: public → history (+ join if needed). Private → history only when member.
  if (isPrivate) {
    if (isMember === true) {
      return {
        channel,
        isPrivate,
        isArchived,
        isMember,
        canReadHistory: true,
        canJoin: false,
        requiresUserOauth: false,
        notes: [...notes, "Private channel — bot is member; history allowed."],
        infoError,
      };
    }
    if (isMember === false) {
      return {
        channel,
        isPrivate,
        isArchived,
        isMember,
        canReadHistory: false,
        canJoin: false,
        requiresUserOauth: true,
        notes: [...notes, "Private channel — bot not a member; user OAuth required."],
        infoError,
      };
    }
    // Membership unknown (info failed) — attempt history; Slack will return not_in_channel if denied.
    return {
      channel,
      isPrivate,
      isArchived,
      isMember,
      canReadHistory: true,
      canJoin: false,
      requiresUserOauth: false,
      notes: [
        ...notes,
        "Private channel — membership unknown; attempting history (API will enforce ACL).",
      ],
      infoError,
    };
  }

  // Public
  return {
    channel,
    isPrivate,
    isArchived,
    isMember,
    canReadHistory: true,
    canJoin: isMember !== true,
    requiresUserOauth: false,
    notes: [...notes, "Public channel — bot history allowed; join if not_in_channel."],
    infoError,
  };
}

/**
 * Hydrate a channel by ID via conversations.info when directory cache misses.
 */
export async function hydrateChannelById(input: {
  channelId: string;
  teamId: string;
  token: string;
  deps?: SlackSearchDeps;
}): Promise<ResolvedSlackChannel | null> {
  const info = await apiCall(
    input.deps,
    "conversations.info",
    input.token,
    { channel: input.channelId },
    true,
  );
  if (!info.ok) return null;
  const ch = (info.data.channel as Record<string, unknown> | undefined) ?? {};
  const id = String(ch.id ?? input.channelId);
  const name = String(ch.name || "").trim();
  if (!name && !id) return null;
  const isPrivate = Boolean(ch.is_private);
  const isArchived = Boolean(ch.is_archived);
  const isMember = typeof ch.is_member === "boolean" ? ch.is_member : null;
  const kind = inferChannelKind({
    id,
    isPrivate,
    channelType: isPrivate ? "private_channel" : "public_channel",
  });
  return {
    id,
    name: name || id,
    displayLabel: name ? `#${name.replace(/^#/, "")}` : id,
    teamId: input.teamId,
    kind,
    isPrivate,
    isArchived,
    isMember,
  };
}
