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
import {
  formatSlackRetrievalStatusForModel,
  type SlackRetrievalStatus,
  type SlackRetrievalStatusCode,
} from "./retrieval-status";
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
  authorization: "user" | "bot_with_action_token" | "bot_public" | "none" | "unavailable";
  rateLimited: boolean;
  durationMs: number;
  followUpReset: boolean;
  retrievalStatus: SlackRetrievalStatusCode;
  retrievalMethod: string | null;
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
  retrievalStatus: SlackRetrievalStatus;
  retrievalStatusPrompt: string;
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

function authKind(tokenKind: string | null | undefined): SlackRuntimeDiagnostics["authorization"] {
  if (tokenKind === "user" || tokenKind === "bot_with_action_token" || tokenKind === "bot_public") {
    return tokenKind;
  }
  if (tokenKind === "none") return "none";
  return "unavailable";
}

function statusFromIncomplete(code: string | null | undefined): SlackRetrievalStatusCode {
  switch (code) {
    case SLACK_SEARCH_ERROR_CODES.AUTH_REQUIRED:
    case SLACK_SEARCH_ERROR_CODES.USER_NOT_LINKED:
      return "authorization_required";
    case SLACK_SEARCH_ERROR_CODES.CHANNEL_NOT_FOUND:
      return "channel_not_found";
    case SLACK_SEARCH_ERROR_CODES.PERSON_NOT_FOUND:
      return "person_not_found";
    case SLACK_SEARCH_ERROR_CODES.PERSON_AMBIGUOUS:
      return "person_ambiguous";
    case SLACK_SEARCH_ERROR_CODES.CHANNEL_AMBIGUOUS:
      return "channel_ambiguous";
    case SLACK_SEARCH_ERROR_CODES.RATE_LIMITED:
      return "rate_limited";
    case SLACK_SEARCH_ERROR_CODES.DISABLED:
      return "disabled";
    case SLACK_SEARCH_ERROR_CODES.SEARCH_UNAVAILABLE:
    case SLACK_SEARCH_ERROR_CODES.SCOPE_MISSING:
    case SLACK_SEARCH_ERROR_CODES.MISCONFIGURED:
      return "search_unavailable";
    default:
      return "error";
  }
}

