import type { SlackSearchErrorCode } from "./errors";

/** Slack conversational evidence — not approved Knowledge Center policy. */
export const SLACK_SOURCE_TYPE = "slack" as const;

export type SlackSearchIntent =
  | "person_statement"
  | "latest_update"
  | "latest_message"
  | "topic_search"
  | "decision_search"
  | "mention_search"
  | "channel_search"
  | "time_window_summary"
  | "thread_context"
  | "conversation_recall";

export type SlackSearchSort = "relevance" | "newest" | "oldest";

export type SlackChannelKind = "public_channel" | "private_channel" | "im" | "mpim";

export type ResolvedSlackPerson = {
  id: string;
  displayName: string;
  realName: string | null;
  username: string | null;
  teamId: string;
};

export type ResolvedSlackChannel = {
  id: string;
  name: string;
  displayLabel: string;
  teamId: string;
  kind: SlackChannelKind;
  isPrivate: boolean;
  /** Cached/live membership for the bot (or inspecting token). */
  isMember?: boolean | null;
  /** Archived channels are excluded from default retrieval. */
  isArchived?: boolean | null;
};

export type SlackTimeRange = {
  from: Date;
  to: Date;
  fromUnix: number;
  toUnix: number;
  fromIso: string;
  toIso: string;
  label: string;
};

export type SlackQueryPlan = {
  intent: SlackSearchIntent;
  people: ResolvedSlackPerson[];
  channels: ResolvedSlackChannel[];
  keywords: string[];
  phrases: string[];
  decisionLanguage: string[];
  timeRange: SlackTimeRange | null;
  sort: SlackSearchSort;
  limit: number;
  includeThreads: boolean;
  includeNearbyContext: boolean;
  /** Raw question retained for semantic RTS queries when useful. */
  naturalQuery: string;
};

export type SlackPersonAmbiguity = {
  query: string;
  candidates: ResolvedSlackPerson[];
};

export type SlackChannelAmbiguity = {
  query: string;
  candidates: ResolvedSlackChannel[];
};

export type SlackContextMessage = {
  messageTs: string;
  authorId: string | null;
  authorName: string | null;
  text: string;
  timestamp: string | null;
};

export type SlackMessageEvidence = {
  sourceType: typeof SLACK_SOURCE_TYPE;
  messageTs: string;
  threadTs: string | null;
  channelId: string;
  channelName: string | null;
  channelKind: SlackChannelKind | null;
  authorId: string | null;
  authorName: string | null;
  timestamp: string | null;
  text: string;
  permalink: string | null;
  isThreadReply: boolean;
  relevance: number | null;
  contextMessages: SlackContextMessage[];
  clusterKey: string;
};

export type SlackConversationCluster = {
  clusterKey: string;
  channelId: string;
  channelName: string | null;
  threadTs: string | null;
  dateLabel: string | null;
  messages: SlackMessageEvidence[];
};

export type SlackAccessCapabilities = {
  publicChannels: boolean;
  privateChannels: boolean;
  dms: boolean;
  groupDms: boolean;
  threadContext: boolean;
  permalinks: boolean;
  userLevelAuthorization: "configured" | "not_configured" | "partial";
  tokenKind: "user" | "bot_with_action_token" | "bot_public" | "none";
  allowedChannelTypes: SlackChannelKind[];
};

export type SlackSearchDiagnostics = {
  endpoint: string | null;
  latencyMs: number | null;
  resultCount: number;
  paginationCount: number;
  rateLimited: boolean;
  capabilities: SlackAccessCapabilities;
  exactNewestGuaranteed: boolean | null;
  notes: string[];
};

export type SlackSearchIncomplete = {
  code: SlackSearchErrorCode;
  message: string;
  retryable: boolean;
};

export type SlackRequester = {
  /** Baxter profile UUID when known (web). */
  baxterUserId?: string | null;
  /** Slack user ID when known (Slack DM/mention or linked web user). */
  slackUserId?: string | null;
  slackTeamId?: string | null;
  /** From Slack message events — required for bot-token RTS public search. */
  actionToken?: string | null;
  /** Admin sandbox may use public-only fallbacks; never private/DM. */
  allowPublicOnlyFallback?: boolean;
};

export type SlackEvidenceResult = {
  plan: SlackQueryPlan | null;
  results: SlackMessageEvidence[];
  clusters: SlackConversationCluster[];
  ambiguities: {
    people: SlackPersonAmbiguity[];
    channels: SlackChannelAmbiguity[];
  };
  access: SlackAccessCapabilities;
  incomplete: SlackSearchIncomplete | null;
  diagnostics: SlackSearchDiagnostics;
};

export type RetrieveSlackEvidenceInput = {
  requester: SlackRequester;
  question: string;
  plan?: SlackQueryPlan;
  /** Injected for tests — live Slack API by default. */
  deps?: SlackSearchDeps;
};

export type SlackApiCallResult = {
  ok: boolean;
  error?: string;
  data: Record<string, unknown>;
  retryAfterSeconds?: number | null;
  httpStatus?: number;
};

export type SlackSearchDeps = {
  callSlackApi?: (
    method: string,
    options: {
      token: string;
      body?: Record<string, unknown>;
      form?: boolean;
      maxRetries?: number;
      timeoutMs?: number;
    },
  ) => Promise<SlackApiCallResult>;
  listCachedUsers?: (teamId: string) => Promise<ResolvedSlackPerson[]>;
  listCachedChannels?: (teamId: string) => Promise<ResolvedSlackChannel[]>;
  resolveSearchCredential?: (
    requester: SlackRequester,
  ) => Promise<SlackCredentialResolution | null>;
  now?: () => Date;
};

export type SlackCredentialResolution = {
  token: string;
  /** user OAuth, bot+action_token for RTS, or bot_public for conversations.history on public channels */
  tokenKind: "user" | "bot_with_action_token" | "bot_public";
  slackUserId: string | null;
  slackTeamId: string | null;
  scopes: string[];
  actionToken?: string | null;
  capabilities: SlackAccessCapabilities;
};
