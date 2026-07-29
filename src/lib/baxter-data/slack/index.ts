/**
 * Slack live evidence provider (Prompt 1).
 *
 * Slack remains the source of truth — no message mirror in Supabase.
 * Prompt 2 wires retrieveSlackEvidence into answerBaxterQuestion().
 */

export { SLACK_SOURCE_TYPE } from "./types";
export type {
  SlackSearchIntent,
  SlackQueryPlan,
  SlackMessageEvidence,
  SlackEvidenceResult,
  SlackRequester,
  RetrieveSlackEvidenceInput,
  SlackAccessCapabilities,
  SlackCredentialResolution,
} from "./types";

export { SLACK_SEARCH_ERROR_CODES, employeeFacingSlackSearchError } from "./errors";
export {
  isSlackSearchEnabled,
  getSlackSearchRuntimeConfig,
  SLACK_SEARCH_USER_SCOPES,
} from "./config";
export { parseSlackTimeRange } from "./temporal";
export {
  detectSlackSearchIntent,
  extractPersonQueries,
  extractChannelMentions,
  extractKeywords,
  getDecisionLanguageTerms,
} from "./intent";
export { planSlackSearch, buildSlackSearchQuery } from "./query-plan";
export { resolvePersonFromDirectory, resolvePeople, formatPersonLabel } from "./users";
export { resolveChannelFromDirectory, resolveChannels, formatChannelLabel } from "./channels";
export { executeSlackSearchPlan } from "./search";
export { retrieveSlackEvidence, planAndDescribeSlackSearch } from "./evidence";
export { formatSlackEvidenceExcerpt, formatSlackEvidenceForAdmin } from "./format";
export {
  getSlackSearchDiagnosticsSnapshot,
  runSlackSearchAdminTest,
  previewSlackSearchPlan,
} from "./diagnostics";
export {
  resolveSearchCredential,
  filterEvidenceByAccess,
  filterAllowedChannelTypes,
  assertNoForeignDmLeak,
} from "./permissions";
export {
  normalizeSearchMessage,
  groupEvidenceIntoClusters,
  groupEvidenceByAuthor,
} from "./normalize";
