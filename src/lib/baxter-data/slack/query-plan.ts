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
  const intent = input.intent ?? detectSlackSearchIntent(input.question);
  const personQueries = extractPersonQueries(input.question);
  const channelQueries = extractChannelMentions(input.question);

  const [peopleResult, channelsResult] = await Promise.all([
    resolvePeople(personQueries, input.teamId, input.deps),
    resolveChannels(channelQueries, input.teamId, input.deps),
  ]);

  const dropNames = [
    ...personQueries,
    ...peopleResult.people.flatMap((p) => [p.displayName, p.realName ?? "", p.username ?? ""]),
    ...channelQueries,
  ];

  const phrases = extractPhrases(input.question);
  let keywords = extractKeywords(input.question, dropNames);
  const decisionLanguage =
    intent === "decision_search" ? getDecisionLanguageTerms().slice(0, 8) : [];

  // Keep topic keywords for decision search alongside decision language (applied at query build).
  if (intent === "latest_message") {
    keywords = keywords.filter((k) => !["last", "message"].includes(k));
  }

  const timeRange = parseSlackTimeRange(input.question, now);
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
      channels: channelsResult.notFound,
    },
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
    // OR group of decision terms — Slack uses spaces as AND; use one strong term set via keywords
    parts.push(...plan.decisionLanguage.slice(0, 3));
  }
  parts.push(...plan.keywords);

  if (plan.timeRange) {
    // Prefer after:/before: date filters in query as documented by Slack RTS
    parts.push(`after:${formatSlackDate(plan.timeRange.from)}`);
    parts.push(`before:${formatSlackDate(plan.timeRange.to)}`);
  }

  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  // Prefer keyword query for precise filters; keep natural question when sparse.
  if (joined.length >= 3) return joined;
  return plan.naturalQuery;
}