function buildRetrievalStatus(input: {
  status: SlackRetrievalStatusCode;
  plan: SlackQueryPlan | null;
  resultCount: number;
  credentialPath: string | null;
  retrievalMethod: string | null;
  employeeNote: string | null;
}): SlackRetrievalStatus {
  return {
    status: input.status,
    intent: input.plan?.intent ?? null,
    channel: input.plan?.channels[0]?.displayLabel ?? null,
    person: input.plan?.people[0]?.displayName ?? null,
    resultCount: input.resultCount,
    credentialPath: input.credentialPath,
    retrievalMethod: input.retrievalMethod,
    employeeNote: input.employeeNote,
  };
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

  const empty = (partial?: Partial<SlackRuntimeDiagnostics>): SlackRuntimeResult => {
    const retrievalStatusCode = partial?.retrievalStatus ?? "skipped";
    const retrievalStatus = buildRetrievalStatus({
      status: retrievalStatusCode,
      plan: null,
      resultCount: 0,
      credentialPath: null,
      retrievalMethod: null,
      employeeNote:
        retrievalStatusCode === "disabled"
          ? "Slack search is not enabled for Baxter in this environment."
          : null,
    });
    return {
      items: [],
      selected: [],
      plan: null,
      nextConversationState: null,
      authNote: null,
      noResultsNote: null,
      incompleteNote: null,
      retrievalStatus,
      retrievalStatusPrompt: formatSlackRetrievalStatusForModel(retrievalStatus),
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
        retrievalStatus: retrievalStatusCode,
        retrievalMethod: null,
        notes: [],
        ...partial,
      },
    };
  };

  if (!isSlackSearchEnabled()) {
    const note = "Slack search is not enabled for Baxter in this environment.";
    const result = empty({
      retrievalStatus: "disabled",
      notes: ["ENABLE_SLACK_SEARCH is false"],
      incomplete: true,
      incompleteCode: SLACK_SEARCH_ERROR_CODES.DISABLED,
      ran: false,
    });
    return {
      ...result,
      incompleteNote: note,
      retrievalStatus: {
        ...result.retrievalStatus,
        employeeNote: note,
      },
      retrievalStatusPrompt: formatSlackRetrievalStatusForModel({
        ...result.retrievalStatus,
        employeeNote: note,
      }),
    };
  }

  if (role === "skip") {
    return empty({
      retrievalStatus: "skipped",
      notes: ["Slack search not needed"],
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

  const wrapStatus = (
    status: SlackRetrievalStatusCode,
    extras: {
      authNote?: string | null;
      noResultsNote?: string | null;
      incompleteNote?: string | null;
      selected?: SlackMessageEvidence[];
      items?: ReturnType<typeof slackEvidenceToContextItems>;
      nextConversationState?: SlackConversationContext | null;
      notes?: string[];
    } = {},
  ): SlackRuntimeResult => {
    const selected = extras.selected ?? [];
    const retrievalStatus = buildRetrievalStatus({
      status,
      plan,
      resultCount: selected.length || merged.length,
      credentialPath: lastResult?.access.tokenKind ?? null,
      retrievalMethod: lastResult?.diagnostics.endpoint ?? null,
      employeeNote: extras.authNote || extras.noResultsNote || extras.incompleteNote || null,
    });
    return {
      items: extras.items ?? [],
      selected,
      plan,
      nextConversationState: extras.nextConversationState ?? null,
      authNote: extras.authNote ?? null,
      noResultsNote: extras.noResultsNote ?? null,
      incompleteNote: extras.incompleteNote ?? null,
      retrievalStatus,
      retrievalStatusPrompt: formatSlackRetrievalStatusForModel(retrievalStatus),
      diagnostics: {
        role,
        ran: true,
        intent: plan?.intent ?? null,
        resultCount: merged.length,
        selectedCount: selected.length,
        searchCount,
        threadsExpanded: selected.filter((s) => s.threadTs && s.contextMessages.length > 0).length,
        incomplete: status !== "results_found" && status !== "searched_no_results",
        incompleteCode: lastResult?.incomplete?.code ?? null,
        authorization: authKind(lastResult?.access.tokenKind),
        rateLimited: Boolean(lastResult?.diagnostics.rateLimited),
        durationMs: Date.now() - start,
        followUpReset: follow.reset,
        retrievalStatus: status,
        retrievalMethod: lastResult?.diagnostics.endpoint ?? null,
        notes: [
          ...(follow.reset ? ["Follow-up context reset (new topic)"] : []),
          ...(extras.notes ?? []),
          ...(lastResult?.diagnostics.notes ?? []),
        ],
      },
    };
  };

  // Ambiguity — return without inventing
  if (
    lastResult.incomplete?.code === SLACK_SEARCH_ERROR_CODES.PERSON_AMBIGUOUS ||
    lastResult.incomplete?.code === SLACK_SEARCH_ERROR_CODES.CHANNEL_AMBIGUOUS
  ) {
    return wrapStatus(statusFromIncomplete(lastResult.incomplete.code), {
      noResultsNote: lastResult.incomplete.message,
      notes: ["Resolution ambiguous"],
    });
  }

  if (
    lastResult.incomplete?.code === SLACK_SEARCH_ERROR_CODES.CHANNEL_NOT_FOUND ||
    lastResult.incomplete?.code === SLACK_SEARCH_ERROR_CODES.PERSON_NOT_FOUND
  ) {
    return wrapStatus(statusFromIncomplete(lastResult.incomplete.code), {
      noResultsNote: lastResult.incomplete.message,
    });
  }

  // Auth required — always surface concrete note when Slack was supposed to run
  if (
    lastResult.incomplete?.code === SLACK_SEARCH_ERROR_CODES.USER_NOT_LINKED ||
    lastResult.incomplete?.code === SLACK_SEARCH_ERROR_CODES.AUTH_REQUIRED
  ) {
    const connectUrl = `${getPublicAppBaseUrl()}/settings/integrations`;
    return wrapStatus("authorization_required", {
      authNote: formatSlackAuthRequiredNote(connectUrl),
      notes: ["Slack authorization required"],
    });
  }

  // Bounded follow-up searches when sparse
  if (merged.length < 2 && plan && searchCount <= MAX_FOLLOWUP_SEARCHES) {
    const variants = buildExpandedKeywordVariants(plan.keywords, expandedQuestion);
    for (const variant of variants.slice(1)) {
      if (searchCount > MAX_FOLLOWUP_SEARCHES) break;
      if (merged.length >= 5) break;
      const followPlan: SlackQueryPlan = { ...plan, keywords: variant };
      const followResult = await runOnce(expandedQuestion, followPlan);
      lastResult = followResult;
      merged = dedupeEvidence([...merged, ...followResult.results]);
    }
  }

  // One alternate natural query for RACI-style sparse topics
  if (merged.length === 0 && plan && searchCount <= MAX_FOLLOWUP_SEARCHES) {
    const expansions = buildExpandedKeywordVariants(plan.keywords, expandedQuestion);
    if (expansions[1]) {
      const followPlan = { ...plan, keywords: expansions[1] };
      const followResult = await runOnce(expandedQuestion, followPlan);
      lastResult = followResult;
      merged = dedupeEvidence([...merged, ...followResult.results]);
    }
  }

  const selected = plan ? selectSlackEvidenceForModel(merged, plan) : merged.slice(0, 8);
  const items = slackEvidenceToContextItems(selected, plan, 1);

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

  if (lastResult?.diagnostics.rateLimited && selected.length === 0) {
    return wrapStatus("rate_limited", {
      incompleteNote: "Slack search is temporarily rate-limited. Please try again in a minute.",
      selected,
      items,
      nextConversationState,
    });
  }

  if (
    selected.length === 0 &&
    lastResult?.incomplete &&
    lastResult.incomplete.code !== SLACK_SEARCH_ERROR_CODES.SEARCH_UNAVAILABLE
  ) {
    return wrapStatus(statusFromIncomplete(lastResult.incomplete.code), {
      incompleteNote: lastResult.incomplete.message,
      selected,
      items,
      nextConversationState,
    });
  }

  if (selected.length === 0) {
    const channel = plan?.channels[0]?.displayLabel;
    const person = plan?.people[0]?.displayName;
    let noResultsNote = formatSlackNoResultsNote(input.question);
    if (channel && person) {
      noResultsNote = `I searched ${channel} but couldn't find a matching message from ${person} in the recent history I checked.`;
    } else if (channel) {
      noResultsNote = `I searched ${channel} but couldn't find matching messages in the recent history I checked.`;
    }
    return wrapStatus("searched_no_results", {
      noResultsNote,
      selected,
      items,
      nextConversationState,
    });
  }

  return wrapStatus("results_found", {
    selected,
    items,
    nextConversationState,
  });
}

export async function previewSlackPlan(question: string, teamId: string) {
  return planSlackSearch({ question, teamId });
}
