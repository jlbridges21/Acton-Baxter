import "server-only";

import { employeeFacingSlackSearchError, SLACK_SEARCH_ERROR_CODES } from "./errors";
import {
  listCachedSlackChannels,
  listCachedSlackUsers,
  refreshAndListDirectory,
} from "./directory";
import { extractChannelMentions, extractPersonQueries } from "./intent";
import { filterEvidenceByPlanIntegrity, isChannelScopedIntent } from "./integrity";
import {
  assertNoForeignDmLeak,
  defaultEmptyAccess,
  filterEvidenceByAccess,
  resolveSearchCredential,
} from "./permissions";
import { planSlackSearch } from "./query-plan";
import { executeSlackSearchPlan, groupEvidenceIntoClusters } from "./search";
import type {
  RetrieveSlackEvidenceInput,
  SlackEvidenceResult,
  SlackSearchDiagnostics,
  SlackSearchDeps,
} from "./types";

function emptyDiagnostics(access = defaultEmptyAccess()): SlackSearchDiagnostics {
  return {
    endpoint: null,
    latencyMs: null,
    resultCount: 0,
    paginationCount: 0,
    rateLimited: false,
    capabilities: access,
    exactNewestGuaranteed: null,
    notes: [],
  };
}

function channelWasExplicitlyRequested(question: string): boolean {
  return extractChannelMentions(question).length > 0;
}

function personWasExplicitlyRequested(question: string): boolean {
  return extractPersonQueries(question).length > 0;
}

/**
 * Prompt 2 entry point: plan + authorize + live-search Slack evidence.
 * Authorization is enforced before results are returned (and thus before any LLM).
 */
