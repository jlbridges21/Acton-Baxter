/**
 * Resolve the linked project Slack channel for a GHL contact.
 *
 * Prefer Project Setup (exact ghl_contact_id). When no complete run exists —
 * e.g. channel was provisioned but the run row is missing — fall back to
 * matching an l01-* Slack channel by homeowner last name / slug.
 */

import "server-only";

import { getEnv } from "@/lib/env";
import { listCachedSlackChannels } from "@/lib/baxter-data/slack/directory";
import { pickBestProjectChannelMatch } from "@/lib/baxter-data/slack/project-status";
import {
  listProjectSetupRunsForGhlContact,
  pickPreferredCompleteRunWithSlackChannel,
  type ProjectSetupForContactDeps,
} from "./project-setup-for-contact";

export type ResolvedProjectSlackChannel = {
  channelId: string | null;
  channelName: string | null;
  via: "project_setup" | "slack_directory";
};

export type ResolveProjectSlackChannelDeps = ProjectSetupForContactDeps & {
  listCachedChannels?: (teamId: string) => Promise<Array<{ id: string; name: string }>>;
  listLiveChannels?: () => Promise<Array<{ id: string; name: string }>>;
  teamId?: string | null;
};

function homeownerChannelQueries(displayName: string): string[] {
  const parts = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return [];
  const last = parts[parts.length - 1]!;
  const full = parts.join("-");
  const out: string[] = [];
  if (last.length >= 3) out.push(last);
  if (full.length >= 4 && full !== last) out.push(full);
  return out;
}

async function listChannelsViaBotToken(): Promise<Array<{ id: string; name: string }>> {
  const token = (getEnv().SLACK_BOT_TOKEN ?? "").trim();
  if (!token) return [];

  const out: Array<{ id: string; name: string }> = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const url = new URL("https://slack.com/api/conversations.list");
    url.searchParams.set("limit", "200");
    url.searchParams.set("types", "public_channel,private_channel");
    url.searchParams.set("exclude_archived", "true");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json()) as {
      ok: boolean;
      channels?: Array<{ id: string; name: string }>;
      response_metadata?: { next_cursor?: string };
    };
    if (!json.ok) break;
    for (const c of json.channels ?? []) {
      if (c?.id && c?.name) out.push({ id: c.id, name: c.name });
    }
    cursor = json.response_metadata?.next_cursor || undefined;
    pages += 1;
  } while (cursor && pages < 12);

  return out;
}

function pickFromDirectory(
  channels: Array<{ id: string; name: string }>,
  displayName: string,
): { id: string; name: string } | null {
  const queries = homeownerChannelQueries(displayName);
  let best: { match: { id: string; name: string }; score: number } | null = null;
  for (const q of queries) {
    const hit = pickBestProjectChannelMatch(channels, q);
    if (!hit) continue;
    // Prefer project-number channels (l01-…) over incidental name matches.
    const projectBonus = /^[a-z]\d{2}-\d{4,6}-/i.test(hit.match.name) ? 5 : 0;
    const score = hit.score + projectBonus;
    if (!best || score > best.score) best = { match: hit.match, score };
  }
  return best && best.score >= 70 ? best.match : null;
}

/**
 * Project Setup first; Slack directory / live bot list by homeowner name second.
 */
export async function resolveProjectSlackChannelForContact(input: {
  ghlContactId: string;
  contactDisplayName?: string | null;
  deps?: ResolveProjectSlackChannelDeps;
}): Promise<ResolvedProjectSlackChannel | null> {
  const contactId = input.ghlContactId.trim();
  if (!contactId) return null;

  try {
    const runs = await listProjectSetupRunsForGhlContact(contactId, input.deps);
    const preferred = pickPreferredCompleteRunWithSlackChannel(runs);
    if (preferred) {
      const channelName = preferred.slackChannelName?.replace(/^#/, "").trim() || null;
      const channelId = preferred.slackChannelId?.trim() || null;
      if (channelName || channelId) {
        return { channelId, channelName, via: "project_setup" };
      }
    }
  } catch {
    // Continue to directory fallback
  }

  const displayName = input.contactDisplayName?.trim() || "";
  if (!displayName) return null;

  const teamId = input.deps?.teamId?.trim() || "";
  const listCached =
    input.deps?.listCachedChannels ??
    (async (tid: string) => {
      const rows = await listCachedSlackChannels(tid);
      return rows.filter((c) => !c.isArchived).map((c) => ({ id: c.id, name: c.name }));
    });
  const listLive = input.deps?.listLiveChannels ?? listChannelsViaBotToken;

  try {
    const cached = await listCached(teamId);
    const fromCache = pickFromDirectory(cached, displayName);
    if (fromCache) {
      return {
        channelId: fromCache.id,
        channelName: fromCache.name,
        via: "slack_directory",
      };
    }
  } catch {
    // Try live list
  }

  try {
    const live = await listLive();
    const fromLive = pickFromDirectory(live, displayName);
    if (fromLive) {
      return {
        channelId: fromLive.id,
        channelName: fromLive.name,
        via: "slack_directory",
      };
    }
  } catch {
    return null;
  }

  return null;
}
