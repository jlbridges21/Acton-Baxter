import "server-only";

import { employeeFacingSlackSearchError, SLACK_SEARCH_ERROR_CODES } from "./errors";
import { listCachedSlackChannels, listCachedSlackUsers } from "./directory";
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

/**
 * Prompt 2 entry point: plan + authorize + live-search Slack evidence.
 * Authorization is enforced before results are returned (and thus before any LLM).
 */
export async function retrieveSlackEvidence(
  input: RetrieveSlackEvidenceInput,
): Promise<SlackEvidenceResult> {
  const teamId = input.requester.slackTeamId ?? "";
  const deps = {
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
  const planned =
    input.plan != null
      ? {
          plan: input.plan,
          ambiguities: { people: [], channels: [] },
          notFound: { people: [], channels: [] },
        }
      : await planSlackSearch({
          question: input.question,
          teamId: teamId || cred.credential.slackTeamId || "",
          deps,
        });

  if (planned.ambiguities.people.length || planned.ambiguities.channels.length) {
    const code = planned.ambiguities.people.length
      ? SLACK_SEARCH_ERROR_CODES.PERSON_AMBIGUOUS
      : SLACK_SEARCH_ERROR_CODES.CHANNEL_AMBIGUOUS;
    return {
      plan: planned.plan,
      results: [],
      clusters: [],
      ambiguities: planned.ambiguities,
      access,
      incomplete: {
        code,
        message: employeeFacingSlackSearchError(code),
        retryable: false,
      },
      diagnostics: {
        ...emptyDiagnostics(access),
        notes: ["Resolution ambiguous — Prompt 2 should ask the employee to clarify."],
      },
    };
  }

  // Channel required for latest_message exactness
  if (
    planned.plan.intent === "latest_message" &&
    planned.plan.channels.length === 0 &&
    planned.notFound.channels.length
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
      diagnostics: emptyDiagnostics(access),
    };
  }

  const executed = await executeSlackSearchPlan({
    plan: planned.plan,
    credential: cred.credential,
    deps,
  });

  let results = filterEvidenceByAccess(executed.results, access);

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
      notes: executed.diagnostics.notes,
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
