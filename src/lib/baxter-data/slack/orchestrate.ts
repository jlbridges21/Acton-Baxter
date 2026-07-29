import "server-only";

import { getPublicAppBaseUrl } from "@/lib/slack/config";
import { isSlackSearchEnabled } from "./config";
import {
  buildSlackConversationContext,
  expandQuestionWithSlackContext,
  readSlackConversationState,
  type SlackConversationContext,
} from "./conversation-state";
import { retrieveSlackEvidence } from "./evidence";
import { SLACK_SEARCH_ERROR_CODES } from "./errors";
import { resolveSlackFollowUpQuestion } from "./follow-up";
import { planSlackSearch } from "./query-plan";
import { selectSlackEvidenceForModel } from "./select";
import { buildExpandedKeywordVariants } from "./synonyms";
import {
  formatSlackAuthRequiredNote,
  formatSlackNoResultsNote,
  slackEvidenceToContextItems,
} from "./to-context";
import { detectSlackSearchRole } from "./when";
import type {
  RetrieveSlackEvidenceInput,
  SlackEvidenceResult,
  SlackMessageEvidence,
  SlackQueryPlan,
  SlackRequester,
  SlackSearchDeps,
} from "./types";

export type SlackRuntimeDiagnostics = {
  role: "primary" | "fallback" | "skip";
  ran: boolean;
  intent: string | null;
  resultCount: number;
  selectedCount: number;
  searchCount: number;
  threadsExpanded: number;
  incomplete: boolean;
  incompleteCode: string | null;
  authorization: "user" | "bot_with_action_token" | "none" | "unavailable";
  rateLimited: boolean;
  durationMs: number;
  followUpReset: boolean;
  notes: string[];
};

export type SlackRuntimeResult = {
  items: ReturnType<typeof slackEvidenceToContextItems>;
  selected: SlackMessageEvidence[];
  plan: SlackQueryPlan | null;
  nextConversationState: SlackConversationContext | null;
  authNote: string | null;
  noResultsNote: string | null;
  incompleteNote: string | null;
  diagnostics: SlackRuntimeDiagnostics;
};

const MAX_FOLLOWUP_SEARCHES = 2;

