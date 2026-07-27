/**
 * Process Rulebook library — versioned RACI + required data definitions.
 */

export type * from "./types";

export { parseRulebookSheets } from "./parser";
export { validateParsedRulebook, RulebookValidator } from "./validator";
export { importParsedRulebook } from "./import";
export type { ImportRulebookOptions, ImportRulebookResult } from "./import";

export {
  getActiveRulebook,
  getRulebookVersion,
  listRulebookVersions,
  getNextVersionNumber,
  activateRulebookVersion,
  loadRulebookTree,
  diffRulebookVersions,
} from "./versions";

export {
  listProcessRoles,
  listRoleAssignments,
  upsertRoleAssignment,
  getCurrentAssignee,
} from "./roles";

export {
  getActiveRulebookApi,
  getStage,
  getStep,
  getStepRaci,
  getRequiredData,
  getRoleAssignment,
} from "./api";

export { detectRulebookIntent, retrieveRulebookEvidence } from "./evidence";

export {
  hasActiveRulebook,
  isActiveRulebookKnown,
  noteActiveRulebookPresence,
} from "./capabilities";
