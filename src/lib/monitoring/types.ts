import "server-only";

/**
 * Baxter proactive monitoring types (GHL-only, no Buildertrend).
 * All findings are deterministic — LLM never decides findings.
 */

export const FINDING_STATUSES = [
  "open",
  "alerted",
  "acknowledged",
  "resolved",
  "dismissed_false_positive",
  "expired",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const SEVERITIES = ["info", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ENTITY_TYPES = [
  "opportunity",
  "contact",
  "configuration",
  "feed",
  "pipeline_stage",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const DELIVERY_MODES = ["immediate", "digest"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const TRIGGER_SOURCES = ["manual", "cron", "job"] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

export const RUN_STATUSES = ["running", "completed", "partial", "failed", "skipped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Candidate finding from a check run — not yet persisted.
 */
export type FindingCandidate = {
  checkKey: string;
  dedupeKey: string;
  severity: Severity;
  entityType: EntityType;
  entityId?: string;
  contactId?: string;
  opportunityId?: string;
  rulebookStageKey?: string;
  rulebookStepKey?: string;
  title: string;
  evidence: Record<string, unknown>;
  recommendation?: string;
  responsibleRoleKey?: string;
  responsibleProfileId?: string;
};

/**
 * Persisted finding row.
 */
export type MonitoringFinding = {
  id: string;
  check_key: string;
  dedupe_key: string;
  severity: Severity;
  entity_type: EntityType;
  entity_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  rulebook_stage_key: string | null;
  rulebook_step_key: string | null;
  title: string;
  evidence_json: Record<string, unknown>;
  recommendation: string | null;
  responsible_role_key: string | null;
  responsible_profile_id: string | null;
  status: FindingStatus;
  detected_at: string;
  last_detected_at: string;
  alerted_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by_slack_user_id: string | null;
  resolved_at: string | null;
  dismissed_at: string | null;
  dismissed_by_slack_user_id: string | null;
  escalated_at: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Admin-tunable monitoring configuration.
 */
export type MonitoringSettings = {
  id: string;
  enabled: boolean;
  pilot_slack_channel_id: string | null;
  pilot_slack_channel_name: string | null;
  timezone: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  delivery_mode: DeliveryMode;
  escalation_window_minutes: number;
  default_stale_days: number;
  monitored_pipeline_ids: string[];
  check_configs: Record<string, CheckConfig>;
  stage_stale_overrides: Record<string, number>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CheckConfig = {
  enabled?: boolean;
  customParams?: Record<string, unknown>;
};

/**
 * Monitoring run record.
 */
export type MonitoringRun = {
  id: string;
  status: RunStatus;
  trigger_source: TriggerSource;
  checks_run: number;
  records_evaluated: number;
  new_findings: number;
  refreshed_findings: number;
  resolved_findings: number;
  duration_ms: number | null;
  error_message: string | null;
  summary_json: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

/**
 * Context for monitoring checks.
 */
export type MonitoringContext = {
  settings: MonitoringSettings;
  activeRulebook: {
    id: string;
    version_number: number;
  } | null;
  mappings: GhlRulebookMapping[];
  ghlConfigured: boolean;
};

/**
 * GHL pipeline/stage → Rulebook mapping.
 */
export type GhlRulebookMapping = {
  id: string;
  ghl_pipeline_id: string;
  ghl_pipeline_name: string | null;
  ghl_stage_id: string;
  ghl_stage_name: string | null;
  rulebook_stage_key: string;
  rulebook_step_key: string | null;
  enabled: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Check result summary.
 */
export type CheckResult = {
  checkKey: string;
  candidates: FindingCandidate[];
  recordsEvaluated: number;
  durationMs: number;
  error?: string;
  /** True when GHL pagination hit a safety ceiling or otherwise could not finish. */
  incomplete?: boolean;
  incompleteReason?: string | null;
};

/**
 * Check key for operational checks.
 */
export type CheckKey =
  | "unowned-opportunity"
  | "stale-opportunity"
  | "required-ghl-data"
  | "feed-health"
  | "rulebook-health";

/**
 * Summary of a monitoring sweep.
 */
export type MonitoringRunSummary = {
  runId: string;
  status: RunStatus;
  triggerSource: TriggerSource;
  checksRun: number;
  recordsEvaluated: number;
  newFindings: number;
  refreshedFindings: number;
  resolvedFindings: number;
  durationMs: number | null;
  error?: string;
};

/**
 * Filters for listing findings.
 */
export type FindingFilters = {
  status?: FindingStatus | FindingStatus[];
  checkKey?: CheckKey;
  severity?: Severity;
  entityType?: EntityType;
  opportunityId?: string;
  contactId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Slack alert reference for marking alerted.
 */
export type SlackAlertRef = {
  channelId: string;
  messageTs: string;
  threadTs?: string;
};
