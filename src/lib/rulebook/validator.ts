/**
 * Validation for parsed Process Rulebook data.
 * Returns errors and warnings according to specified rules.
 */

import type {
  ParsedRulebook,
  ValidationReport,
  ValidationError,
  ValidationWarning,
  ProcessRole,
} from "./types";
import {
  ParsedRoleSchema,
  ParsedStageSchema,
  ParsedStepSchema,
  ParsedRaciSchema,
  ParsedDataRequirementSchema,
} from "./schema";

// ============================================================================
// Validation class
// ============================================================================

export class RulebookValidator {
  private errors: ValidationError[] = [];
  private warnings: ValidationWarning[] = [];
  private roleStatuses?: Map<string, "active" | "retired">;

  validate(rulebook: ParsedRulebook, options?: { roleStatuses?: ProcessRole[] }): ValidationReport {
    this.errors = [];
    this.warnings = [];

    // Build role status map if provided
    if (options?.roleStatuses) {
      this.roleStatuses = new Map();
      for (const role of options.roleStatuses) {
        this.roleStatuses.set(
          role.role_key,
          (role as { status?: string }).status === "retired" ? "retired" : "active",
        );
      }
    }

    // Schema validation
    this.validateSchemas(rulebook);

    // Business rule validation
    this.validateDuplicateKeys(rulebook);
    this.validateReferences(rulebook);
    this.validateRaci(rulebook);
    this.validateDataRequirements(rulebook);
    this.validateOrders(rulebook);
    this.validateDurations(rulebook);
    this.validateUnusedRoles(rulebook);

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  // ==========================================================================
  // Schema validation
  // ==========================================================================

  private validateSchemas(rulebook: ParsedRulebook): void {
    // Validate each role
    for (let i = 0; i < rulebook.roles.length; i++) {
      const result = ParsedRoleSchema.safeParse(rulebook.roles[i]);
      if (!result.success) {
        this.errors.push({
          type: "invalid_order_index",
          message: `Invalid role at index ${i}: ${result.error.message}`,
          location: `roles[${i}]`,
        });
      }
    }

    // Validate each stage
    for (let i = 0; i < rulebook.stages.length; i++) {
      const result = ParsedStageSchema.safeParse(rulebook.stages[i]);
      if (!result.success) {
        this.errors.push({
          type: "invalid_order_index",
          message: `Invalid stage at index ${i}: ${result.error.message}`,
          location: `stages[${i}]`,
        });
      }
    }

    // Validate each step
    for (let i = 0; i < rulebook.steps.length; i++) {
      const result = ParsedStepSchema.safeParse(rulebook.steps[i]);
      if (!result.success) {
        this.errors.push({
          type: "invalid_order_index",
          message: `Invalid step at index ${i}: ${result.error.message}`,
          location: `steps[${i}]`,
        });
      }
    }

    // Validate each RACI entry
    for (let i = 0; i < rulebook.raci.length; i++) {
      const result = ParsedRaciSchema.safeParse(rulebook.raci[i]);
      if (!result.success) {
        this.errors.push({
          type: "invalid_raci",
          message: `Invalid RACI at index ${i}: ${result.error.message}`,
          location: `raci[${i}]`,
        });
      }
    }

    // Validate each data requirement
    for (let i = 0; i < rulebook.data_requirements.length; i++) {
      const result = ParsedDataRequirementSchema.safeParse(rulebook.data_requirements[i]);
      if (!result.success) {
        this.errors.push({
          type: "invalid_source_system",
          message: `Invalid data requirement at index ${i}: ${result.error.message}`,
          location: `data_requirements[${i}]`,
        });
      }
    }
  }

  // ==========================================================================
  // Duplicate key validation
  // ==========================================================================

  private validateDuplicateKeys(rulebook: ParsedRulebook): void {
    // Check duplicate stage keys
    const stageKeys = new Set<string>();
    for (const stage of rulebook.stages) {
      if (stageKeys.has(stage.stage_key)) {
        this.errors.push({
          type: "duplicate_stage_key",
          message: `Duplicate stage_key: ${stage.stage_key}`,
          location: `stages`,
          context: { stage_key: stage.stage_key },
        });
      }
      stageKeys.add(stage.stage_key);
    }

    // Check duplicate step keys
    const stepKeys = new Set<string>();
    for (const step of rulebook.steps) {
      if (stepKeys.has(step.step_key)) {
        this.errors.push({
          type: "duplicate_step_key",
          message: `Duplicate step_key: ${step.step_key}`,
          location: `steps`,
          context: { step_key: step.step_key },
        });
      }
      stepKeys.add(step.step_key);
    }

    // Check duplicate stage orders
    const stageOrders = new Map<number, string>();
    for (const stage of rulebook.stages) {
      const existing = stageOrders.get(stage.order_index);
      if (existing) {
        this.errors.push({
          type: "duplicate_stage_order",
          message: `Duplicate stage order_index ${stage.order_index}: ${existing} and ${stage.stage_key}`,
          location: `stages`,
          context: { order_index: stage.order_index },
        });
      }
      stageOrders.set(stage.order_index, stage.stage_key);
    }

    // Check duplicate step orders within each stage
    const stepOrdersByStage = new Map<string, Map<number, string>>();
    for (const step of rulebook.steps) {
      if (!stepOrdersByStage.has(step.stage_key)) {
        stepOrdersByStage.set(step.stage_key, new Map());
      }
      const orders = stepOrdersByStage.get(step.stage_key)!;
      const existing = orders.get(step.order_index);
      if (existing) {
        this.errors.push({
          type: "duplicate_step_order",
          message: `Duplicate step order_index ${step.order_index} in stage ${step.stage_key}: ${existing} and ${step.step_key}`,
          location: `steps`,
          context: { stage_key: step.stage_key, order_index: step.order_index },
        });
      }
      orders.set(step.order_index, step.step_key);
    }

    // Check duplicate field keys per step
    const fieldKeysByStep = new Map<string, Set<string>>();
    for (const req of rulebook.data_requirements) {
      if (!fieldKeysByStep.has(req.step_key)) {
        fieldKeysByStep.set(req.step_key, new Set());
      }
      const fields = fieldKeysByStep.get(req.step_key)!;
      if (fields.has(req.field_key)) {
        this.errors.push({
          type: "duplicate_field_key",
          message: `Duplicate field_key "${req.field_key}" in step ${req.step_key}`,
          location: `data_requirements`,
          context: { step_key: req.step_key, field_key: req.field_key },
        });
      }
      fields.add(req.field_key);
    }
  }

  // ==========================================================================
  // Reference validation
  // ==========================================================================

  private validateReferences(rulebook: ParsedRulebook): void {
    const roleKeys = new Set(rulebook.roles.map((r) => r.role_key));
    const stageKeys = new Set(rulebook.stages.map((s) => s.stage_key));
    const stepKeys = new Set(rulebook.steps.map((s) => s.step_key));

    // Check step → stage references
    for (const step of rulebook.steps) {
      if (!stageKeys.has(step.stage_key)) {
        this.errors.push({
          type: "unknown_stage_ref",
          message: `Step "${step.step_key}" references unknown stage "${step.stage_key}"`,
          location: `steps`,
          context: { step_key: step.step_key, stage_key: step.stage_key },
        });
      }
    }

    // Check RACI → step references
    for (const raci of rulebook.raci) {
      if (!stepKeys.has(raci.step_key)) {
        this.errors.push({
          type: "unknown_step_ref",
          message: `RACI entry references unknown step "${raci.step_key}"`,
          location: `raci`,
          context: { step_key: raci.step_key },
        });
      }
    }

    // Check RACI → role references
    for (const raci of rulebook.raci) {
      if (!roleKeys.has(raci.role_key)) {
        this.errors.push({
          type: "unknown_role_ref",
          message: `RACI entry references unknown role "${raci.role_key}" in step "${raci.step_key}"`,
          location: `raci`,
          context: { step_key: raci.step_key, role_key: raci.role_key },
        });
      }
    }

    // Check data requirements → step references
    for (const req of rulebook.data_requirements) {
      if (!stepKeys.has(req.step_key)) {
        this.errors.push({
          type: "unknown_step_ref",
          message: `Data requirement "${req.field_key}" references unknown step "${req.step_key}"`,
          location: `data_requirements`,
          context: { step_key: req.step_key, field_key: req.field_key },
        });
      }
    }
  }

  // ==========================================================================
  // RACI validation
  // ==========================================================================

  private validateRaci(rulebook: ParsedRulebook): void {
    const stepKeys = new Set(rulebook.steps.map((s) => s.step_key));

    // Group RACI by step
    const raciByStep = new Map<string, typeof rulebook.raci>();
    for (const raci of rulebook.raci) {
      if (!raciByStep.has(raci.step_key)) {
        raciByStep.set(raci.step_key, []);
      }
      raciByStep.get(raci.step_key)!.push(raci);
    }

    // Check each step
    for (const step_key of stepKeys) {
      const stepRaci = raciByStep.get(step_key) || [];

      // Check for missing R
      const responsibles = stepRaci.filter((r) => r.raci === "R");
      if (responsibles.length === 0) {
        this.errors.push({
          type: "missing_responsible",
          message: `Step "${step_key}" has no Responsible (R) role`,
          location: `raci`,
          context: { step_key },
        });
      }

      // Check for multiple R
      if (responsibles.length > 1) {
        this.errors.push({
          type: "multiple_responsible",
          message: `Step "${step_key}" has multiple Responsible (R) roles: ${responsibles.map((r) => r.role_key).join(", ")}`,
          location: `raci`,
          context: { step_key, roles: responsibles.map((r) => r.role_key) },
        });
      }

      // Check for multiple A
      const accountables = stepRaci.filter((r) => r.raci === "A");
      if (accountables.length > 1) {
        this.errors.push({
          type: "multiple_accountable",
          message: `Step "${step_key}" has multiple Accountable (A) roles: ${accountables.map((r) => r.role_key).join(", ")}`,
          location: `raci`,
          context: { step_key, roles: accountables.map((r) => r.role_key) },
        });
      }

      // Warning for missing A
      if (accountables.length === 0) {
        this.warnings.push({
          type: "missing_accountable",
          message: `Step "${step_key}" has no Accountable (A) role`,
          location: `raci`,
          context: { step_key },
        });
      }

      // Check for retired responsible role
      if (this.roleStatuses && responsibles.length > 0) {
        for (const responsible of responsibles) {
          if (this.roleStatuses.get(responsible.role_key) === "retired") {
            this.warnings.push({
              type: "retired_role_used",
              message: `Step "${step_key}" has retired role "${responsible.role_key}" as Responsible (R)`,
              location: `raci`,
              context: { step_key, role_key: responsible.role_key },
            });
          }
        }
      }
    }
  }

  // ==========================================================================
  // Data requirements validation
  // ==========================================================================

  private validateDataRequirements(rulebook: ParsedRulebook): void {
    for (const req of rulebook.data_requirements) {
      // GHL source must have source_field_path if required
      if (req.source_system === "ghl" && req.required !== false) {
        if (!req.source_field_path || req.source_field_path.trim() === "") {
          this.errors.push({
            type: "ghl_missing_path",
            message: `Required GHL field "${req.field_key}" in step "${req.step_key}" missing source_field_path`,
            location: `data_requirements`,
            context: { step_key: req.step_key, field_key: req.field_key },
          });
        }
      }

      // Buildertrend warning (not yet connected)
      if (req.source_system === "buildertrend") {
        this.warnings.push({
          type: "buildertrend_not_connected",
          message: `Buildertrend field "${req.field_key}" in step "${req.step_key}" — Buildertrend not connected, cannot monitor`,
          location: `data_requirements`,
          context: { step_key: req.step_key, field_key: req.field_key },
        });
      }
    }
  }

  // ==========================================================================
  // Order validation
  // ==========================================================================

  private validateOrders(_rulebook: ParsedRulebook): void {
    // Order indices are validated by schema (must be non-negative integers)
    // Duplicate order checks are handled elsewhere in the validator.
  }

  // ==========================================================================
  // Duration validation
  // ==========================================================================

  private validateDurations(rulebook: ParsedRulebook): void {
    // Check stages
    for (const stage of rulebook.stages) {
      if (!stage.duration_days_budget) {
        this.warnings.push({
          type: "missing_duration",
          message: `Stage "${stage.stage_key}" has no duration_days_budget`,
          location: `stages`,
          context: { stage_key: stage.stage_key },
        });
      }
    }

    // Check steps
    for (const step of rulebook.steps) {
      if (!step.duration_days_budget) {
        this.warnings.push({
          type: "missing_duration",
          message: `Step "${step.step_key}" has no duration_days_budget`,
          location: `steps`,
          context: { step_key: step.step_key },
        });
      }
    }

    // Check external_stage_name
    for (const stage of rulebook.stages) {
      if (!stage.external_stage_name) {
        this.warnings.push({
          type: "missing_external_stage_name",
          message: `Stage "${stage.stage_key}" has no external_stage_name (Buildertrend mapping)`,
          location: `stages`,
          context: { stage_key: stage.stage_key },
        });
      }
    }
  }

  // ==========================================================================
  // Unused role validation
  // ==========================================================================

  private validateUnusedRoles(rulebook: ParsedRulebook): void {
    const usedRoles = new Set(rulebook.raci.map((r) => r.role_key));

    for (const role of rulebook.roles) {
      if (!usedRoles.has(role.role_key)) {
        this.warnings.push({
          type: "unused_role",
          message: `Role "${role.role_key}" is defined but never used in RACI`,
          location: `roles`,
          context: { role_key: role.role_key },
        });
      }
    }
  }
}

// ============================================================================
// Exported function
// ============================================================================

export function validateParsedRulebook(
  rulebook: ParsedRulebook,
  options?: { roleStatuses?: ProcessRole[] },
): ValidationReport {
  const validator = new RulebookValidator();
  return validator.validate(rulebook, options);
}
