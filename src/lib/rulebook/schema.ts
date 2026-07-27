/**
 * Zod schemas for parsed Process Rulebook rows.
 */

import { z } from "zod";

export const RaciValueSchema = z.enum(["R", "A", "C", "I"]);
export const SourceSystemSchema = z.enum(["ghl", "buildertrend", "knowledge", "manual"]);

// ============================================================================
// Parsed row schemas
// ============================================================================

export const ParsedRoleSchema = z.object({
  role_key: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/),
  display_name: z.string().min(1),
  description: z.string().optional(),
});

export const ParsedStageSchema = z.object({
  stage_key: z.string().min(1),
  display_name: z.string().min(1),
  external_stage_name: z.string().optional(),
  order_index: z.number().int().nonnegative(),
  duration_days_budget: z.number().positive().optional(),
  description: z.string().optional(),
});

export const ParsedStepSchema = z.object({
  step_key: z.string().min(1),
  stage_key: z.string().min(1),
  display_name: z.string().min(1),
  order_index: z.number().int().nonnegative(),
  duration_days_budget: z.number().positive().optional(),
  description: z.string().optional(),
});

export const ParsedRaciSchema = z.object({
  step_key: z.string().min(1),
  role_key: z.string().min(1),
  raci: RaciValueSchema,
});

export const ParsedDataRequirementSchema = z.object({
  step_key: z.string().min(1),
  field_key: z.string().min(1),
  display_name: z.string().min(1),
  source_system: SourceSystemSchema,
  source_field_path: z.string().optional(),
  required: z.boolean().optional().default(true),
  description: z.string().optional(),
});

export const ParsedRulebookSchema = z.object({
  roles: z.array(ParsedRoleSchema),
  stages: z.array(ParsedStageSchema),
  steps: z.array(ParsedStepSchema),
  raci: z.array(ParsedRaciSchema),
  data_requirements: z.array(ParsedDataRequirementSchema),
});
