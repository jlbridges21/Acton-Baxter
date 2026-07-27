import "server-only";

/**
 * Future monitoring contract — clean programmatic API for Process Rulebook.
 * This API is consumed by monitoring and other operational systems.
 */

import { createServiceClient } from "@/lib/supabase/admin";
import type {
  RulebookVersion,
  ProcessStage,
  ProcessStep,
  ProcessStepRaci,
  ProcessStepDataRequirement,
  RoleAssignmentWithProfile,
} from "./types";
import { getActiveRulebook } from "./versions";
import { getCurrentAssignee } from "./roles";

/**
 * Get the active rulebook version.
 */
export async function getActiveRulebookApi(): Promise<RulebookVersion | null> {
  return getActiveRulebook();
}

/**
 * Get a specific stage from the active rulebook.
 */
export async function getStage(stageKey: string): Promise<ProcessStage | null> {
  const active = await getActiveRulebook();
  if (!active) {
    return null;
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("process_stages")
    .select("*")
    .eq("version_id", active.id)
    .eq("stage_key", stageKey)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw error;
  }

  return data;
}

/**
 * Get a specific step from the active rulebook.
 */
export async function getStep(stepKey: string): Promise<ProcessStep | null> {
  const active = await getActiveRulebook();
  if (!active) {
    return null;
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("process_steps")
    .select("*")
    .eq("version_id", active.id)
    .eq("step_key", stepKey)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw error;
  }

  return data;
}

/**
 * Get RACI for a specific step in the active rulebook.
 */
export async function getStepRaci(stepKey: string): Promise<ProcessStepRaci[]> {
  const step = await getStep(stepKey);
  if (!step) {
    return [];
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("process_step_raci")
    .select("*")
    .eq("step_id", step.id);

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get required data for a specific step in the active rulebook.
 */
export async function getRequiredData(stepKey: string): Promise<ProcessStepDataRequirement[]> {
  const step = await getStep(stepKey);
  if (!step) {
    return [];
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("process_step_data_requirements")
    .select("*")
    .eq("step_id", step.id)
    .eq("required", true);

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get the current assignment for a role.
 */
export async function getRoleAssignment(
  roleKey: string,
): Promise<RoleAssignmentWithProfile | null> {
  return getCurrentAssignee(roleKey);
}
