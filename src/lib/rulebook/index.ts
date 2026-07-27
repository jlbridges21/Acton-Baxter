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

export { slugifyKey, ensureUniqueKey } from "./keys";
export { recordRulebookAudit } from "./audit";
export type { RulebookAuditParams } from "./audit";

export {
  createDraftFromVersion,
  createEmptyDraft,
  assertDraftEditable,
  addStage,
  updateStage,
  deleteStage,
  reorderStages,
  addStep,
  updateStep,
  deleteStep,
  reorderSteps,
  moveStep,
  setStepRaci,
  addDataRequirement,
  updateDataRequirement,
  deleteDataRequirement,
  createRole,
  updateRole,
  retireRole,
} from "./draft";

export { exportRulebookAsSheets } from "./export";
export type { SheetRow, SheetExport } from "./export";

export { listMappings, upsertMapping, deleteMapping } from "./mappings";
export type { GhlRulebookMapping } from "./mappings";
