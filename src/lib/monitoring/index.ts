import "server-only";

/**
 * Baxter proactive monitoring (GHL-only, no Buildertrend).
 * Deterministic checks only — LLM never decides findings.
 */

export { getMonitoringSettings, updateMonitoringSettings, isMonitoringEnabled } from "./settings";
export { isInQuietHours } from "./quiet-hours";
export {
  upsertFindingCandidate,
  resolveMissingFindings,
  listFindings,
  getFinding,
  acknowledgeFinding,
  dismissFalsePositive,
  markAlerted,
  markEscalated,
  computeFalsePositiveRate,
  findBySlackMessage,
} from "./findings";
export { buildMonitoringContext } from "./context";
export { runMonitoringSweep } from "./sweep";
export { deliverPendingAlerts } from "./delivery";
export { getMonitoringDashboardSummary } from "./metrics";
export {
  formatFindingAlertText,
  formatFindingAlertBlocks,
  formatDigestSummaryText,
  formatEscalationText,
} from "./alerts";

export type {
  MonitoringSettings,
  MonitoringFinding,
  FindingCandidate,
  FindingStatus,
  Severity,
  EntityType,
  DeliveryMode,
  TriggerSource,
  RunStatus,
  CheckKey,
  CheckResult,
  MonitoringRunSummary,
  MonitoringContext,
  GhlRulebookMapping,
  FindingFilters,
  SlackAlertRef,
  MonitoringRun,
} from "./types";

export type { MonitoringDashboardSummary } from "./metrics";