export async function retrieveSlackEvidence(
  input: RetrieveSlackEvidenceInput,
): Promise<SlackEvidenceResult> {
  const teamId = input.requester.slackTeamId ?? "";
  let deps: SlackSearchDeps = {
    listCachedUsers: input.deps?.listCachedUsers ?? listCachedSlackUsers,
    listCachedChannels: input.deps?.listCachedChannels ?? listCachedSlackChannels,
    callSlackApi: input.deps?.callSlackApi,
    resolveSearchCredential: input.deps?.resolveSearchCredential,
    now: input.deps?.now,
  };

  const cred = await resolveSearchCredential(input.requester, deps);
  if (!cred.ok) {
    return {
      plan: null,
      results: [],
      clusters: [],
      ambiguities: { people: [], channels: [] },
      access: defaultEmptyAccess(),
      incomplete: {
        code: cred.code,
        message: employeeFacingSlackSearchError(cred.code),
        retryable: false,
      },
      diagnostics: emptyDiagnostics(),
    };
  }

  const access = cred.credential.capabilities;
  const resolvedTeamId = teamId || cred.credential.slackTeamId || "";
  const notes: string[] = [];

  let planned =
    input.plan != null
      ? {
          plan: input.plan,
          ambiguities: { people: [], channels: [] },
          notFound: { people: [] as string[], channels: [] as string[] },
        }
      : await planSlackSearch({
          question: input.question,
          teamId: resolvedTeamId,
          deps,
        });

  // Refresh-on-miss: one fast directory sync then re-plan when entity missing from cache.
  // Skip when tests inject a static directory (listCached* provided).
  // Must not stall answer jobs — uses fast mode (~12s wall clock).
  if (
    !input.plan &&
    (planned.notFound.channels.length > 0 || planned.notFound.people.length > 0) &&
    input.deps?.listCachedUsers == null &&
    input.deps?.listCachedChannels == null
  ) {
    notes.push("Directory miss — refreshing Slack users/channels once (fast)");
    const refreshed = await refreshAndListDirectory(
      resolvedTeamId,
      {
        ...deps,
        callSlackApi: deps.callSlackApi,
      },
      { mode: "fast" },
    );
    notes.push(
      `Directory refresh: users=${refreshed.refresh.usersUpserted} channels=${refreshed.refresh.channelsUpserted} complete=${refreshed.refresh.paginationComplete} timedOut=${refreshed.refresh.timedOut} durationMs=${refreshed.refresh.durationMs}`,
    );
    if (refreshed.refresh.timedOut) {
      console.info(
        JSON.stringify({
          scope: "slack.answer",
          stage: "directory_resolution",
          status: "timeout",
          durationMs: refreshed.refresh.durationMs,
        }),
      );
    }
    deps = {
      ...deps,
      listCachedUsers: async () => refreshed.users,
      listCachedChannels: async () => refreshed.channels,
    };
    planned = await planSlackSearch({
      question: input.question,
      teamId: resolvedTeamId,
      deps,
    });
  }

  if (planned.ambiguities.people.length || planned.ambiguities.channels.length) {
    const code = planned.ambiguities.people.length
      ? SLACK_SEARCH_ERROR_CODES.PERSON_AMBIGUOUS
      : SLACK_SEARCH_ERROR_CODES.CHANNEL_AMBIGUOUS;
    const message =
      code === SLACK_SEARCH_ERROR_CODES.PERSON_AMBIGUOUS
        ? `That name matches more than one Slack user: ${planned.ambiguities.people[0]!.candidates.map(
            (c) => c.displayName,
          ).join(", ")}. Which one do you mean?`
        : `That channel name matches more than one Slack channel: ${planned.ambiguities.channels[0]!.candidates.map(
            (c) => c.displayLabel,
          ).join(", ")}. Which one do you mean?`;
    return {
      plan: planned.plan,
      results: [],
      clusters: [],
      ambiguities: planned.ambiguities,
      access,
      incomplete: { code, message, retryable: false },
      diagnostics: {
        ...emptyDiagnostics(access),
        notes: [...notes, "Resolution ambiguous"],
      },
    };
  }

  const explicitChannel = channelWasExplicitlyRequested(input.question);
  const explicitPerson = personWasExplicitlyRequested(input.question);

  // Explicit channel requested but unresolved → fail closed (never broaden to workspace)
  if (
    explicitChannel &&
    planned.plan.channels.length === 0 &&
    planned.notFound.channels.length > 0
  ) {
    const channelLabel = planned.notFound.channels[0]!;
    return {
      plan: planned.plan,
      results: [],
      clusters: [],
      ambiguities: planned.ambiguities,
      access,
      incomplete: {
        code: SLACK_SEARCH_ERROR_CODES.CHANNEL_NOT_FOUND,
        message: `I couldn't find a Slack channel matching “#${channelLabel.replace(/^#/, "")}”.`,
        retryable: false,
      },
      diagnostics: {
        ...emptyDiagnostics(access),
        notes: [...notes, "Explicit channel unresolved — blocked broad search"],
      },
    };
  }

  // Channel-scoped intents without a resolved channel (extraction may have failed) — still fail if mention present
  if (
    isChannelScopedIntent(planned.plan.intent) &&
    explicitChannel &&
    planned.plan.channels.length === 0
  ) {
    return {
      plan: planned.plan,
      results: [],
      clusters: [],
      ambiguities: planned.ambiguities,
      access,
      incomplete: {
        code: SLACK_SEARCH_ERROR_CODES.CHANNEL_NOT_FOUND,
        message: employeeFacingSlackSearchError(SLACK_SEARCH_ERROR_CODES.CHANNEL_NOT_FOUND),
        retryable: false,
      },
      diagnostics: {
        ...emptyDiagnostics(access),
        notes: [...notes, "Channel-scoped intent without resolved channel"],
      },
    };
  }

  // Explicit person for latest_message / person_statement — fail if unresolved
  if (
    explicitPerson &&
    planned.plan.people.length === 0 &&
    planned.notFound.people.length > 0 &&
    (planned.plan.intent === "latest_message" || planned.plan.intent === "person_statement")
  ) {
    const personLabel = planned.notFound.people[0]!;
    return {
      plan: planned.plan,
      results: [],
      clusters: [],
      ambiguities: planned.ambiguities,
      access,
      incomplete: {
        code: SLACK_SEARCH_ERROR_CODES.PERSON_NOT_FOUND,
        message: `I couldn't find an active Slack user matching “${personLabel}”.`,
        retryable: false,
      },
      diagnostics: {
        ...emptyDiagnostics(access),
        notes: [...notes, "Explicit person unresolved"],
      },
    };
  }

  const executed = await executeSlackSearchPlan({
    plan: planned.plan,
    credential: cred.credential,
    deps,
  });

  let results = filterEvidenceByAccess(executed.results, access);

  const integrity = filterEvidenceByPlanIntegrity(results, planned.plan);
  results = integrity.kept;
  if (integrity.reasons.length) notes.push(...integrity.reasons);

  const dmCheck = assertNoForeignDmLeak({
    evidenceChannelIds: results.map((r) => r.channelId),
    evidenceKinds: results.map((r) => r.channelKind),
    requesterSlackUserId: input.requester.slackUserId ?? cred.credential.slackUserId,
    tokenSlackUserId: cred.credential.slackUserId,
    capabilities: access,
  });
  if (!dmCheck.ok) {
    results = results.filter((r) => r.channelKind !== "im" && r.channelKind !== "mpim");
  }

  return {
    plan: planned.plan,
    results,
    clusters: groupEvidenceIntoClusters(results),
    ambiguities: planned.ambiguities,
    access,
    incomplete: executed.incomplete,
    diagnostics: {
      endpoint: executed.diagnostics.endpoint,
      latencyMs: executed.diagnostics.latencyMs,
      resultCount: results.length,
      paginationCount: executed.diagnostics.paginationCount,
      rateLimited: executed.diagnostics.rateLimited,
      capabilities: access,
      exactNewestGuaranteed: executed.diagnostics.exactNewestGuaranteed,
      notes: [...notes, ...executed.diagnostics.notes],
    },
  };
}

export async function planAndDescribeSlackSearch(input: {
  question: string;
  teamId: string;
  deps?: RetrieveSlackEvidenceInput["deps"];
}) {
  return planSlackSearch({
    question: input.question,
    teamId: input.teamId,
    deps: {
      listCachedUsers: input.deps?.listCachedUsers ?? listCachedSlackUsers,
      listCachedChannels: input.deps?.listCachedChannels ?? listCachedSlackChannels,
      now: input.deps?.now,
    },
  });
}