function dedupeEvidence(items: SlackMessageEvidence[]): SlackMessageEvidence[] {
  const seen = new Set<string>();
  const out: SlackMessageEvidence[] = [];
  for (const item of items) {
    const key = `${item.channelId}:${item.messageTs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Orchestrate Slack retrieval for answerBaxterQuestion — bounded follow-up searches,
 * selection, and conversion to context items. Authorization already applied inside retrieveSlackEvidence.
 */
export async function retrieveSlackForAnswer(input: {
  question: string;
  requester: SlackRequester;
  conversationMetadata?: Record<string, unknown> | null;
  hasOtherStrongEvidence?: boolean;
  roleOverride?: "primary" | "fallback" | "skip";
  deps?: SlackSearchDeps;
}): Promise<SlackRuntimeResult> {
  const start = Date.now();
  const priorRaw = readSlackConversationState(input.conversationMetadata);
  const follow = resolveSlackFollowUpQuestion(input.question, priorRaw);
  const prior = follow.prior;
  const role =
    input.roleOverride ??
    detectSlackSearchRole({
      question: follow.question,
      hasOtherStrongEvidence: input.hasOtherStrongEvidence,
      followUpSlackContext: Boolean(prior?.refs.length || prior?.topic),
    });

  const empty = (partial?: Partial<SlackRuntimeDiagnostics>): SlackRuntimeResult => ({
    items: [],
    selected: [],
    plan: null,
    nextConversationState: null,
    authNote: null,
    noResultsNote: null,
    incompleteNote: null,
    diagnostics: {
      role,
      ran: false,
      intent: null,
      resultCount: 0,
      selectedCount: 0,
      searchCount: 0,
      threadsExpanded: 0,
      incomplete: false,
      incompleteCode: null,
      authorization: "none",
      rateLimited: false,
      durationMs: Date.now() - start,
      followUpReset: follow.reset,
      notes: [],
      ...partial,
    },
  });

  if (role === "skip" || !isSlackSearchEnabled()) {
    return empty({
      notes: !isSlackSearchEnabled()
        ? ["ENABLE_SLACK_SEARCH is false"]
        : ["Slack search not needed"],
    });
  }

  const expandedQuestion = expandQuestionWithSlackContext(follow.question, prior);

  let searchCount = 0;
  let merged: SlackMessageEvidence[] = [];
  let lastResult: SlackEvidenceResult | null = null;
  let plan: SlackQueryPlan | null = null;

  const runOnce = async (question: string, planOverride?: SlackQueryPlan) => {
    searchCount += 1;
    const req: RetrieveSlackEvidenceInput = {
      requester: input.requester,
      question,
      plan: planOverride,
      deps: input.deps,
    };
    return retrieveSlackEvidence(req);
  };

  lastResult = await runOnce(expandedQuestion);
  plan = lastResult.plan;
  merged = dedupeEvidence(lastResult.results);

  // Ambiguity — return without inventing
  if (
    lastResult.incomplete?.code === SLACK_SEARCH_ERROR_CODES.PERSON_AMBIGUOUS ||
    lastResult.incomplete?.code === SLACK_SEARCH_ERROR_CODES.CHANNEL_AMBIGUOUS
  ) {
    return {
      ...empty({
        ran: true,
        intent: plan?.intent ?? null,
        searchCount,
        incomplete: true,
        incompleteCode: lastResult.incomplete.code,
        authorization:
          lastResult.access.tokenKind === "none" ? "none" : lastResult.access.tokenKind,
        notes: ["Resolution ambiguous"],
      }),
      noResultsNote: lastResult.incomplete.message,
      plan,
    };
  }

  // Auth required for primary Slack questions
  if (
    lastResult.incomplete?.code === SLACK_SEARCH_ERROR_CODES.USER_NOT_LINKED ||
    lastResult.incomplete?.code === SLACK_SEARCH_ERROR_CODES.AUTH_REQUIRED
  ) {
    const connectUrl = `${getPublicAppBaseUrl()}/settings/integrations`;
    return {
      ...empty({
        ran: true,
        intent: plan?.intent ?? null,
        searchCount,
        incomplete: true,
        incompleteCode: lastResult.incomplete.code,
        authorization: "unavailable",
        notes: ["Slack user not linked"],
      }),
      authNote: role === "primary" ? formatSlackAuthRequiredNote(connectUrl) : null,
      plan,
    };
  }

  // Bounded follow-up searches when sparse
  if (merged.length < 2 && plan && searchCount <= MAX_FOLLOWUP_SEARCHES) {
    const variants = buildExpandedKeywordVariants(plan.keywords, expandedQuestion);
    for (const variant of variants.slice(1)) {
      if (searchCount > MAX_FOLLOWUP_SEARCHES) break;
      if (merged.length >= 5) break;
      const followPlan: SlackQueryPlan = { ...plan, keywords: variant };
      const follow = await runOnce(expandedQuestion, followPlan);
      lastResult = follow;
      merged = dedupeEvidence([...merged, ...follow.results]);
    }
  }

  // One alternate natural query for RACI-style sparse topics
  if (merged.length === 0 && plan && searchCount <= MAX_FOLLOWUP_SEARCHES) {
    const expansions = buildExpandedKeywordVariants(plan.keywords, expandedQuestion);
    if (expansions[1]) {
      const followPlan = { ...plan, keywords: expansions[1] };
      const follow = await runOnce(expandedQuestion, followPlan);
      lastResult = follow;
      merged = dedupeEvidence([...merged, ...follow.results]);
    }
  }

  const selected = plan ? selectSlackEvidenceForModel(merged, plan) : merged.slice(0, 8);
  const items = slackEvidenceToContextItems(selected, plan, 1);
  const threadsExpanded = selected.filter((s) => s.threadTs && s.contextMessages.length > 0).length;

  const nextConversationState =
    selected.length > 0
      ? buildSlackConversationContext({
          topic: plan?.keywords.slice(0, 6).join(" ") || prior?.topic || null,
          people: [
            ...new Set([
              ...(plan?.people.map((p) => p.displayName) ?? []),
              ...(selected.map((s) => s.authorName).filter(Boolean) as string[]),
            ]),
          ],
          channels: [
            ...new Set([
              ...(plan?.channels.map((c) => c.displayLabel) ?? []),
              ...selected.map((s) => (s.channelName ? `#${s.channelName}` : "")).filter(Boolean),
            ]),
          ],
          timeRangeLabel: plan?.timeRange?.label ?? prior?.timeRangeLabel ?? null,
          intent: plan?.intent ?? null,
          refs: selected.slice(0, 6).map((s) => ({
            authorName: s.authorName,
            channelName: s.channelName,
            permalink: s.permalink,
            messageTs: s.messageTs,
            channelId: s.channelId,
          })),
        })
      : follow.reset
        ? null
        : prior;

  const incomplete = Boolean(lastResult?.incomplete || lastResult?.diagnostics.rateLimited);
  let incompleteNote: string | null = null;
  if (incomplete && selected.length > 0) {
    incompleteNote =
      "From the Slack conversations I could access (search may be incomplete due to rate limits or result caps):";
  } else if (incomplete && selected.length === 0 && lastResult?.incomplete) {
    incompleteNote = lastResult.incomplete.message;
  }

  let noResultsNote: string | null = null;
  if (selected.length === 0 && role === "primary" && !incompleteNote && !lastResult?.incomplete) {
    noResultsNote = formatSlackNoResultsNote(input.question);
  }

  return {
    items,
    selected,
    plan,
    nextConversationState,
    authNote: null,
    noResultsNote,
    incompleteNote,
    diagnostics: {
      role,
      ran: true,
      intent: plan?.intent ?? null,
      resultCount: merged.length,
      selectedCount: selected.length,
      searchCount,
      threadsExpanded,
      incomplete,
      incompleteCode: lastResult?.incomplete?.code ?? null,
      authorization:
        lastResult?.access.tokenKind === "user" ||
        lastResult?.access.tokenKind === "bot_with_action_token"
          ? lastResult.access.tokenKind
          : "none",
      rateLimited: Boolean(lastResult?.diagnostics.rateLimited),
      durationMs: Date.now() - start,
      followUpReset: follow.reset,
      notes: [
        ...(follow.reset ? ["Follow-up context reset (new topic)"] : []),
        ...(lastResult?.diagnostics.notes ?? []),
      ],
    },
  };
}

export async function previewSlackPlan(question: string, teamId: string) {
  return planSlackSearch({ question, teamId });
}
