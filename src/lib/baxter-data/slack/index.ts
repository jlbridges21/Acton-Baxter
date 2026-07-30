/**
 * Slack live evidence provider.
 *
 * Slack remains the source of truth — no message mirror in Supabase.
 * Prompt 2: retrieveSlackForAnswer() integrates into answerBaxterQuestion().
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
export {
  extractProjectNumbers,
  extractProjectNameQueries,
  isProjectStatusQuestion,
  scoreProjectChannelMatch,
} from "./project-status";
export { resolvePersonFromDirectory, resolvePeople, formatPersonLabel } from "./users";
export { resolveChannelFromDirectory, resolveChannels, formatChannelLabel } from "./channels";
export { executeSlackSearchPlan } from "./search";
export { retrieveSlackEvidence, planAndDescribeSlackSearch } from "./evidence";
export { retrieveSlackForAnswer } from "./orchestrate";
export { detectSlackSearchRole, isStrongSlackQuestion } from "./when";
export { classifySlackStatementStrength, selectSlackEvidenceForModel } from "./select";
export { classifyDecisionRole, buildDecisionCandidate, rankDecisionEvidence } from "./decisions";
export { filterSlackEvidenceNoise, evidenceBudgetForIntent } from "./filter";
export {
  shouldResetSlackFollowUpContext,
  expandRelativeTimeFollowUp,
  resolveSlackFollowUpQuestion,
} from "./follow-up";
export { runAllSlackRecallEvals, summarizeSlackRecallEvals } from "./eval-suite";
export { formatSlackEvidenceExcerpt, formatSlackEvidenceForAdmin } from "./format";
export {
  getSlackSearchDiagnosticsSnapshot,
  runSlackSearchAdminTest,
  previewSlackSearchPlan,
} from "./diagnostics";
export { refreshSlackWorkspaceDirectory } from "./directory-sync";
export {
  listCachedSlackUsers,
  listCachedSlackChannels,
  getSlackDirectoryHealth,
  refreshAndListDirectory,
} from "./directory";
export { filterEvidenceByPlanIntegrity } from "./integrity";
export { normalizeChannelQuery } from "./channels";
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
