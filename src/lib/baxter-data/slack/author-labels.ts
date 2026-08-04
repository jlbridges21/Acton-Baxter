/**
 * Resolve Slack message author display names the same way the Feedback dashboard does:
 * slack_user_profiles + pickSlackDisplayName (never opaque "Unknown").
 */

import "server-only";

import { pickSlackDisplayName, slackUserFallbackLabel } from "@/lib/slack/display-names";
import type { SlackMessageEvidence } from "./types";

export type AuthorLabelDeps = {
  getCachedProfile?: (
    teamId: string,
    slackUserId: string,
  ) => Promise<{
    slack_user_id: string;
    display_name?: string | null;
    real_name?: string | null;
    username?: string | null;
  } | null>;
  resolveProfile?: (
    teamId: string,
    slackUserId: string,
  ) => Promise<{
    slack_user_id: string;
    display_name?: string | null;
    real_name?: string | null;
    username?: string | null;
  } | null>;
};

function looksLikeRealName(value: string | null | undefined): boolean {
  const v = value?.trim() ?? "";
  if (!v) return false;
  if (/^unknown$/i.test(v)) return false;
  if (/^an employee$/i.test(v)) return false;
  if (/^the sender$/i.test(v)) return false;
  if (/^slack user\b/i.test(v)) return false;
  if (/^[UW][A-Z0-9_]+$/i.test(v)) return false;
  return true;
}

/**
 * Single-author label: prefer existing name, else profile cache / resolve, else id fallback.
 */
export async function resolveSlackAuthorDisplayName(input: {
  teamId: string;
  authorId: string | null | undefined;
  authorName?: string | null;
  deps?: AuthorLabelDeps;
}): Promise<string> {
  if (looksLikeRealName(input.authorName)) return input.authorName!.trim();

  const authorId = input.authorId?.trim() || null;
  if (!authorId || !input.teamId.trim()) {
    return slackUserFallbackLabel(authorId);
  }

  try {
    const getCached =
      input.deps?.getCachedProfile ??
      (async (teamId: string, slackUserId: string) => {
        const { getCachedSlackUserProfile } = await import("@/lib/slack/profiles");
        return getCachedSlackUserProfile(teamId, slackUserId);
      });

    const cached = await getCached(input.teamId, authorId);
    if (cached && (cached.display_name || cached.real_name || cached.username)) {
      return pickSlackDisplayName(cached);
    }

    const resolve =
      input.deps?.resolveProfile ??
      (async (teamId: string, slackUserId: string) => {
        const { resolveSlackUserProfile } = await import("@/lib/slack/profiles");
        return resolveSlackUserProfile({ teamId, slackUserId });
      });

    const resolved = await resolve(input.teamId, authorId).catch(() => null);
    if (resolved && (resolved.display_name || resolved.real_name || resolved.username)) {
      return pickSlackDisplayName(resolved);
    }
  } catch {
    // fall through
  }

  return slackUserFallbackLabel(authorId);
}

/**
 * Hydrate authorName on evidence rows using Feedback-dashboard profile resolution.
 * Also returns a userId → display name map for mrkdwn mention rewriting.
 */
export async function hydrateSlackEvidenceAuthorNames(
  messages: SlackMessageEvidence[],
  teamId: string,
  deps?: AuthorLabelDeps,
): Promise<{ messages: SlackMessageEvidence[]; nameByUserId: Map<string, string> }> {
  const nameByUserId = new Map<string, string>();
  if (!teamId.trim() || messages.length === 0) {
    return { messages, nameByUserId };
  }

  const ids = [
    ...new Set(
      messages
        .flatMap((m) => [
          m.authorId,
          ...m.contextMessages.map((c) => c.authorId),
          // Mention ids in text — resolved lazily via map after authors are loaded
        ])
        .filter((id): id is string => Boolean(id?.trim())),
    ),
  ];

  // Collect mention ids from message text for name map completeness.
  const mentionIds = new Set<string>();
  for (const m of messages) {
    for (const match of m.text.matchAll(/<@([UW][A-Z0-9_]+)(?:\|[^>]*)?>/gi)) {
      mentionIds.add(match[1]!);
    }
  }
  for (const id of mentionIds) {
    if (!ids.includes(id)) ids.push(id);
  }

  await Promise.all(
    ids.map(async (id) => {
      const name = await resolveSlackAuthorDisplayName({
        teamId,
        authorId: id,
        authorName: null,
        deps,
      });
      nameByUserId.set(id, name);
      nameByUserId.set(id.toUpperCase(), name);
    }),
  );

  const next = messages.map((m) => {
    const authorName =
      (m.authorId && nameByUserId.get(m.authorId)) ||
      (looksLikeRealName(m.authorName) ? m.authorName!.trim() : null) ||
      slackUserFallbackLabel(m.authorId);
    return {
      ...m,
      authorName,
      contextMessages: m.contextMessages.map((c) => ({
        ...c,
        authorName:
          (c.authorId && nameByUserId.get(c.authorId)) ||
          (looksLikeRealName(c.authorName) ? c.authorName!.trim() : null) ||
          slackUserFallbackLabel(c.authorId),
      })),
    };
  });

  return { messages: next, nameByUserId };
}
