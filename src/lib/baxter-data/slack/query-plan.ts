import {
  defaultLimitForIntent,
  defaultSortForIntent,
  detectSlackSearchIntent,
  extractChannelMentions,
  extractKeywords,
  extractPersonQueries,
  extractPhrases,
  getDecisionLanguageTerms,
} from "./intent";
import { formatSlackDate, parseSlackTimeRange } from "./temporal";
import { resolveChannels } from "./channels";
import { resolvePeople } from "./users";
import {
  extractProjectNameQueries,
  extractProjectNumbers,
  isStructuralProjectKeyword,
} from "./project-status";
import {
  deriveProjectSlackChannelFromRegistry,
  isNamedProjectChannelAsk,
} from "./project-channel-derive";
import type {
  SlackQueryPlan,
  SlackChannelAmbiguity,
  SlackPersonAmbiguity,
  SlackSearchDeps,
  SlackSearchIntent,
} from "./types";

export type PlanSlackSearchResult = {
  plan: SlackQueryPlan;
  ambiguities: {
    people: SlackPersonAmbiguity[];
    channels: SlackChannelAmbiguity[];
  };
  notFound: {
    people: string[];
    channels: string[];
  };
  /** Canonical slug derived from Master Project Log when applicable. */
  derivedProjectChannel?: {
    slug: string;
    projectNumber: string;
    shortName: string;
    customerName: string;
  } | null;
};

/**
 * Build a validated SlackQueryPlan from natural language.
 * Does not invent raw Slack query syntax for the model — code owns query construction.
 */
