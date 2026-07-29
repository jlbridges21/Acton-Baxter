import type {
  ResolvedSlackChannel,
  SlackChannelAmbiguity,
  SlackChannelKind,
  SlackSearchDeps,
} from "./types";

const CHANNEL_ALIASES: Record<string, string[]> = {
  "project-management": ["project management", "pm", "pm channel", "project-management"],
  "project management": ["project-management", "pm"],
  sales: ["sales", "the sales channel"],
  design: ["design", "the design channel"],
  general: ["general", "the general channel"],
};

function normalizeChannel(value: string): string {
  return value
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasSet(query: string): Set<string> {
  const n = normalizeChannel(query);
  const set = new Set<string>([n, n.replace(/\s+/g, "-")]);
  for (const [key, aliases] of Object.entries(CHANNEL_ALIASES)) {
    const keyN = normalizeChannel(key);
    if (set.has(keyN) || aliases.some((a) => normalizeChannel(a) === n)) {
      set.add(keyN);
      set.add(keyN.replace(/\s+/g, "-"));
      for (const a of aliases) {
        set.add(normalizeChannel(a));
        set.add(normalizeChannel(a).replace(/\s+/g, "-"));
      }
    }
  }
  return set;
}

function channelMatches(channel: ResolvedSlackChannel, query: string): boolean {
  const aliases = aliasSet(query);
  const name = normalizeChannel(channel.name);
  const label = normalizeChannel(channel.displayLabel);
  if (aliases.has(name) || aliases.has(label)) return true;
  for (const a of aliases) {
    if (name === a || name.includes(a) || a.includes(name)) return true;
  }
  return false;
}

export type ChannelResolution =
  | { status: "resolved"; channel: ResolvedSlackChannel }
  | { status: "ambiguous"; ambiguity: SlackChannelAmbiguity }
  | { status: "not_found"; query: string };

export function resolveChannelFromDirectory(
  query: string,
  directory: ResolvedSlackChannel[],
): ChannelResolution {
  const q = query.trim();
  if (!q) return { status: "not_found", query: q };

  if (/^[CGD][A-Z0-9]+$/i.test(q)) {
    const byId = directory.find((c) => c.id === q);
    if (byId) return { status: "resolved", channel: byId };
    return { status: "not_found", query: q };
  }

  const matches = directory.filter((c) => channelMatches(c, q));
  if (matches.length === 1) return { status: "resolved", channel: matches[0]! };
  if (matches.length > 1) {
    const exact = matches.filter((c) => {
      const n = normalizeChannel(c.name);
      return aliasSet(q).has(n);
    });
    if (exact.length === 1) return { status: "resolved", channel: exact[0]! };
    return {
      status: "ambiguous",
      ambiguity: { query: q, candidates: matches.slice(0, 8) },
    };
  }
  return { status: "not_found", query: q };
}

export async function resolveChannels(
  queries: string[],
  teamId: string,
  deps?: SlackSearchDeps,
): Promise<{
  channels: ResolvedSlackChannel[];
  ambiguities: SlackChannelAmbiguity[];
  notFound: string[];
}> {
  const directory = deps?.listCachedChannels ? await deps.listCachedChannels(teamId) : [];
  const channels: ResolvedSlackChannel[] = [];
  const ambiguities: SlackChannelAmbiguity[] = [];
  const notFound: string[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const result = resolveChannelFromDirectory(query, directory);
    if (result.status === "resolved") {
      if (!seen.has(result.channel.id)) {
        seen.add(result.channel.id);
        channels.push(result.channel);
      }
    } else if (result.status === "ambiguous") {
      ambiguities.push(result.ambiguity);
    } else {
      notFound.push(result.query);
    }
  }

  return { channels, ambiguities, notFound };
}

export function inferChannelKind(input: {
  id?: string | null;
  isPrivate?: boolean | null;
  channelType?: string | null;
}): SlackChannelKind {
  const id = input.id ?? "";
  if (id.startsWith("D")) return "im";
  if (id.startsWith("G") && (input.channelType === "mpim" || input.isPrivate)) {
    // G can be private channel or mpim — prefer explicit type
    if (input.channelType === "mpim") return "mpim";
  }
  if (input.channelType === "im") return "im";
  if (input.channelType === "mpim") return "mpim";
  if (input.channelType === "private_channel" || input.isPrivate) return "private_channel";
  if (id.startsWith("C")) return "public_channel";
  if (input.isPrivate) return "private_channel";
  return "public_channel";
}

export function formatChannelLabel(channel: ResolvedSlackChannel): string {
  const name = channel.name.replace(/^#/, "");
  return `#${name}`;
}
