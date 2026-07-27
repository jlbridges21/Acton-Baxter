/**
 * Process Rulebook types — versioned RACI + required data definitions.
 */

export type RulebookVersionStatus = "draft" | "active" | "superseded";
export type RaciValue = "R" | "A" | "C" | "I";
export type SourceSystem = "ghl" | "buildertrend" | "knowledge" | "manual";

export type ProcessRole = {
  id: string;
  role_key: string;
  display_name: string;
  description: string | null;
  status?: "active" | "retired";
  created_at: string;
  updated_at: string;
};

export type ProcessRoleAssignment = {
  id: string;
  role_key: string;
  profile_id: string | null;
  slack_user_id: string | null;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

export type RulebookVersion = {
  id: string;
  version_number: number;
  status: RulebookVersionStatus;
  source_description: string | null;
  source_reference: string | null;
  imported_by: string | null;
  activated_by: string | null;
  superseded_version_id: string | null;
  validation_report_json: ValidationReport;
  created_at: string;
  activated_at: string | null;
  updated_at: string;
};

export type ProcessStage = {
  id: string;
  version_id: string;
  stage_key: string;
  display_name: string;
  external_stage_name: string | null;
  order_index: number;
  duration_days_budget: number | null;
  description: string | null;
  created_at: string;
};

export type ProcessStep = {
  id: string;
  version_id: string;
  stage_id: string;
  step_key: string;
  display_name: string;
  order_index: number;
  duration_days_budget: number | null;
  description: string | null;
  created_at: string;
};

export type ProcessStepRaci = {
  id: string;
  step_id: string;
  role_key: string;
  raci: RaciValue;
  created_at: string;
};

export type ProcessStepDataRequirement = {
  id: string;
  step_id: string;
  field_key: string;
  display_name: string;
  source_system: SourceSystem;
  source_field_path: string | null;
  required: boolean;
  description: string | null;
  created_at: string;
};

// ============================================================================
// Validation types
// ============================================================================

export type ValidationErrorType =
  | "duplicate_stage_key"
  | "duplicate_step_key"
  | "duplicate_stage_order"
  | "duplicate_step_order"
  | "unknown_stage_ref"
  | "unknown_step_ref"
  | "unknown_role_ref"
  | "missing_responsible"
  | "multiple_responsible"
  | "multiple_accountable"
  | "invalid_raci"
  | "invalid_source_system"
  | "invalid_order_index"
  | "invalid_duration"
  | "ghl_missing_path"
  | "duplicate_field_key";

export type ValidationWarningType =
  | "missing_duration"
  | "missing_accountable"
  | "unused_role"
  | "missing_external_stage_name"
  | "buildertrend_not_connected"
  | "retired_role_used";

export type ValidationError = {
  type: ValidationErrorType;
  message: string;
  location?: string;
  context?: Record<string, unknown>;
};

export type ValidationWarning = {
  type: ValidationWarningType;
  message: string;
  location?: string;
  context?: Record<string, unknown>;
};

export type ValidationReport = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
};

// ============================================================================
// Parsed input types (from sheets)
// ============================================================================

export type ParsedRole = {
  role_key: string;
  display_name: string;
  description?: string;
};

export type ParsedStage = {
  stage_key: string;
  display_name: string;
  external_stage_name?: string;
  order_index: number;
  duration_days_budget?: number;
  description?: string;
};

export type ParsedStep = {
  step_key: string;
  stage_key: string;
  display_name: string;
  order_index: number;
  duration_days_budget?: number;
  description?: string;
};

export type ParsedRaci = {
  step_key: string;
  role_key: string;
  raci: RaciValue;
};

export type ParsedDataRequirement = {
  step_key: string;
  field_key: string;
  display_name: string;
  source_system: SourceSystem;
  source_field_path?: string;
  required?: boolean;
  description?: string;
};

export type ParsedRulebook = {
  roles: ParsedRole[];
  stages: ParsedStage[];
  steps: ParsedStep[];
  raci: ParsedRaci[];
  data_requirements: ParsedDataRequirement[];
};

// ============================================================================
// Sheet input types
// ============================================================================

export type SheetRow = Record<string, string>;
export type SheetGrid = string[][];

export type SheetInput =
  | {
      sheets: Record<string, SheetRow[]>;
    }
  | {
      grids: Record<string, SheetGrid>;
    };

// ============================================================================
// Version management types
// ============================================================================

export type RulebookTreeStep = ProcessStep & {
  raci: ProcessStepRaci[];
  data_requirements: ProcessStepDataRequirement[];
};

export type RulebookTreeStage = ProcessStage & {
  steps: RulebookTreeStep[];
};

export type RulebookTree = RulebookVersion & {
  stages: RulebookTreeStage[];
};

export type RulebookDiffSummary = {
  stages_added: number;
  stages_modified: number;
  stages_removed: number;
  steps_added: number;
  steps_modified: number;
  steps_removed: number;
  raci_added: number;
  raci_removed: number;
  data_requirements_added: number;
  data_requirements_removed: number;
};

// ============================================================================
// Role assignment types
// ============================================================================

export type RoleAssignmentWithProfile = ProcessRoleAssignment & {
  profile_name: string | null;
};

// ============================================================================
// Evidence types (for Baxter AI integration)
// ============================================================================

export type RulebookIntent =
  | "responsibility"
  | "accountability"
  | "consulted"
  | "informed"
  | "stages"
  | "steps"
  | "required_data"
  | "process_ownership"
  | "what_comes_after"
  | "none";

export type RulebookEvidenceItem = {
  number: number;
  id: string;
  title: string;
  summary: string | null;
  contentExcerpt: string;
  category: string;
  tags: string[];
  sourceName: string | null;
  sourceUrl: string | null;
  sourceType: string;
  mimeType: string | null;
  updatedAt: string;
  citationLabel: string;
  relevanceScore: number;
};