export async function planSlackSearch(input: {
  question: string;
  teamId: string;
  intent?: SlackSearchIntent;
  deps?: SlackSearchDeps;
  now?: Date;
}): Promise<PlanSlackSearchResult> {
  const now = input.now ?? input.deps?.now?.() ?? new Date();
  let intent = input.intent ?? detectSlackSearchIntent(input.question);
  const personQueries = extractPersonQueries(input.question);
  const projectNumbers = extractProjectNumbers(input.question);
  const projectNames =
    intent === "project_status" ||
    intent === "latest_update" ||
    isNamedProjectChannelAsk(input.question)
      ? extractProjectNameQueries(input.question)
      : [];

  // Master Project Log → canonical {number}-{shortName} slug (cold, no conversation needed).
  // Skip when the user already named an explicit #l01-… channel — no registry round-trip.
  let derivedProjectChannel: PlanSlackSearchResult["derivedProjectChannel"] = null;
  const explicitProjectChannelSlug = extractChannelMentions(input.question).find((n) =>
    /^[a-z]\d{2}-\d{4,6}-[a-z0-9-]+$/i.test(n),
  );
  const explicitHashChannel = /#[\w-]{2,}/.test(input.question) || /<#[CG]/i.test(input.question);
  const shouldDeriveProjectChannel =
    !explicitHashChannel && !explicitProjectChannelSlug && isNamedProjectChannelAsk(input.question);

  if (shouldDeriveProjectChannel) {
    try {
      const derived = await deriveProjectSlackChannelFromRegistry(input.question);
      if (derived) {
        derivedProjectChannel = {
          slug: derived.slug,
          projectNumber: derived.projectNumber,
          shortName: derived.shortName,
          customerName: derived.customerName,
        };
        // Prefer project-status scoping once we have a real project channel.
        if (intent === "topic_search" || intent === "channel_search") {
          intent = "latest_update";
        }
      }
    } catch {
      // Registry unavailable — fall through to literal / fuzzy mentions.
    }
  }

  const channelQueries = [
    ...(derivedProjectChannel ? [derivedProjectChannel.slug] : []),
    ...extractChannelMentions(input.question),
    ...(!derivedProjectChannel && (intent === "project_status" || intent === "latest_update")
      ? [
          ...projectNumbers.map((n) => n.toLowerCase()),
          ...projectNames.map((n) => n.toLowerCase().replace(/\s+/g, "-")),
        ]
      : derivedProjectChannel
        ? [...projectNumbers.map((n) => n.toLowerCase())]
        : []),
  ];

  const [peopleResult, channelsResult] = await Promise.all([
    resolvePeople(personQueries, input.teamId, input.deps),
    resolveChannels([...new Set(channelQueries)], input.teamId, input.deps),
  ]);

  // When we derived a canonical slug and it wasn't found, surface that name (not a mangled literal).
  let notFoundChannels = channelsResult.notFound;
  if (
    derivedProjectChannel &&
    channelsResult.channels.length === 0 &&
    !notFoundChannels.includes(derivedProjectChannel.slug)
  ) {
    notFoundChannels = [derivedProjectChannel.slug, ...notFoundChannels];
  }
  // Drop mangled leftovers like "liniger-slack" from notFound when we have a derived slug.
  if (derivedProjectChannel) {
    notFoundChannels = notFoundChannels.filter(
      (c) => c === derivedProjectChannel!.slug || !/-slack$/i.test(c),
    );
    if (channelsResult.channels.length === 0 && notFoundChannels.length === 0) {
      notFoundChannels = [derivedProjectChannel.slug];
    }
  }

  const dropNames = [
    ...personQueries,
    ...peopleResult.people.flatMap((p) => [p.displayName, p.realName ?? "", p.username ?? ""]),
    ...channelQueries,
    ...(intent === "project_status" || intent === "latest_update" || derivedProjectChannel
      ? [...projectNumbers, ...projectNames, derivedProjectChannel?.shortName ?? ""]
      : []),
  ];

  const phrases = extractPhrases(input.question);
  let keywords = extractKeywords(input.question, dropNames);
  const decisionLanguage =
    intent === "decision_search" ? getDecisionLanguageTerms().slice(0, 8) : [];

  if (intent === "latest_message") {
    keywords = keywords.filter((k) => !["last", "message"].includes(k));
  }

  // Exact-channel / project-status: never hard-gate history on structural leftovers.
  const exactChannelScoped =
    channelsResult.channels.length === 1 &&
    (intent === "project_status" ||
      intent === "latest_update" ||
      intent === "channel_search" ||
      intent === "conversation_recall");
  if (exactChannelScoped || intent === "project_status" || derivedProjectChannel) {
    keywords = keywords.filter((k) => !isStructuralProjectKeyword(k));
    const channelTokens = new Set(
      channelsResult.channels.flatMap((c) =>
        c.name
          .toLowerCase()
          .split(/[-_]/)
          .filter((t) => t.length >= 2),
      ),
    );
    if (derivedProjectChannel) {
      for (const t of derivedProjectChannel.slug.split("-")) {
        if (t.length >= 2) channelTokens.add(t);
      }
      channelTokens.add(derivedProjectChannel.shortName.toLowerCase());
    }
    keywords = keywords.filter((k) => !channelTokens.has(k.toLowerCase()));
  }

  const timeRangeRaw = parseSlackTimeRange(input.question, now);
  let timeRange =
    intent === "latest_message" && timeRangeRaw?.label === "last 30 days (default)"
      ? null
      : timeRangeRaw;

  // Project status / latest update with an explicit channel: do NOT clamp to a short
  // default window — the latest meaningful update may be older than 14–30 days.
  if (
    (intent === "project_status" || intent === "latest_update") &&
    channelsResult.channels.length === 1 &&
    timeRangeRaw?.label === "last 30 days (default)"
  ) {
    timeRange = null;
  }

  if (!timeRange && (intent === "channel_search" || intent === "time_window_summary")) {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 14);
    timeRange = {
      from,
      to: now,
      fromUnix: Math.floor(from.getTime() / 1000),
      toUnix: Math.floor(now.getTime() / 1000),
      fromIso: from.toISOString(),
      toIso: now.toISOString(),
      label: "last 14 days (channel summary default)",
    };
  }
  const sort = defaultSortForIntent(intent);
  const limit = defaultLimitForIntent(intent);

  const plan: SlackQueryPlan = {
    intent,
    people: peopleResult.people,
    channels: channelsResult.channels,
    keywords,
    phrases,
    decisionLanguage,
    timeRange,
    sort,
    limit,
    includeThreads: intent !== "latest_message",
    includeNearbyContext: intent !== "latest_message",
    naturalQuery: input.question.trim(),
  };

  return {
    plan,
    ambiguities: {
      people: peopleResult.ambiguities,
      channels: channelsResult.ambiguities,
    },
    notFound: {
      people: peopleResult.notFound,
      channels: notFoundChannels,
    },
    derivedProjectChannel,
  };
}

/** Build a Slack search query string from a validated plan (modifiers + keywords). */
export function buildSlackSearchQuery(plan: SlackQueryPlan): string {
  const parts: string[] = [];

  for (const person of plan.people) {
    parts.push(`from:<@${person.id}>`);
  }
  for (const channel of plan.channels) {
    parts.push(`in:<#${channel.id}>`);
  }
  for (const phrase of plan.phrases) {
    parts.push(`"${phrase}"`);
  }
  if (plan.intent === "decision_search" && plan.decisionLanguage.length) {
    parts.push(...plan.decisionLanguage.slice(0, 3));
  }

  // Project-status / exact-channel latest: channel scope alone is enough —
  // do not AND leftover keywords that zero out RTS (e.g. "project").
  const skipKeywords =
    plan.channels.length === 1 &&
    (plan.intent === "project_status" || plan.intent === "latest_update") &&
    plan.people.length === 0;
  if (!skipKeywords) {
    parts.push(...plan.keywords);
  }

  if (plan.timeRange) {
    parts.push(`after:${formatSlackDate(plan.timeRange.from)}`);
    parts.push(`before:${formatSlackDate(plan.timeRange.to)}`);
  }

  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length >= 3) return joined;
  return plan.naturalQuery;
}
