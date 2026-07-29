import type {
  ResolvedSlackChannel,
  SlackChannelAmbiguity,
  SlackChannelKind,
  SlackSearchDeps,
} from "./types";

const CHANNEL_ALIASES: Record<string, string[]> = {
  "project-management": [
    "project management",
    "pm",
    "pm channel",
    "project-management",
    "project mgmt",
    "project managment",
  ],
  sales: ["sales", "the sales channel"],
  design: ["design", "the design channel"],
  general: ["general", "the general channel"],
  baxter: ["baxter", "the baxter channel", "baxter channel"],
};

/** Canonical channel query form: no #, no trailing "channel", hyphenated. */
export function normalizeChannelQuery(value: string): string {
  let n = value
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  n = n.replace(/^(the|a|an)\s+/, "");
  n = n
    .replace(/\bchannels?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  n = n.replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return n;
}

function aliasTargets(query: string): Set<string> {
  const n = normalizeChannelQuery(query);
  const set = new Set<string>([n, n.replace(/-/g, " ")]);
  for (const [canonical, aliases] of Object.entries(CHANNEL_ALIASES)) {
    const canon = normalizeChannelQuery(canonical);
    const all = [canon, ...aliases.map(normalizeChannelQuery)];
    if (all.includes(n) || all.some((a) => a === n)) {
      set.add(canon);
      for (const a of all) set.add(a);
    }
  }
  return set;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i += 1) {
    let prev = i;
    for (let j = 0; j < b.length; j += 1) {
      const cur = row[j + 1]!;
      const cost = a[i] === b[j] ? 0 : 1;
      row[j + 1] = Math.min(row[j + 1]! + 1, row[j]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length]!;
}

function channelMatches(channel: ResolvedSlackChannel, query: string): "exact" | "fuzzy" | null {
  const targets = aliasTargets(query);
  const name = normalizeChannelQuery(channel.name);
  const label = normalizeChannelQuery(channel.displayLabel);
  if (targets.has(name) || targets.has(label)) return "exact";

  // Constrained fuzzy: query vs channel name only (never match short unrelated names)
  const q = normalizeChannelQuery(query);
  if (q.length < 3) return null;
  if (name === q || label === q) return "exact";
  if (name.startsWith(q) || q.startsWith(name)) {
    if (Math.abs(name.length - q.length) <= 4) return "fuzzy";
  }
  const distance = levenshtein(q, name);
  const threshold = q.length <= 5 ? 1 : 2;
  if (distance <= threshold && distance / Math.max(q.length, name.length) <= 0.34) {
    return "fuzzy";
  }
  return null;
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

  const exact: ResolvedSlackChannel[] = [];
  const fuzzy: ResolvedSlackChannel[] = [];
  for (const channel of directory) {
    const kind = channelMatches(channel, q);
    if (kind === "exact") exact.push(channel);
    else if (kind === "fuzzy") fuzzy.push(channel);
  }

  if (exact.length === 1) return { status: "resolved", channel: exact[0]! };
  if (exact.length > 1) {
    return {
      status: "ambiguous",
      ambiguity: { query: q, candidates: exact.slice(0, 8) },
    };
  }
  if (fuzzy.length === 1) return { status: "resolved", channel: fuzzy[0]! };
  if (fuzzy.length > 1) {
    return {
      status: "ambiguous",
      ambiguity: { query: q, candidates: fuzzy.slice(0, 8) },
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
